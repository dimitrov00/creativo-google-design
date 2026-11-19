#!/usr/bin/env bash
# The deploy identity of one environment's project — Workload Identity
# Federation for this repository's GitHub Actions, never a JSON key (ADR
# docs/architecture/decisions/2026-11-18-releases-and-environments.md, E8,
# E9; docs/production-deploy.md «Environments and releases»).
#
#   tools/ops/deploy-identity.sh [--project <id>] [--environment staging|production] [--remove-default-editor]   # dry run
#   tools/ops/deploy-identity.sh --project <id> --environment <env> --apply [--repo <owner/name>] [--remove-default-editor]
#
# Run once per project, by the owner, after the project is on Blaze with its
# (default) Firestore database, its default Storage bucket and the four
# runtime secrets (WALKIN_ID_KEY, LOG_DIGEST_KEY, OTP_POSTMARK_TOKEN,
# OTP_EMAIL_FROM) in place. In order:
#   0. the APIs the deploy and the identity need — Compute Engine's among
#      them, which creates the default compute account (the account Cloud
#      Build builds the functions as) in a project that has none yet, and
#      Cloud Billing's, which every functions deploy reads (the deploy
#      account may not turn an API on);
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
#   6. its roles — what firebase-tools 15 deploys with (Hosting, rules and
#      the default Storage bucket's read, its metadata included,
#      indexes and TTL, functions gen 2 with the Cloud Run invoker, Cloud
#      Scheduler, Secret Manager and Artifact Registry read) and what the
#      preflight reads (Firestore, the API checks, P9's logging);
#   7. the build account — the default compute account, which Cloud Build
#      builds the functions as (firebase-tools names no build account):
#      waited for until step 0 has created it, the deploy account's actAs
#      on it, and Cloud Run Builder, the one role a build needs (ADR
#      docs/architecture/decisions/2026-11-19-functions-runtime-identity.md,
#      I4);
#   7a. the functions' runtime account (RUNTIME_SERVICE_ACCOUNT_ID, ADR
#      2026-11-19, I1–I2), which every function runs as: created or
#      updated, the deploy account's actAs on it, its Token Creator role on
#      itself — `createCustomToken` signs through IAM signBlob (the Admin
#      SDK has no key file), so without it every sign-in code checks out
#      and then fails to mint the session — and exactly the roles the
#      functions call: Firestore, Auth users, App Check's verifier, log
#      writing, its triggers' invoker and receiver, and the default
#      bucket's objects (on that bucket only);
#   7b. the deploy account's actAs on the App Engine default account, when
#      the project has one — firebase-tools refuses a functions deploy
#      without it, though nothing runs as that account;
#   8. the bindings a first deploy would grant itself, so the deploy account
#      never edits the project's IAM policy: the Pub/Sub agent's token
#      creator (the agent created first: enabling the API does not create
#      it in a new project, and a binding to an absent account fails), the
#      Eventarc agent and its role (made ahead, so the role has settled
#      before the first deploy's triggers ask for it), the DEFAULT COMPUTE
#      account's run.invoker and eventarc.eventReceiver (firebase-tools'
#      first deploy of a trigger requires them of that account whatever the
#      functions run as), the Storage rules agent's Firestore role (the one
#      a --non-interactive deploy skips silently, docs/production-deploy.md
#      §3.2), and the runtime account's access to each of the four secrets;
#   9. the three GitHub Environment variables the deploy workflows read;
#  10. only with --remove-default-editor (ADR 2026-11-19, I6): Editor off
#      both default accounts, and off the default compute account what an
#      earlier run granted it as the runtime account (Token Creator on
#      itself, the four secrets). Under --apply it refuses, before removing
#      anything, while any function runs as another account than the
#      runtime account. Without the flag it prints a reminder and removes
#      nothing.
#
# Idempotent: the pool, the provider and the accounts are described first —
# an existing one is updated to the values here, an absent one created;
# IAM bindings are adds, and step 10's removals run only where the policy
# holds them. Dry run by default: no gcloud or gh command runs. --apply
# mutates; nobody runs it from an agent session.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=names.env
. "$HERE/names.env"
# shellcheck source=lib/legacy-projects.sh
. "$HERE/lib/legacy-projects.sh"
# shellcheck source=lib/least-privilege.sh
. "$HERE/lib/least-privilege.sh"

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
  # Creates <number>-compute@developer.gserviceaccount.com, the account
  # Cloud Build builds the functions as (step 7); turning the API on starts
  # no machine.
  compute.googleapis.com
  # Read only: every functions deploy asks whether the project is on Blaze
  # (firebase-tools' extensions step, even with no extension) and turns this
  # API on first if it is off — which the deploy account may not do («Permissions
  # denied enabling cloudbilling.googleapis.com», the first staging deploy,
  # 2026-11-19). The read itself needs only resourcemanager.projects.get.
  cloudbilling.googleapis.com
)

