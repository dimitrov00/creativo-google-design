#!/usr/bin/env bash
# The repository's GitHub settings for the release flow (ADR
# docs/architecture/decisions/2026-11-18-releases-and-environments.md, R2,
# R4, R8, E4, E5; docs/production-deploy.md «Environments and releases»).
#
#   tools/ops/github-repo-settings.sh                        # dry run: prints the plan, runs no gh
#   tools/ops/github-repo-settings.sh --apply \
#     --release-app-id <numeric id> \
#     [--release-app-client-id <Iv…> --release-app-key-file <app.pem>]
#
# In order:
#   1. merging — squash only, the commit titled by the PR title and bodied
#      by its description; merged branches deleted;
#   2. the `main requires pull requests` ruleset — the `pr-title` check
#      required beside CI's seven, squash its only merge method; every other
#      rule, check and bypass kept as read;
#   3. `release branches require pull requests` — the same rules on
#      `release/**` (created, or converged to main's);
#   4. `release tags` — only the release App creates, moves or deletes a
#      `v*` tag: the tag is what deploys production;
#   5. the environments — `staging` deployable from `main` only (its
#      deploys run as main's workflow_run), `production` from tags `v*`
#      only, after the owner's approval (the repository owner, the one
#      reviewer; self-review stays allowed, or the owner could never approve
#      the rollback they dispatched);
#   6. the release App's client ID (a repository variable — it is public)
#      and private key (a repository secret), when given.
#
# The project ids and the identity of each environment are set by the
# values tools/ops/deploy-identity.sh prints, never here.
#
# Idempotent: rulesets are found by name and updated, or created; a branch
# policy is added only when absent. Dry run by default: no gh command runs.
# --apply mutates; nobody runs it from an agent session.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=names.env
. "$HERE/names.env"

# GitHub Actions' own app id: the integration CI's checks report from.
ACTIONS_INTEGRATION_ID=15368
MAIN_RULESET='main requires pull requests'
RELEASE_RULESET='release branches require pull requests'
TAG_RULESET='release tags'

usage() {
  echo 'usage: tools/ops/github-repo-settings.sh [--repo <owner/name>] [--apply --release-app-id <id> [--release-app-client-id <id> --release-app-key-file <pem>]]   (a dry run without --apply)'
}

APPLY=0
REPO=''
APP_ID=''
APP_CLIENT_ID=''
APP_KEY_FILE=''
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --repo) REPO="${2:?--repo needs owner/name}"; shift ;;
    --repo=*) REPO="${1#*=}" ;;
    --release-app-id) APP_ID="${2:?--release-app-id needs the App id}"; shift ;;
    --release-app-client-id) APP_CLIENT_ID="${2:?--release-app-client-id needs the client ID}"; shift ;;
    --release-app-key-file) APP_KEY_FILE="${2:?--release-app-key-file needs a path}"; shift ;;
    -h | --help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

# The repository this checkout pushes to, unless named.
if [ -z "$REPO" ]; then
  origin="$(git -C "$HERE" remote get-url origin 2>/dev/null || true)"
  REPO="$(printf '%s' "$origin" | sed -nE 's#^(https://github\.com/|git@github\.com:)([^/]+/[^/]+)$#\2#p' | sed 's/\.git$//')"
fi
REPO="${REPO:-OWNER/REPO}"
OWNER="${REPO%%/*}"
if [ "$APPLY" = 1 ]; then
  if [ "$REPO" = OWNER/REPO ]; then
    echo "--apply needs --repo <owner/name> (no github.com origin to read it from)" >&2
    exit 2
  fi
  case "$APP_ID" in
    '' | *[!0-9]*)
      echo "--apply needs --release-app-id <numeric id> (the App's settings page, «App ID»)" >&2
      exit 2
      ;;
  esac
  if [ -n "$APP_CLIENT_ID$APP_KEY_FILE" ] && { [ -z "$APP_CLIENT_ID" ] || [ -z "$APP_KEY_FILE" ]; }; then
    echo "--release-app-client-id and --release-app-key-file go together" >&2
    exit 2
  fi
fi
APP_ID="${APP_ID:-<release-app-id>}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# What the probes read (probe_into assigns them by name).
main_id=''
release_id=''
tag_id=''
owner_id=''

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

# A read whose answer the next step needs, into the variable `var`:
# printed; under --apply, its output (in a dry run, `placeholder`).
probe_into() {
  local var="$1" placeholder="$2" value
  shift 2
  show "$@"
  value="$placeholder"
  if [ "$APPLY" = 1 ]; then value="$("$@")"; fi
  printf -v "$var" '%s' "$value"
}

# A request body, written to a file and shown: `body <name> <json>`.
body() {
  printf '%s\n' "$2" >"$TMP/$1"
  printf '#   %s\n' "$2"
}

# The rules of the main ruleset as read, with squash the only merge method
# and pr-title required beside the checks it holds (gh's own jq).
CONVERGE_RULES='[.rules[]
  | if .type == "pull_request" then .parameters.allowed_merge_methods = ["squash"]
    elif .type == "required_status_checks" then .parameters.required_status_checks
      |= (map(select(.context != "pr-title")) + [{"context": "pr-title", "integration_id": '"$ACTIONS_INTEGRATION_ID"'}])
    else . end]'
MAIN_BODY='{name, target, enforcement, bypass_actors, conditions, rules: '"$CONVERGE_RULES"'}'
RELEASE_BODY='{name: "'"$RELEASE_RULESET"'", target, enforcement, bypass_actors, conditions: {ref_name: {include: ["refs/heads/release/**"], exclude: []}}, rules: '"$CONVERGE_RULES"'}'

