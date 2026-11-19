# The functions' runtime identity: least privilege (2026-11-19)

> **Status: DECIDED, built; the owner applies it.** The owner delegated
> these decisions (2026-10-26, the rubric of `2026-10-26-owner-rulings.md`).
> The PR changes the functions' global options, the deploy identity script
> (`tools/ops/deploy-identity.sh`) and the checklist. The owner runs the
> script against staging first, then production
> (`docs/production-deploy.md`, «Environments and releases», steps 6 and
> 7a). Nothing here has been applied to a project yet.

## The problem

A read-only check of `creativo-v2-staging` on 2026-11-19 (the project's IAM
policy, its service accounts and its 68 functions) found:

- **`<number>-compute@developer.gserviceaccount.com` holds `roles/editor`.**
  Every function runs as it (`serviceConfig.serviceAccountEmail`). Every
  build also runs as it: its `buildConfig.serviceAccount` names this
  account, and so does `gcloud builds get-default-service-account`. That
  account is the build default for projects created since July 2024.
- **`<project>@appspot.gserviceaccount.com` holds `roles/editor`.** Nothing
  runs as it. Firebase's setup created it.
- Both grants are Google's legacy automatic grant to default accounts. No
  organization policy turns that grant off, because the projects belong to
  a personal account with no organization.
- **The deploy account may act as both** (steps 7 and 7b of the script).
  firebase-tools tests actAs on the App Engine account before every
  functions deploy and refuses to deploy without it (`checkServiceAccountIam`,
  firebase-tools 15.36.0 `lib/deploy/functions/checkIam.js`).

So anyone who can deploy a function (this repository's staging or
production jobs) can run code as the project's Editor. That reaches almost
every resource in the project, not only the app's own data. Production
(`creativo-v2-prod`) does not exist yet, so it can start without the grant.

## Decisions

