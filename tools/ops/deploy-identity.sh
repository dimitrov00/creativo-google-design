#!/usr/bin/env bash
# The deploy identity of one environment's project — Workload Identity
# Federation for this repository's GitHub Actions, never a JSON key (ADR
# docs/architecture/decisions/2026-11-18-releases-and-environments.md, E8,
# E9; docs/production-deploy.md «Environments and releases»).
#
#   tools/ops/deploy-identity.sh [--project <id>] [--environment staging|production]   # dry run
#   tools/ops/deploy-identity.sh --project <id> --environment <env> --apply [--repo <owner/name>]
#
# Run once per project, by the owner, after the project is on Blaze with its
# (default) Firestore database, its default Storage bucket and the four
# runtime secrets (WALKIN_ID_KEY, LOG_DIGEST_KEY, OTP_POSTMARK_TOKEN,
# OTP_EMAIL_FROM) in place. In order:
#   0. the APIs the deploy and the identity need — Compute Engine's among
#      them, which creates the functions' runtime account (the default
#      compute one) in a project that has none yet;
#   1. the project number and the repository's numeric id (reads);
#   2. a workload identity pool (WIF_POOL_ID);
#   3. its GitHub OIDC provider (WIF_PROVIDER_ID), whose condition admits
#      only this repository (by id, which a rename or a transfer cannot
#      reuse) and only jobs of this environment — and, for production, only
#      refs/tags/v*;
#   4. the deploy service account (DEPLOY_SERVICE_ACCOUNT_ID);
#   5. who may impersonate it: only this repository's jobs in this
#      environment — the principal set of the mapped attribute
#      `repository_environment` (<repository id>/<env>), never the token's
#      subject: GitHub's immutable subjects (repo:<owner>@<id>/<name>@<id>…,
#      on by default for new repositories) differ from the classic
#      repo:<owner/name>:environment:<env>, and a repository can switch
#      between them, so a subject binding can silently stop matching;
#   6. its roles — what firebase-tools 15 deploys with (Hosting, rules,
#      indexes and TTL, functions gen 2 with the Cloud Run invoker, Cloud
#      Scheduler, Secret Manager and Artifact Registry read) and what the
#      preflight reads (Firestore, the API checks, P9's logging);
#   7. the functions' runtime account: waited for until step 0 has created
#      it, the deploy account's actAs on it alone, and the account's Token
#      Creator role on itself — `createCustomToken` signs through IAM
#      signBlob (the Admin SDK has no key file), so without it every
#      sign-in code checks out and then fails to mint the session;
#   8. the bindings a first deploy would grant itself, so the deploy account
#      never edits the project's IAM policy: the Pub/Sub agent's token
#      creator (the agent created first: enabling the API does not create
#      it in a new project, and a binding to an absent account fails),
#      the runtime account's run.invoker and eventarc.eventReceiver,
#      the Storage rules agent's Firestore role (the one a --non-interactive
#      deploy skips silently, docs/production-deploy.md §3.2), and the
#      runtime account's access to each of the four secrets;
#   9. the three GitHub Environment variables the deploy workflows read.
#
# Idempotent: the pool, the provider and the account are described first —
# an existing one is updated to the values here, an absent one created;
# IAM bindings are adds. Dry run by default: no gcloud or gh command runs.
# --apply mutates; nobody runs it from an agent session.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=names.env
. "$HERE/names.env"
# shellcheck source=lib/legacy-projects.sh
. "$HERE/lib/legacy-projects.sh"

APIS=(
  iam.googleapis.com
  iamcredentials.googleapis.com
  sts.googleapis.com
  cloudresourcemanager.googleapis.com
  serviceusage.googleapis.com
  firebase.googleapis.com
  firebasehosting.googleapis.com
  firebaserules.googleapis.com
  firestore.googleapis.com
  cloudfunctions.googleapis.com
  run.googleapis.com
  cloudbuild.googleapis.com
  artifactregistry.googleapis.com
  eventarc.googleapis.com
  pubsub.googleapis.com
  cloudscheduler.googleapis.com
  secretmanager.googleapis.com
  logging.googleapis.com
  # Creates <number>-compute@developer.gserviceaccount.com, the account the
  # functions run as (step 7); turning the API on starts no machine.
  compute.googleapis.com
)

DEPLOY_ROLES=(
  roles/firebasehosting.admin
  roles/firebaserules.admin
  roles/datastore.indexAdmin
  roles/datastore.viewer
  roles/cloudfunctions.admin
  roles/run.admin
  roles/cloudscheduler.admin
  roles/secretmanager.viewer
  roles/artifactregistry.reader
  roles/serviceusage.serviceUsageConsumer
  roles/serviceusage.serviceUsageViewer
  roles/logging.viewer
)

SECRETS=(WALKIN_ID_KEY LOG_DIGEST_KEY OTP_POSTMARK_TOKEN OTP_EMAIL_FROM)

usage() {
  echo 'usage: tools/ops/deploy-identity.sh [--project <id>] [--environment staging|production] [--repo <owner/name>] [--apply]   (a dry run without --apply)'
}