DEPLOY_ROLES=(
  roles/firebasehosting.admin
  roles/firebaserules.admin
  # Read-only: the storage-rules deploy reads the default bucket's name
  # (firebasestorage.defaultBucket.get) before it releases the rules.
  roles/firebasestorage.viewer
  # Bucket metadata only (storage.buckets.get, .list), never an object: the
  # default-bucket lookup also checks the bucket as the caller, and without
  # these it answers 404 «Firebase Storage has not been set up»
  # (firebase-tools #6467, #6593; the first staging deploy, 2026-11-18).
  roles/storage.bucketViewer
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

# The build account's one role (step 7): Cloud Run Builder — upload,
# download and delete the image's artifacts, write the build's logs, read
# its source object. Google's role for the account that builds Cloud Run
# functions; it replaces the account's Editor (step 10).
BUILD_ROLES=(
  roles/run.builder
)

# The runtime account's roles on the project (step 7a; ADR 2026-11-19, I2):
# what apps/functions/src calls, and nothing it does not.
RUNTIME_ROLES=(
  # Every Firestore adapter: reads, queries, writes, transactions.
  roles/datastore.user
  # auth-claims.adapter.ts (createUser, updateUser, getUserByEmail,
  # getUserByPhoneNumber, revokeRefreshTokens) and
  # firebase-auth-eraser.adapter.ts (getUser, deleteUser).
  roles/firebaseauth.admin
  # A limited-use callable consumes its App Check token through the App
  # Check API once config/app-check.json says MONITOR or ENFORCE
  # (lib/app-check.ts): granted ahead, so the flip needs no IAM change.
  roles/firebaseappcheck.tokenVerifier
  # The functions' logs — the audit trail and every alert's input: Cloud
  # Run asks it of a user-managed runtime account.
  roles/logging.logWriter
  # The identity of its Eventarc triggers and its Scheduler jobs' OIDC
  # token, which call the functions' Cloud Run services.
  roles/run.invoker
  roles/eventarc.eventReceiver
)

# The runtime account's one role on the default bucket, and only there
# (step 7a): storage-objects.adapter.ts reads, copies, lists, deletes and
# relabels objects in it, never their access policy.
RUNTIME_BUCKET_ROLE=roles/storage.objectUser

SECRETS=(WALKIN_ID_KEY LOG_DIGEST_KEY OTP_POSTMARK_TOKEN OTP_EMAIL_FROM)

usage() {
  echo 'usage: tools/ops/deploy-identity.sh [--project <id>] [--environment staging|production] [--repo <owner/name>] [--remove-default-editor] [--apply]   (a dry run without --apply)'
}

APPLY=0
REMOVE_DEFAULT_EDITOR=0
PROJECT="${PROJECT_ID:-}"
ENVIRONMENT=''
REPO=''
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --remove-default-editor) REMOVE_DEFAULT_EDITOR=1 ;;
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
# The account every function runs as (apps/functions/src/lib/runtime-account.ts).
RUNTIME="${RUNTIME_SERVICE_ACCOUNT_ID}@${PROJECT}.iam.gserviceaccount.com"
# The default compute account: the build account, which nothing runs as.
COMPUTE="${NUMBER}-compute@developer.gserviceaccount.com"
APPSPOT="${PROJECT}@appspot.gserviceaccount.com"
# The project's default Storage bucket — the one the functions'
# `getStorage().bucket()` names (FIREBASE_CONFIG's storageBucket), in a
# project created since 2024-10.
BUCKET="${PROJECT}.firebasestorage.app"
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

echo "# 7. the build account ${COMPUTE}: the default compute account, which Cloud Build builds the functions as"
# firebase-tools 15 names no build account (no buildConfig.serviceAccount),
# so Cloud Functions builds as the project's default, this account; nothing
# runs as it (ADR 2026-11-19, I4). Step 0's Compute Engine API creates it, a
# little after the enable returns: under --apply, wait for it (two minutes
# at most) before binding to it.
show gcloud iam service-accounts describe "$COMPUTE" "--project=$PROJECT"
if [ "$APPLY" = 1 ]; then
  waited=0
  until gcloud iam service-accounts describe "$COMPUTE" "--project=$PROJECT" >/dev/null 2>&1; do
    if [ "$waited" -ge 120 ]; then
      echo "the build account ${COMPUTE} is still missing two minutes after the Compute Engine API was enabled; if it was deleted, restore it (IAM → Service accounts, within 30 days) and re-run" >&2
      exit 1
    fi
    sleep 5
    waited=$((waited + 5))
  done
