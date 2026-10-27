#!/usr/bin/env bash
# Logs-based metrics and their alert policies (audit-hardening WS-6; runbook
# §3 step 7; docs/production-deploy.md §1 "Monitoring and privacy" and §3.5).
#
#   tools/ops/log-metrics.sh [--project <id>]           # dry run: prints the plan, runs no gcloud
#   tools/ops/log-metrics.sh --project <id> --apply     # creates or updates every metric, then every alert
#
# The metrics (names in names.env), each a DELTA INT64 counter:
#   client_issue_count      every web client issue (OR-34), label kind —
#                           the recipe runbook §3 step 7 used to spell out;
#   trigger_attempt_failed  a retrying trigger's failed attempt, labels
#                           outcome (TRANSIENT | PERMANENT) and fn;
#   document_refused        a stored document a server read guard refused;
#   audit_actor_missing     an act committed without its audit row;
#   callable_failed         a callable's failure outcome line, label callable.
# Every message a filter names is a `LogEvent` value
# (libs/ecs-core/src/primitives/log-event.data.ts) — pinned by
# tools/verify/ops/ops-scripts.spec.mjs, so a renamed event cannot silently
# kill its metric. Filters use the has-operator (`:`): the functions logger
# rewrites an ERROR line's message to a stack that starts with it. A
# function line is a gen-2 Cloud Run revision's; a client issue line (which
# may repeat a client's message) never counts toward a server metric.
#
# The alerts are tools/ops/alerts/*.yaml (Cloud Monitoring AlertPolicy
# files), created through `gcloud alpha monitoring policies` — the policy
# file commands are alpha-only. None names a notification channel: add one
# in Cloud Monitoring → Alerting (an e-mail channel), or a
# notificationChannels: list in the file, before relying on it.
#
# Idempotent: each metric is described first and updated when it exists;
# each alert is looked up by its displayName and updated when it exists.
#
# Dry run by default: no gcloud command runs, the plan prints each metric's
# config and both branches of each probe. --apply mutates; nobody runs it
# from an agent session.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=names.env
. "$HERE/names.env"

usage() {
  echo 'usage: tools/ops/log-metrics.sh [--project <id>] [--apply]   (a dry run without --apply)'
}

APPLY=0
PROJECT="${PROJECT_ID:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --project) PROJECT="${2:?--project needs an id}"; shift ;;
    --project=*) PROJECT="${1#*=}" ;;
    -h | --help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done
if [ "$APPLY" = 1 ] && [ -z "$PROJECT" ]; then
  echo "--apply needs --project <id> (or PROJECT_ID)" >&2
  exit 2
fi
PROJECT="${PROJECT:-your-project-id}"

# One argument as a shell word: bare when plain, else single-quoted.
word() {
  local quote="'\\''"
  case "$1" in
    '' | *[!A-Za-z0-9_./:=@,+%-]*) printf "'%s'" "${1//\'/$quote}" ;;
    *) printf '%s' "$1" ;;
  esac
}

# Prints a command as it would be typed.
show() {
  local out='+' arg
  for arg in "$@"; do out+=" $(word "$arg")"; done
  printf '%s\n' "$out"
}

# Prints a command; runs it only under --apply.
run() {
  show "$@"
  if [ "$APPLY" = 1 ]; then "$@"; fi
}