APPLY=0
PROJECT="${PROJECT_ID:-}"
ENVIRONMENT=''
REPO=''
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --project) PROJECT="${2:?--project needs an id}"; shift ;;
    --project=*) PROJECT="${1#*=}" ;;
    --environment) ENVIRONMENT="${2:?--environment needs staging or production}"; shift ;;
    --repo) REPO="${2:?--repo needs owner/name}"; shift ;;
    -h | --help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done
refuse_legacy_project "$PROJECT"
case "$ENVIRONMENT" in
  staging | production) ;;
  '') [ "$APPLY" = 1 ] && { echo "--apply needs --environment staging|production" >&2; exit 2; }
      ENVIRONMENT=production ;;
  *) echo "--environment must be staging or production, got: $ENVIRONMENT" >&2; exit 2 ;;
esac
if [ "$APPLY" = 1 ] && [ -z "$PROJECT" ]; then
  echo "--apply needs --project <id> (or PROJECT_ID)" >&2
  exit 2
fi
PROJECT="${PROJECT:-your-project-id}"
if [ -z "$REPO" ]; then
  origin="$(git -C "$HERE" remote get-url origin 2>/dev/null || true)"
  REPO="$(printf '%s' "$origin" | sed -nE 's#^(https://github\.com/|git@github\.com:)([^/]+/[^/]+)$#\2#p' | sed 's/\.git$//')"
fi
REPO="${REPO:-OWNER/REPO}"
if [ "$APPLY" = 1 ] && [ "$REPO" = OWNER/REPO ]; then
  echo "--apply needs --repo <owner/name> (no github.com origin to read it from)" >&2
  exit 2
fi

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

# A read whose answer the next steps need, into the variable `var`:
# printed; under --apply, its output (in a dry run, `placeholder`).
probe_into() {
  local var="$1" placeholder="$2" value
  shift 2
  show "$@"
  value="$placeholder"
  if [ "$APPLY" = 1 ]; then value="$("$@")"; fi
  printf -v "$var" '%s' "$value"
}

# What the probes read (probe_into assigns them by name).
NUMBER=''
REPO_ID=''

echo "# The deploy identity of ${PROJECT} (${ENVIRONMENT}) — Workload Identity Federation for ${REPO}"

echo '# 0. the APIs'
run gcloud services enable "${APIS[@]}" "--project=$PROJECT"

echo '# 1. the project number and the repository id'
probe_into NUMBER PROJECT_NUMBER gcloud projects describe "$PROJECT" '--format=value(projectNumber)'
probe_into REPO_ID REPOSITORY_ID gh api "repos/$REPO" --jq .id
if [ "$APPLY" = 1 ]; then
  case "$NUMBER$REPO_ID" in
    '' | *[!0-9]*) echo "cannot read the project number or the repository id" >&2; exit 1 ;;
  esac
fi

POOL="projects/${NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL_ID}"
PROVIDER="${POOL}/providers/${WIF_PROVIDER_ID}"
DEPLOYER="${DEPLOY_SERVICE_ACCOUNT_ID}@${PROJECT}.iam.gserviceaccount.com"
RUNTIME="${NUMBER}-compute@developer.gserviceaccount.com"
# The one attribute step 5 binds: the repository's id and the environment,
# both of which the condition below also requires.
MAPPING="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.environment=assertion.environment,attribute.ref=assertion.ref,attribute.repository_environment=assertion.repository_id+'/'+assertion.environment"
IMPERSONATORS="principalSet://iam.googleapis.com/${POOL}/attribute.repository_environment/${REPO_ID}/${ENVIRONMENT}"
CONDITION="assertion.repository_id == '${REPO_ID}' && assertion.environment == '${ENVIRONMENT}'"
if [ "$ENVIRONMENT" = production ]; then
  CONDITION="${CONDITION} && assertion.ref.startsWith('refs/tags/v')"
else
  CONDITION="${CONDITION} && assertion.ref == 'refs/heads/main'"
fi

echo "# 2. the pool ${WIF_POOL_ID}"
pool_probe() {
  probe gcloud iam workload-identity-pools describe "$WIF_POOL_ID" --location=global "--project=$PROJECT"
}
pool_update() {
  run gcloud iam workload-identity-pools update "$WIF_POOL_ID" --location=global '--display-name=GitHub Actions' "--project=$PROJECT"
}
pool_create() {
  run gcloud iam workload-identity-pools create "$WIF_POOL_ID" --location=global '--display-name=GitHub Actions' "--project=$PROJECT"
}
converge pool_probe pool_update pool_create

echo "# 3. the provider ${WIF_PROVIDER_ID}: this repository's ${ENVIRONMENT} jobs only"
provider_probe() {
  probe gcloud iam workload-identity-pools providers describe "$WIF_PROVIDER_ID" --location=global "--workload-identity-pool=$WIF_POOL_ID" "--project=$PROJECT"
}
provider_update() {
  run gcloud iam workload-identity-pools providers update-oidc "$WIF_PROVIDER_ID" --location=global "--workload-identity-pool=$WIF_POOL_ID" "--attribute-mapping=$MAPPING" "--attribute-condition=$CONDITION" "--project=$PROJECT"
}
provider_create() {
  run gcloud iam workload-identity-pools providers create-oidc "$WIF_PROVIDER_ID" --location=global "--workload-identity-pool=$WIF_POOL_ID" '--issuer-uri=https://token.actions.githubusercontent.com' "--attribute-mapping=$MAPPING" "--attribute-condition=$CONDITION" "--project=$PROJECT"
}
converge provider_probe provider_update provider_create