fi
# The deploy account acts as it: the build of every deploy runs as it.
run gcloud iam service-accounts add-iam-policy-binding "$COMPUTE" --role=roles/iam.serviceAccountUser "--member=serviceAccount:$DEPLOYER" "--project=$PROJECT"
for role in "${BUILD_ROLES[@]}"; do
  run gcloud projects add-iam-policy-binding "$PROJECT" "--member=serviceAccount:$COMPUTE" "--role=$role" --condition=None
done

echo "# 7a. the functions' runtime account ${RUNTIME}"
runtime_probe() {
  probe gcloud iam service-accounts describe "$RUNTIME" "--project=$PROJECT"
}
runtime_update() {
  run gcloud iam service-accounts update "$RUNTIME" '--display-name=Creativo functions (runtime)' "--project=$PROJECT"
}
runtime_create() {
  run gcloud iam service-accounts create "$RUNTIME_SERVICE_ACCOUNT_ID" '--display-name=Creativo functions (runtime)' "--project=$PROJECT"
}
converge runtime_probe runtime_update runtime_create
# The deploy account acts as it: every function it deploys runs as it.
run gcloud iam service-accounts add-iam-policy-binding "$RUNTIME" --role=roles/iam.serviceAccountUser "--member=serviceAccount:$DEPLOYER" "--project=$PROJECT"
# It signs its own custom tokens (verifyOtpChallenge → createCustomToken →
# IAM signBlob): Token Creator on itself, never on the project.
run gcloud iam service-accounts add-iam-policy-binding "$RUNTIME" --role=roles/iam.serviceAccountTokenCreator "--member=serviceAccount:$RUNTIME" "--project=$PROJECT"
for role in "${RUNTIME_ROLES[@]}"; do
  run gcloud projects add-iam-policy-binding "$PROJECT" "--member=serviceAccount:$RUNTIME" "--role=$role" --condition=None
done
# The default bucket's objects, on that bucket alone.
run gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" "--member=serviceAccount:$RUNTIME" "--role=$RUNTIME_BUCKET_ROLE" "--project=$PROJECT"

echo "# 7b. the App Engine default account ${APPSPOT}, which firebase-tools checks"
# Before any functions deploy, firebase-tools 15 tests actAs on this account
# and stops when it is missing («Missing permissions required for functions
# deploy … iam.serviceAccounts.ActAs on service account
# <project>@appspot.gserviceaccount.com», the first staging deploy,
# 2026-11-19), though no function here runs as it: they run as the
# account above. Firebase's setup creates it, with Editor (step 10 takes it
# away), in a project that has no App Engine app; actAs on it alone, like
# the accounts above. When the
# account is absent the check cannot read it and lets the deploy go on, so
# there is nothing to bind.
appspot_probe() {
  probe gcloud iam service-accounts describe "$APPSPOT" "--project=$PROJECT"
}
appspot_bind() {
  run gcloud iam service-accounts add-iam-policy-binding "$APPSPOT" --role=roles/iam.serviceAccountUser "--member=serviceAccount:$DEPLOYER" "--project=$PROJECT"
}
appspot_absent() {
  echo "#   no ${APPSPOT}: firebase-tools' check passes without it"
}
converge appspot_probe appspot_bind appspot_absent

echo '# 8. the bindings a first deploy would otherwise grant itself'
# Google creates the Pub/Sub service agent lazily, not when step 0 enables
# the API: in a new project the binding below would name an account that
# does not exist yet ("INVALID_ARGUMENT: Service account … does not exist").
# Creating the identity is idempotent: it returns the agent when it exists.
run gcloud beta services identity create --service=pubsub.googleapis.com "--project=$PROJECT"
# The Eventarc agent too, with its role: the first deploy creates it itself,
# but its role reaches the 2nd gen triggers only minutes later, and every
# Firestore trigger of that deploy fails «Permission denied while using the
# Eventarc Service Agent» (the first staging deploy, 2026-11-19). Made here,
# it has long settled when the first deploy runs.
run gcloud beta services identity create --service=eventarc.googleapis.com "--project=$PROJECT"
run gcloud projects add-iam-policy-binding "$PROJECT" "--member=serviceAccount:service-${NUMBER}@gcp-sa-eventarc.iam.gserviceaccount.com" --role=roles/eventarc.serviceAgent --condition=None
run gcloud projects add-iam-policy-binding "$PROJECT" "--member=serviceAccount:service-${NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com" --role=roles/iam.serviceAccountTokenCreator --condition=None
# The first deploy of a trigger into a project requires these two of the
# DEFAULT COMPUTE account, whatever the functions run as (firebase-tools'
# ensureServiceAgentRoles), and the deploy account can read the project's
# policy: a missing one would make that deploy try to write the policy and
# fail. Nothing runs as the account (ADR 2026-11-19, I4).
run gcloud projects add-iam-policy-binding "$PROJECT" "--member=serviceAccount:$COMPUTE" --role=roles/run.invoker --condition=None
run gcloud projects add-iam-policy-binding "$PROJECT" "--member=serviceAccount:$COMPUTE" --role=roles/eventarc.eventReceiver --condition=None
run gcloud projects add-iam-policy-binding "$PROJECT" "--member=serviceAccount:service-${NUMBER}@gcp-sa-firebasestorage.iam.gserviceaccount.com" --role=roles/firebaserules.firestoreServiceAgent --condition=None
for secret in "${SECRETS[@]}"; do
  run gcloud secrets add-iam-policy-binding "$secret" "--member=serviceAccount:$RUNTIME" --role=roles/secretmanager.secretAccessor "--project=$PROJECT"
