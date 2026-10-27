#!/usr/bin/env bash
# Firestore backstops — Point-in-Time Recovery and a daily backup schedule
# (audit-hardening WS-6; docs/production-deploy.md §1 "Backups", an owner
# **decide** item; runbook §2.5 and §3 step 8). The preflight's P9 reports
# both.
#
#   tools/ops/firestore-backups.sh [--project <id>]          # dry run: prints the plan, runs no gcloud
#   tools/ops/firestore-backups.sh --project <id> --apply    # turns PITR on, adds the schedule when none exists
#
# PITR keeps PITR_DAYS (7) days of document versions, readable at any
# minute — the undo for the hand-written production bootstrap
# (production-deploy.md §2). The schedule takes a BACKUP_RECURRENCE backup
# kept BACKUP_RETENTION (names.env). Storage objects (media, avatars, visit
# photos) are outside both and need their own policy (production-deploy.md
# §1 "Backups").
#
# Idempotent: PITR is read first and turned on only when off; a schedule is
# created only when the database has none (an existing one is left as it is
# — compare its retention with BACKUP_RETENTION by hand).
#
# Dry run by default: no gcloud command runs, the plan shows both branches
# of each probe. --apply mutates; nobody runs it from an agent session.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=names.env
. "$HERE/names.env"

usage() {
  echo 'usage: tools/ops/firestore-backups.sh [--project <id>] [--apply]   (a dry run without --apply)'
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

pitr_probe() {
  local describe=(gcloud firestore databases describe "--database=$DATABASE_ID" "--project=$PROJECT" '--format=value(pointInTimeRecoveryEnablement)')
  show "${describe[@]}"
  [ "$APPLY" = 1 ] || return 1
  [ "$("${describe[@]}")" = POINT_IN_TIME_RECOVERY_ENABLED ]
}
pitr_kept() {
  echo "#   PITR is on (${PITR_DAYS} days of versions) — nothing to do"
}
pitr_enable() {
  run gcloud firestore databases update "--database=$DATABASE_ID" --enable-pitr "--project=$PROJECT"
}
schedule_probe() {
  local list=(gcloud firestore backups schedules list "--database=$DATABASE_ID" "--project=$PROJECT" '--format=value(name)')
  show "${list[@]}"
  [ "$APPLY" = 1 ] || return 1
  [ -n "$("${list[@]}")" ]
}
schedule_kept() {
  echo "#   a backup schedule exists — left as it is (compare its retention with ${BACKUP_RETENTION})"
}
schedule_create() {
  run gcloud firestore backups schedules create "--database=$DATABASE_ID" "--recurrence=$BACKUP_RECURRENCE" "--retention=$BACKUP_RETENTION" "--project=$PROJECT"
}

echo "# Firestore backstops — PITR ${PITR_DAYS} days and a ${BACKUP_RECURRENCE} backup kept ${BACKUP_RETENTION}, database ${DATABASE_ID}, project ${PROJECT}"
echo "# 1. Point-in-Time Recovery"
converge pitr_probe pitr_kept pitr_enable
echo "# 2. the backup schedule"
converge schedule_probe schedule_kept schedule_create
if [ "$APPLY" = 0 ]; then
  echo "# dry run: nothing ran against ${PROJECT}. Re-run with --project <id> --apply to apply."
fi