| #   | Question                                       | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | Which account do the functions run as?         | **A dedicated one, `creativo-functions@<project>.iam.gserviceaccount.com`** (`RUNTIME_SERVICE_ACCOUNT_ID` in `tools/ops/names.env`). The deploy identity script creates it. Every export runs as it: `setGlobalOptions({ region, serviceAccount })` in `apps/functions/src/main.ts`, with the value from `apps/functions/src/lib/runtime-account.ts`. The address is written as ``expr`creativo-functions@${projectID}.iam.gserviceaccount.com` ``. The deploy reads that as `creativo-functions@{{ params.PROJECT_ID }}.iam.gserviceaccount.com` and resolves it for each project, so the project id stays configuration. It is never the `creativo-functions@` shorthand. firebase-tools expands the shorthand for the function itself, but hands it unexpanded to Cloud Scheduler as the job's OIDC account (`lib/gcp/cloudscheduler.js`, `jobFromEndpoint`), which would break the scheduled functions. `main.spec.ts` pins the text (`PLATFORM`), and `tools/verify/ops/ops-scripts.spec.mjs` holds the id equal to `names.env`. |
| I2  | What does it hold?                             | Exactly what the code calls (table below), each grant on the narrowest resource that works: the one bucket, its own account, the four secrets. Nothing else.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| I3  | What does it not hold, and why?                | See «Not granted» below. In short: no Auth custom role, no Storage role beyond objects in one bucket, no metric or trace writer, no Service Usage role, no Firestore admin.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| I4  | And the default compute account?               | **It stays the build account and gets `roles/run.builder` in place of Editor.** firebase-tools 15.36.0 sends no `buildConfig.serviceAccount` (`lib/gcp/cloudfunctionsv2.js`), so Cloud Functions builds as the project's default build account, which is this one. `roles/run.builder` is Google's role for building Cloud Run functions: upload, download and delete artifacts, write logs, read source objects. The account keeps `roles/run.invoker` and `roles/eventarc.eventReceiver`, though nothing runs as it. The first deploy of an event-triggered function into a project requires those two bindings for the default compute account, whatever the functions run as (`ensureServiceAgentRoles` → `obtainDefaultComputeServiceAgentBindings`). The deploy account can read the project's policy (`roles/cloudfunctions.admin` carries `resourcemanager.projects.getIamPolicy`), so if a binding is missing the deploy tries to write the policy and fails.                                                                |
| I5  | Which accounts may the deploy account act as?  | **Three, each by name:** the runtime account (to deploy functions that run as it), the default compute account (the build runs as it) and the App Engine default account (firebase-tools' check, E8). Once I6 has run, the two default accounts hold none of the app's data, so acting as them gives only the builder, invoker and event-receiver roles, or nothing. Google's docs do not say whether Cloud Functions needs actAs on the default build account. Dropping that binding is a cheap follow-up to test on staging.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| I6  | How does Editor come off the default accounts? | **The owner runs a separate, guarded step:** `tools/ops/deploy-identity.sh --remove-default-editor`. It removes Editor from both default accounts. From the default compute account it also removes what the earlier script granted it as the runtime: Token Creator on itself and the four secrets. Under `--apply` it first lists the project's functions, and refuses while any of them runs as an account other than the runtime account, so it never takes access from a running function. Each removal checks the policy first, so a second run changes nothing. It is a flag, not a step of every run: removing access is the one act in this script that can break a running environment, so the owner chooses it after reading its dry run.                                                                                                                                                                                                                                                                                  |
| I7  | In what order?                                 | **Staging:** (1) run the script (the account and its grants) **before** this PR merges, because the merge deploys staging with the new account and that deploy fails if the account is missing; (2) merge, and check staging; (3) `--remove-default-editor`; (4) re-run the staging deploy, which proves a build without Editor, then run section 4's checks. **Production:** the whole script with the flag at setup, before the first release, so its first deploy never runs with Editor. **Rollback:** re-add the binding (`gcloud projects add-iam-policy-binding <id> --member=serviceAccount:<account> --role=roles/editor --condition=None`). For the runtime account, revert the `serviceAccount` line; the functions then run as the default compute account again, which needs its old grants back.                                                                                                                                                                                                                        |
| I8  | What does deploying amount to now?             | **The runtime account's reach plus the build's.** That is every document, every Auth user, every object in the default bucket and the four secrets: all of the app's data. This is inherent, because whoever ships the code decides what it does with what it can reach. What goes is the rest of the project: a deploy can no longer create, change or delete other resources, or act as any other account. The gate in front of a deploy stays where E8 put it: only this repository's jobs of that environment, and for production only a `v*` tag after the owner approves.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### What the runtime account holds

| Role                                   | On                                                            | Why: the call that needs it                                                                                                                                                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roles/datastore.user`                 | the project                                                   | Every Firestore adapter in `apps/functions/src/adapters/`: reads, queries, writes and transactions on `(default)`.                                                                                                                                              |
| `roles/firebaseauth.admin`             | the project                                                   | `auth-claims.adapter.ts`: `createUser`, `updateUser`, `getUserByEmail`, `getUserByPhoneNumber`, `revokeRefreshTokens`. `firebase-auth-eraser.adapter.ts`: `getUser`, `deleteUser`.                                                                              |
| `roles/iam.serviceAccountTokenCreator` | **itself** only                                               | `createCustomToken` (`verifyOtpChallenge`) signs through IAM `signBlob`, because the Admin SDK has no key file.                                                                                                                                                 |
| `roles/storage.objectUser`             | **the default bucket** only (`<project>.firebasestorage.app`) | `storage-objects.adapter.ts`: `getMetadata`, `copy`, `delete`, `getFiles({ prefix })`, `setMetadata`. These cover the photo hand-off, the erasure and the label clearing.                                                                                       |
| `roles/secretmanager.secretAccessor`   | **each of the four secrets** only                             | `defineSecret`: `WALKIN_ID_KEY`, `LOG_DIGEST_KEY`, `OTP_POSTMARK_TOKEN`, `OTP_EMAIL_FROM`.                                                                                                                                                                      |
| `roles/firebaseappcheck.tokenVerifier` | the project                                                   | Replay protection. Once `config/app-check.json` says `MONITOR` or `ENFORCE`, a limited-use callable consumes its token through the App Check API (`verifyAppCheckToken`, `lib/app-check.ts`). Granted now, so the staged App Check rollout needs no IAM change. |
| `roles/logging.logWriter`              | the project                                                   | Cloud Run asks this role of a user-managed runtime account to write the function's logs. Those logs are the audit trail and the input of every alert (`tools/ops/alerts/`).                                                                                     |
| `roles/run.invoker`                    | the project                                                   | The account is the identity of its Eventarc triggers and of the Scheduler jobs' OIDC token. Both call the functions' Cloud Run services. firebase-tools copies the runtime account into `eventTrigger.serviceAccountEmail`.                                     |
| `roles/eventarc.eventReceiver`         | the project                                                   | The identity of its Eventarc (Firestore) triggers.                                                                                                                                                                                                              |

### Not granted

- **A custom role narrower than Firebase Authentication Admin** (users only,
  without `firebaseauth.configs.*`): considered, and declined. Code running
  as this account can already mint a custom token with any claims for any
  user, which is total control of the app, so Auth's configuration adds no
  reach. A custom role is also one more list to keep in step with Google's
  permissions.
- **`roles/storage.objectAdmin`** (object ACLs and IAM on top of the object
  role) and **any project-wide Storage role**: the functions touch one
  bucket's objects, never their access policy.
- **`roles/monitoring.metricWriter`** and **`roles/cloudtrace.agent`**: no
  code writes a metric or a trace. The alerts use logs-based metrics, which
  Cloud Logging computes from the log entries.
- **`roles/serviceusage.serviceUsageConsumer`**: a service account calling
  APIs in its own project needs none.
- **Firestore administration** (indexes, TTL, backups, exports): the deploy
  account and the owner's `tools/ops` scripts do these.
- **Firebase's declarative roles** (`declaredRoles` in firebase-functions
  7.4.0's `security/roles`): the deploy then creates a `firebase-fn-…`
  account itself and writes the project's IAM policy to grant it the
  declared roles (firebase-tools 15.36.0 `prepare.js` tests
  `resourcemanager.projects.setIamPolicy`; `release/fabricator.js` creates
  the account). The deploy account would need the right to edit the
  project's IAM policy, which is more than Editor and exactly what E8 keeps
  from it. The script grants the same narrow list once, as the owner.

## Why a dedicated account, and not only stripping Editor

- **Stripping Editor alone** would leave the default compute account doing
  two jobs at once: the app's identity and every build's. Each build step
  would then run with the app's data access, and any future service created
  in the project with default settings (a VM, a Cloud Run service, a build)
  would run as the app. Stripping alone also needs `run.builder` on the
  account anyway, or every build breaks the moment Editor goes.
- **A dedicated account alone** leaves Editor on the build account. The
  deploy account still acts as that account, so the escalation survives.
- **Both** gives each account one job with a short, reviewable list. Only
  this combination closes the gap.

## Consequences

- `tools/ops/deploy-identity.sh` creates the runtime account and its
  grants, gives the build account `roles/run.builder`, and has a separate
  `--remove-default-editor` flag. Its dry run prints every binding.
  `tools/verify/ops/ops-scripts.spec.mjs` pins them.
- Every function's endpoint names the runtime account. The first staging
  deploy after the merge moves all 68 functions onto it in place, and their
  Eventarc triggers with them (firebase-tools copies the runtime account
  into each trigger). No function is deleted.
- **Staging's existing Scheduler jobs keep the default compute account as
  the identity of their OIDC token.** firebase-tools rewrites an existing
  job only when its schedule, time zone, deadline or retry changes
  (`needUpdate`, `lib/gcp/cloudscheduler.js`), never for its account. They
  keep working, because that account keeps `roles/run.invoker` (I4); the
  token only lets the job call the function, which still runs as the
  runtime account. A new project's jobs (production) are created with the
  runtime account.
- The App Check rollout no longer has the owner grant the verifier role
  by hand (`docs/production-deploy.md`, «App Check», step 1).
- E8's description of the runtime account (the default compute account)
  is superseded by I1 and I4.

## Not decided here

- **`firebase-adminsdk-fbsvc@<project>.iam.gserviceaccount.com`**, Firebase's
  own Admin SDK account, holds project-wide Token Creator, Storage Admin and
  Firebase Authentication Admin. Nothing in this repository uses it, and
  only an Owner may act as it. A key created for it would be the one key in
  the project, so checking that it has none
  (`gcloud iam service-accounts keys list --iam-account <it> --managed-by=user`)
  belongs to the owner's review.
- **Disabling the App Engine default account** once it holds nothing. It
  is unverified whether firebase-tools' actAs test still passes on a
  disabled account, so the account is kept, without Editor.
- **A build account of its own**, once firebase-tools sets
  `buildConfig.serviceAccount`.