# A ruleset's id by name, into `var` ('' when absent; a placeholder in a dry run).
ruleset_id_into() {
  probe_into "$1" "<$3-ruleset-id>" gh api "repos/$REPO/rulesets" --jq ".[] | select(.name == \"$2\") | .id"
}

# PUT the body file to the ruleset `id`, or POST it when `id` is empty.
put_or_post_ruleset() {
  local id="$1" file="$2"
  if [ "$APPLY" = 1 ] && [ -z "$id" ]; then
    run gh api --method POST "repos/$REPO/rulesets" --input "$file"
  elif [ "$APPLY" = 1 ]; then
    run gh api --method PUT "repos/$REPO/rulesets/$id" --input "$file"
  else
    echo '#   present →'
    show gh api --method PUT "repos/$REPO/rulesets/$id" --input "$file"
    echo '#   absent →'
    show gh api --method POST "repos/$REPO/rulesets" --input "$file"
  fi
}

# Adds a deployment branch or tag policy unless the environment holds it.
branch_policy() {
  local environment="$1" name="$2" type="$3" held=''
  probe_into held '' gh api "repos/$REPO/environments/$environment/deployment-branch-policies" --jq ".branch_policies[] | select(.name == \"$name\" and .type == \"$type\") | .id"
  [ "$APPLY" = 1 ] || echo '#   absent →'
  if [ -z "$held" ]; then
    run gh api --method POST "repos/$REPO/environments/$environment/deployment-branch-policies" -f "name=$name" -f "type=$type"
  fi
}

echo "# GitHub settings for ${REPO} — the release flow (ADR 2026-11-18)"

echo '# 1. merging: squash only, the PR title as the subject and its description as the body; merged branches deleted'
run gh api --method PATCH "repos/$REPO" -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=PR_BODY -F delete_branch_on_merge=true

echo "# 2. the '${MAIN_RULESET}' ruleset: pr-title required, squash the only merge method, the rest kept"
ruleset_id_into main_id "$MAIN_RULESET" main
if [ "$APPLY" = 1 ] && [ -z "$main_id" ]; then
  echo "no ruleset named '${MAIN_RULESET}' on ${REPO} — create it first (docs/production-deploy.md)" >&2
  exit 1
fi
show gh api "repos/$REPO/rulesets/$main_id" --jq "$MAIN_BODY" '>' "$TMP/main-ruleset.json"
show gh api "repos/$REPO/rulesets/$main_id" --jq "$RELEASE_BODY" '>' "$TMP/release-ruleset.json"
if [ "$APPLY" = 1 ]; then
  gh api "repos/$REPO/rulesets/$main_id" --jq "$MAIN_BODY" >"$TMP/main-ruleset.json"
  gh api "repos/$REPO/rulesets/$main_id" --jq "$RELEASE_BODY" >"$TMP/release-ruleset.json"
fi
run gh api --method PUT "repos/$REPO/rulesets/$main_id" --input "$TMP/main-ruleset.json"

echo "# 3. '${RELEASE_RULESET}': main's rules on release/**"
ruleset_id_into release_id "$RELEASE_RULESET" release
put_or_post_ruleset "$release_id" "$TMP/release-ruleset.json"

echo "# 4. '${TAG_RULESET}': only the release App (${APP_ID}) creates, moves or deletes a v* tag"
body tag-ruleset.json '{"name":"'"$TAG_RULESET"'","target":"tag","enforcement":"active","conditions":{"ref_name":{"include":["refs/tags/v*"],"exclude":[]}},"rules":[{"type":"creation"},{"type":"update"},{"type":"deletion"}],"bypass_actors":[{"actor_id":'"$APP_ID"',"actor_type":"Integration","bypass_mode":"always"}]}'
ruleset_id_into tag_id "$TAG_RULESET" tag
put_or_post_ruleset "$tag_id" "$TMP/tag-ruleset.json"

echo '# 5. the environments: staging from main only; production from tags v* only, after the owner approves'
body staging.json '{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}'
run gh api --method PUT "repos/$REPO/environments/staging" --input "$TMP/staging.json"
branch_policy staging main branch
probe_into owner_id '<owner-user-id>' gh api "users/$OWNER" --jq .id
case "$owner_id" in
  '<owner-user-id>') ;;
  '' | *[!0-9]*) echo "cannot read the user id of ${OWNER}" >&2; exit 1 ;;
esac
body production.json '{"wait_timer":0,"prevent_self_review":false,"can_admins_bypass":false,"reviewers":[{"type":"User","id":'"$owner_id"'}],"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}'
run gh api --method PUT "repos/$REPO/environments/production" --input "$TMP/production.json"
branch_policy production 'v*' tag

echo "# 6. the release App's client ID (variable) and private key (secret)"
if [ -n "$APP_CLIENT_ID" ]; then
  run gh variable set RELEASE_APP_CLIENT_ID --repo "$REPO" --body "$APP_CLIENT_ID"
  show gh secret set RELEASE_APP_PRIVATE_KEY --repo "$REPO" '<' "$APP_KEY_FILE"
  if [ "$APPLY" = 1 ]; then gh secret set RELEASE_APP_PRIVATE_KEY --repo "$REPO" <"$APP_KEY_FILE"; fi
else
  echo '# not given: pass --release-app-client-id <Iv…> --release-app-key-file <app.pem>, or set them in Settings → Secrets and variables → Actions:'
  show gh variable set RELEASE_APP_CLIENT_ID --repo "$REPO" --body '<client-id>'
  show gh secret set RELEASE_APP_PRIVATE_KEY --repo "$REPO" '<' '<app.pem>'
fi

if [ "$APPLY" = 0 ]; then
  echo "# dry run: nothing ran against ${REPO}. Re-run with --apply --release-app-id <id> to apply."
fi