# A describe: printed; under --apply, whether it succeeds (the resource exists).
probe() {
  show "$@"
  [ "$APPLY" = 1 ] && "$@" >/dev/null 2>&1
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# A function line of the project, never a client issue's.
SERVER='resource.type="cloud_run_revision" AND NOT jsonPayload.clientIssueKind:*'

# metric NAME DESCRIPTION FILTER [LABEL=FIELD ...]: the metric's config file,
# printed, then its create — or its update when it exists.
metric() {
  local name="$1" description="$2" filter="$3"
  shift 3
  local file="$TMP/$name.yaml" pair sq="'" dq="''"
  {
    echo "description: '${description//$sq/$dq}'"
    echo "filter: '${filter//$sq/$dq}'"
    if [ $# -gt 0 ]; then
      echo 'labelExtractors:'
      for pair in "$@"; do echo "  ${pair%%=*}: EXTRACT(${pair#*=})"; done
    fi
    echo 'metricDescriptor:'
    echo '  metricKind: DELTA'
    echo '  valueType: INT64'
    if [ $# -gt 0 ]; then
      echo '  labels:'
      for pair in "$@"; do
        echo "    - key: ${pair%%=*}"
        echo '      valueType: STRING'
      done
    fi
  } >"$file"
  echo "# metric ${name} — config:"
  sed 's/^/#   /' "$file"
  if [ "$APPLY" = 1 ]; then
    if probe gcloud logging metrics describe "$name" "--project=$PROJECT"; then
      run gcloud logging metrics update "$name" "--config-from-file=$file" "--project=$PROJECT"
    else
      run gcloud logging metrics create "$name" "--config-from-file=$file" "--project=$PROJECT"
    fi
  else
    probe gcloud logging metrics describe "$name" "--project=$PROJECT" || true
    echo '#   present →'
    show gcloud logging metrics update "$name" "--config-from-file=$name.yaml" "--project=$PROJECT"
    echo '#   absent →'
    show gcloud logging metrics create "$name" "--config-from-file=$name.yaml" "--project=$PROJECT"
  fi
}

# alert FILE: the policy looked up by its displayName, then created or updated.
alert() {
  local file="$1" display name
  display="$(sed -n "s/^displayName: '\(.*\)'$/\1/p" "$file")"
  if [ -z "$display" ]; then
    echo "$file: no single-quoted top-level displayName" >&2
    exit 1
  fi
  local list=(gcloud alpha monitoring policies list "--project=$PROJECT" "--filter=displayName=\"$display\"" '--format=value(name)')
  echo "# alert ${file#"$HERE"/}"
  show "${list[@]}"
  if [ "$APPLY" = 1 ]; then
    name="$("${list[@]}")"
    if [ -n "$name" ]; then
      run gcloud alpha monitoring policies update "$name" "--policy-from-file=$file" "--project=$PROJECT"
    else
      run gcloud alpha monitoring policies create "--policy-from-file=$file" "--project=$PROJECT"
    fi
  else
    echo '#   present →'
    show gcloud alpha monitoring policies update '<its name>' "--policy-from-file=${file#"$HERE"/}" "--project=$PROJECT"
    echo '#   absent →'
    show gcloud alpha monitoring policies create "--policy-from-file=${file#"$HERE"/}" "--project=$PROJECT"
  fi
}

echo "# Logs-based metrics and alerts, project ${PROJECT}"

metric "$METRIC_CLIENT_ISSUES" \
  'Web client issues (OR-34), by kind' \
  'jsonPayload.clientIssueKind:*' \
  kind=jsonPayload.clientIssueKind

metric "$METRIC_TRIGGER_ATTEMPT_FAILED" \
  'Retrying trigger attempts that failed (LogEvent.TriggerAttemptFailed), by outcome and fn' \
  "${SERVER} AND jsonPayload.message:\"trigger attempt failed\"" \
  outcome=jsonPayload.outcome fn=jsonPayload.fn

metric "$METRIC_DOCUMENT_REFUSED" \
  'Stored documents a server read guard refused (LogEvent.DocumentRefused)' \
  "${SERVER} AND jsonPayload.message:\"malformed document refused\""

metric "$METRIC_AUDIT_ACTOR_MISSING" \
  'Acts committed without an audit row: no verified actor (LogEvent.AuditActorMissing)' \
  "${SERVER} AND jsonPayload.message:\"audit row has no verified actor\""

metric "$METRIC_CALLABLE_FAILED" \
  'Callable failure outcome lines (LogEvent.CallableFailed), by callable' \
  "${SERVER} AND jsonPayload.message:\"callable.failed\"" \
  callable=jsonPayload.callable

for file in "$HERE"/alerts/*.yaml; do
  alert "$file"
done

if [ "$APPLY" = 0 ]; then
  echo "# dry run: nothing ran against ${PROJECT}. Re-run with --project <id> --apply to apply."
fi
