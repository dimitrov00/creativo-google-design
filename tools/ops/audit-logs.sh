#!/usr/bin/env bash
# Cloud Audit Logs — Data Access for Firestore and Identity Toolkit
# (audit-hardening WS-6; docs/production-deploy.md §1 "Cloud Audit Logs",
# an owner **decide** item; runbook §3 step 8).
#
#   tools/ops/audit-logs.sh [--project <id>]            # dry run: prints the plan, runs no gcloud
#   tools/ops/audit-logs.sh --project <id> --apply      # read-modify-write of the project's IAM policy
#
# Turns on DATA_WRITE and ADMIN_READ (never DATA_READ) for:
#   - datastore.googleapis.com — the service name Google documents for
#     Firestore's audit configuration; it covers firestore.googleapis.com
#     too, and Native-mode entries arrive under
#     protoPayload.serviceName="firestore.googleapis.com" (plan RU-34);
#   - identitytoolkit.googleapis.com — Firebase Auth. UNCONFIRMED: no page
#     could be read to verify this name (plan §7 item 18); check it in the
#     console (IAM & Admin → Audit Logs → "Identity Toolkit API") before
#     applying.
#
# Idempotent: the policy is read, the two audit configs are merged into it
# (existing log types and exempted members kept), and the policy is written
# back with the etag it was read with — a concurrent change fails the write
# instead of being lost. Run twice, the second write changes nothing.
#
# Dry run by default: no gcloud command runs, the merge is shown on an empty
# policy (node only). --apply mutates; nobody runs it from an agent session.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=names.env
. "$HERE/names.env"

SERVICES=(datastore.googleapis.com identitytoolkit.googleapis.com)
LOG_TYPES=(DATA_WRITE ADMIN_READ)

usage() {
  echo 'usage: tools/ops/audit-logs.sh [--project <id>] [--apply]   (a dry run without --apply)'
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

# The merge: adds every LOG_TYPES entry for every service to the policy's
# auditConfigs, keeping what is there. argv: the policy file, then the
# services, then `--`, then the log types.
MERGE_JS='
const fs = require("node:fs");
const args = process.argv.slice(1);
const cut = args.indexOf("--");
const [file, ...services] = args.slice(0, cut);
const logTypes = args.slice(cut + 1);
const policy = JSON.parse(fs.readFileSync(file, "utf8"));
const configs = policy.auditConfigs ?? [];
for (const service of services) {
  let config = configs.find((entry) => entry.service === service);
  if (config === undefined) {
    config = { service, auditLogConfigs: [] };
    configs.push(config);
  }
  config.auditLogConfigs ??= [];
  for (const logType of logTypes) {
    if (!config.auditLogConfigs.some((entry) => entry.logType === logType)) {
      config.auditLogConfigs.push({ logType });
    }
  }
}
policy.auditConfigs = configs;
process.stdout.write(JSON.stringify(policy, null, 2) + "\n");
'

cat <<NOTE
# Cloud Audit Logs — Data Access (${LOG_TYPES[*]}) for ${SERVICES[*]}, project ${PROJECT}
#
# VOLUME AND BILLING: DATA_WRITE writes one Data Access entry per Firestore
# write (every booking verb, trigger, projection and audit row) and per Auth
# account change. Unlike the Admin Activity logs (the free _Required
# bucket), Data Access entries count toward Cloud Logging's billable
# ingestion beyond the monthly free allotment — once in _Default and once
# more in the 400-day bucket of tools/ops/log-sink.sh, whose retention past
# 30 days is billed too. DATA_READ is NOT turned on: one entry per read.
# The entries name principals (e-mail addresses) — plan §7 item 9.
NOTE

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

show gcloud projects get-iam-policy "$PROJECT" --format=json
echo "+ node -e <merge ${LOG_TYPES[*]} for ${SERVICES[*]} into auditConfigs, keeping the rest> policy.json > merged.json"
show gcloud projects set-iam-policy "$PROJECT" merged.json --format=none

if [ "$APPLY" = 1 ]; then
  gcloud projects get-iam-policy "$PROJECT" --format=json >"$TMP/policy.json"
  node -e "$MERGE_JS" "$TMP/policy.json" "${SERVICES[@]}" -- "${LOG_TYPES[@]}" >"$TMP/merged.json"
  gcloud projects set-iam-policy "$PROJECT" "$TMP/merged.json" --format=none
  echo "# applied: the audit configs of ${PROJECT} now hold ${LOG_TYPES[*]} for ${SERVICES[*]}"
else
  echo '{}' >"$TMP/empty.json"
  echo "# the merge over an empty policy (dry run — the real policy's other configs are kept):"
  node -e "$MERGE_JS" "$TMP/empty.json" "${SERVICES[@]}" -- "${LOG_TYPES[@]}" | sed 's/^/#   /'
  echo "# dry run: nothing ran against ${PROJECT}. Re-run with --project <id> --apply to apply."
fi
