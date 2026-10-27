#!/usr/bin/env bash
# The audit sink — a 400-day log bucket and the sink that routes the audit
# and function lines into it (audit-hardening WS-6, plan RU-36; runbook §2.5
# and §3 step 8; docs/production-deploy.md §1 "Cloud Audit Logs", an owner
# **decide** item). The preflight's P9 reports the sink and the bucket.
#
#   tools/ops/log-sink.sh [--project <id>]                    # dry run: prints the plan, runs no gcloud
#   tools/ops/log-sink.sh --project <id> --apply              # creates or converges the bucket and the sink
#   tools/ops/log-sink.sh --project <id> --apply --lock       # ...and LOCKS the bucket (IRREVERSIBLE)
#
# The bucket: LOG_BUCKET_ID in LOG_BUCKET_LOCATION, LOG_BUCKET_RETENTION_DAYS
# days (names.env). A lock happens only with an explicit --lock: once
# locked, the bucket cannot be deleted and its retention can only grow —
# not even the project owner can undo it.
#
# The filter (RU-36): the project's Admin Activity and Data Access audit
# logs, OR every Cloud Functions (gen 2) log line of the project — the
# callable outcome lines, the trigger attempt lines and every security line
# (`impersonation.*`, `otp.*`, `*.refused`) — AND NOT a client issue
# (`jsonPayload.clientIssueKind`): web issues keep OR-34's published 30-day
# retention in _Default. The sink copies; _Default keeps its own 30 days.
#
# Idempotent: each resource is described first; an existing one is updated
# to the values here, an absent one created. The sink writes into a bucket
# of its own project, so no writer identity needs a grant.
#
# Dry run by default: no gcloud command runs, the plan shows both branches
# of each probe. --apply mutates; nobody runs it from an agent session.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=names.env
. "$HERE/names.env"

# RU-36, verbatim — pinned by tools/verify/ops/ops-scripts.spec.mjs.
SINK_FILTER='(LOG_ID("cloudaudit.googleapis.com/activity") OR LOG_ID("cloudaudit.googleapis.com/data_access") OR (resource.type="cloud_run_revision" AND labels."goog-managed-by"="cloudfunctions")) AND NOT jsonPayload.clientIssueKind:*'

usage() {
  echo 'usage: tools/ops/log-sink.sh [--project <id>] [--apply] [--lock]   (a dry run without --apply; --lock is irreversible)'
}

APPLY=0
LOCK=0
PROJECT="${PROJECT_ID:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --lock) LOCK=1 ;;
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
DESTINATION="logging.googleapis.com/projects/${PROJECT}/locations/${LOG_BUCKET_LOCATION}/buckets/${LOG_BUCKET_ID}"

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

# probe-function, if-present-function, if-absent-function: under --apply the
# probe picks one branch; a dry run prints both.
converge() {
  if [ "$APPLY" = 1 ]; then
    if "$1"; then "$2"; else "$3"; fi
  else
    "$1" || true
    echo '#   present →'
    "$2"
    echo '#   absent →'
    "$3"
  fi
}

bucket_probe() {
  probe gcloud logging buckets describe "$LOG_BUCKET_ID" "--location=$LOG_BUCKET_LOCATION" "--project=$PROJECT"
}
bucket_update() {
  run gcloud logging buckets update "$LOG_BUCKET_ID" "--location=$LOG_BUCKET_LOCATION" "--retention-days=$LOG_BUCKET_RETENTION_DAYS" "--project=$PROJECT"
}
bucket_create() {
  run gcloud logging buckets create "$LOG_BUCKET_ID" "--location=$LOG_BUCKET_LOCATION" "--retention-days=$LOG_BUCKET_RETENTION_DAYS" '--description=Creativo audit and function lines, 400 days (tools/ops/log-sink.sh)' "--project=$PROJECT"
}
sink_probe() {
  probe gcloud logging sinks describe "$LOG_SINK_NAME" "--project=$PROJECT"
}
sink_update() {
  run gcloud logging sinks update "$LOG_SINK_NAME" "$DESTINATION" "--log-filter=$SINK_FILTER" "--project=$PROJECT"
}
sink_create() {
  run gcloud logging sinks create "$LOG_SINK_NAME" "$DESTINATION" "--log-filter=$SINK_FILTER" '--description=Creativo audit sink (tools/ops/log-sink.sh, RU-36)' "--project=$PROJECT"
}

echo "# The audit sink — bucket ${LOG_BUCKET_ID} (${LOG_BUCKET_LOCATION}, ${LOG_BUCKET_RETENTION_DAYS} days) and sink ${LOG_SINK_NAME}, project ${PROJECT}"
echo "# 1. the bucket"
converge bucket_probe bucket_update bucket_create
echo "# 2. the sink"
converge sink_probe sink_update sink_create
echo "# 3. the lock"
if [ "$LOCK" = 1 ]; then
  echo "# --lock: IRREVERSIBLE — the bucket can never be deleted and its retention can only grow"
  run gcloud logging buckets update "$LOG_BUCKET_ID" "--location=$LOG_BUCKET_LOCATION" --locked "--project=$PROJECT"
else
  echo "# not locked. Locking is the owner's decision (production-deploy.md §1) and IRREVERSIBLE: re-run with --apply --lock."
fi
if [ "$APPLY" = 0 ]; then
  echo "# dry run: nothing ran against ${PROJECT}. Re-run with --project <id> --apply to apply."
fi