echo "# 4. the deploy service account ${DEPLOYER}"
account_probe() {
  probe gcloud iam service-accounts describe "$DEPLOYER" "--project=$PROJECT"
}
account_update() {
  run gcloud iam service-accounts update "$DEPLOYER" '--display-name=Creativo deploy (GitHub Actions)' "--project=$PROJECT"
}
account_create() {
  run gcloud iam service-accounts create "$DEPLOY_SERVICE_ACCOUNT_ID" '--display-name=Creativo deploy (GitHub Actions)' "--project=$PROJECT"
}
converge account_probe account_update account_create

echo "# 5. who may impersonate it: repository ${REPO_ID}'s ${ENVIRONMENT} jobs"
run gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER" --role=roles/iam.workloadIdentityUser "--member=$IMPERSONATORS" "--project=$PROJECT"

echo '# 6. its roles on the project'
for role in "${DEPLOY_ROLES[@]}"; do
  run gcloud projects add-iam-policy-binding "$PROJECT" "--member=serviceAccount:$DEPLOYER" "--role=$role" --condition=None
done

echo "# 7. the functions' runtime account ${RUNTIME}"
# Step 0's Compute Engine API creates it, a little after the enable returns:
# under --apply, wait for it (two minutes at most) before binding to it.
show gcloud iam service-accounts describe "$RUNTIME" "--project=$PROJECT"
if [ "$APPLY" = 1 ]; then
  waited=0
  until gcloud iam service-accounts describe "$RUNTIME" "--project=$PROJECT" >/dev/null 2>&1; do
    if [ "$waited" -ge 120 ]; then
      echo "the runtime account ${RUNTIME} is still missing two minutes after the Compute Engine API was enabled; if it was deleted, restore it (IAM → Service accounts, within 30 days) and re-run" >&2
      exit 1
    fi
    sleep 5
    waited=$((waited + 5))
  done
fi
# The deploy account may act as this account and no other.
run gcloud iam service-accounts add-iam-policy-binding "$RUNTIME" --role=roles/iam.serviceAccountUser "--member=serviceAccount:$DEPLOYER" "--project=$PROJECT"
# It signs its own custom tokens (verifyOtpChallenge → createCustomToken →
# IAM signBlob): Token Creator on itself, never on the project.
run gcloud iam service-accounts add-iam-policy-binding "$RUNTIME" --role=roles/iam.serviceAccountTokenCreator "--member=serviceAccount:$RUNTIME" "--project=$PROJECT"

echo '# 8. the bindings a first deploy would otherwise grant itself'
# Google creates the Pub/Sub service agent lazily, not when step 0 enables
# the API: in a new project the binding below would name an account that
# does not exist yet ("INVALID_ARGUMENT: Service account … does not exist").
# Creating the identity is idempotent: it returns the agent when it exists.
run gcloud beta services identity create --service=pubsub.googleapis.com "--project=$PROJECT"
run gcloud projects add-iam-policy-binding "$PROJECT" "--member=serviceAccount:service-${NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com" --role=roles/iam.serviceAccountTokenCreator --condition=None
run gcloud projects add-iam-policy-binding "$PROJECT" "--member=serviceAccount:$RUNTIME" --role=roles/run.invoker --condition=None
run gcloud projects add-iam-policy-binding "$PROJECT" "--member=serviceAccount:$RUNTIME" --role=roles/eventarc.eventReceiver --condition=None
run gcloud projects add-iam-policy-binding "$PROJECT" "--member=serviceAccount:service-${NUMBER}@gcp-sa-firebasestorage.iam.gserviceaccount.com" --role=roles/firebaserules.firestoreServiceAgent --condition=None
for secret in "${SECRETS[@]}"; do
  run gcloud secrets add-iam-policy-binding "$secret" "--member=serviceAccount:$RUNTIME" --role=roles/secretmanager.secretAccessor "--project=$PROJECT"
done

echo "# 9. the ${ENVIRONMENT} environment's variables on ${REPO}"
run gh variable set FIREBASE_PROJECT_ID --env "$ENVIRONMENT" --repo "$REPO" --body "$PROJECT"
run gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --env "$ENVIRONMENT" --repo "$REPO" --body "$PROVIDER"
run gh variable set GCP_DEPLOY_SERVICE_ACCOUNT --env "$ENVIRONMENT" --repo "$REPO" --body "$DEPLOYER"

if [ "$APPLY" = 0 ]; then
  echo "# dry run: nothing ran against ${PROJECT}. Re-run with --project <id> --environment ${ENVIRONMENT} --apply to apply."
fi