done

echo "# 9. the ${ENVIRONMENT} environment's variables on ${REPO}"
run gh variable set FIREBASE_PROJECT_ID --env "$ENVIRONMENT" --repo "$REPO" --body "$PROJECT"
run gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --env "$ENVIRONMENT" --repo "$REPO" --body "$PROVIDER"
run gh variable set GCP_DEPLOY_SERVICE_ACCOUNT --env "$ENVIRONMENT" --repo "$REPO" --body "$DEPLOYER"

# A policy read, printed; whether it holds `member` in `role` — under
# --apply, what the read finds (a read that fails stops the run); in a dry
# run, yes, so the removal after it prints.
#   holds <member> <role> <get-iam-policy command…>
holds() {
  local member="$1" role="$2" policy
  shift 2
  show "$@" '--flatten=bindings[].members' '--format=value(bindings.role,bindings.members)'
  if [ "$APPLY" = 0 ]; then
    echo "#   when it holds ${role} →"
    return 0
  fi
  policy="$("$@" '--flatten=bindings[].members' '--format=value(bindings.role,bindings.members)')" || {
    echo "cannot read the policy: $*" >&2
    exit 1
  }
  if policy_holds "$policy" "$role" "$member"; then
    return 0
  fi
  echo "#   ${member#serviceAccount:} holds no ${role} there"
  return 1
}

if [ "$REMOVE_DEFAULT_EDITOR" = 1 ]; then
  echo "# 10. Editor off the default accounts — only while every function runs as ${RUNTIME}"
  # The one step that takes access away: a function still running as a
  # default account would lose Firestore, Auth and its secrets on the spot.
  # So every function must already run as the runtime account (a deploy of
  # the code whose global options name it), checked before anything goes.
  LISTED=''
  probe_into LISTED '' gcloud functions list "--project=$PROJECT" '--format=value(name.basename(),serviceConfig.serviceAccountEmail)'
  if [ "$APPLY" = 1 ]; then
    OFF="$(functions_off_account "$LISTED" "$RUNTIME")"
    if [ -n "$OFF" ]; then
      echo "refused: these functions run as another account than ${RUNTIME} — deploy them onto it first, then re-run (ADR 2026-11-19, I6):" >&2
      printf '%s\n' "$OFF" | sed 's/^/  /' >&2
      exit 1
    fi
  else
    echo "#   refused, removing nothing, unless every listed function runs as ${RUNTIME}"
  fi
  for account in "$COMPUTE" "$APPSPOT"; do
    if holds "serviceAccount:$account" roles/editor gcloud projects get-iam-policy "$PROJECT"; then
      run gcloud projects remove-iam-policy-binding "$PROJECT" "--member=serviceAccount:$account" --role=roles/editor --condition=None
    fi
  done
  # What an earlier run of this script granted the default compute account
  # as the runtime account, which no function needs of it now.
  if holds "serviceAccount:$COMPUTE" roles/iam.serviceAccountTokenCreator gcloud iam service-accounts get-iam-policy "$COMPUTE" "--project=$PROJECT"; then
    run gcloud iam service-accounts remove-iam-policy-binding "$COMPUTE" "--member=serviceAccount:$COMPUTE" --role=roles/iam.serviceAccountTokenCreator "--project=$PROJECT"
  fi
  for secret in "${SECRETS[@]}"; do
    if holds "serviceAccount:$COMPUTE" roles/secretmanager.secretAccessor gcloud secrets get-iam-policy "$secret" "--project=$PROJECT"; then
      run gcloud secrets remove-iam-policy-binding "$secret" "--member=serviceAccount:$COMPUTE" --role=roles/secretmanager.secretAccessor "--project=$PROJECT"
    fi
  done
else
  echo "# 10. the default accounts keep Editor: once every function runs as ${RUNTIME}, re-run with --remove-default-editor (docs/production-deploy.md «Environments and releases», step 7a)"
fi

if [ "$APPLY" = 0 ]; then
  echo "# dry run: nothing ran against ${PROJECT}. Re-run with --project <id> --environment ${ENVIRONMENT} --apply to apply."
fi
