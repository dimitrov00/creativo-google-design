import { expr, projectID } from 'firebase-functions/params';

/**
 * The id of the account every function runs as (ADR
 * `docs/architecture/decisions/2026-11-19-functions-runtime-identity.md`,
 * I1): a dedicated, least-privilege account that
 * `tools/ops/deploy-identity.sh` creates in each project and grants exactly
 * what the adapters call, never the default compute account and its Editor
 * role. The same id as `RUNTIME_SERVICE_ACCOUNT_ID` in `tools/ops/names.env`;
 * `tools/verify/ops/ops-scripts.spec.mjs` holds the two equal.
 */
export const FUNCTIONS_SERVICE_ACCOUNT_ID = 'creativo-functions';

/**
 * The runtime account's full address in the project being deployed, set
 * once for every export through `setGlobalOptions` in `main.ts`. The deploy
 * reads it as `creativo-functions@{{ params.PROJECT_ID }}.iam.gserviceaccount.com`
 * and firebase-tools resolves it per project, so the project id stays
 * configuration. Never the `creativo-functions@` shorthand: firebase-tools
 * expands that for the function itself but hands it to Cloud Scheduler
 * unexpanded as the job's OIDC account (`lib/gcp/cloudscheduler.js`,
 * `jobFromEndpoint`), which would break every `onSchedule` job.
 */
export const FUNCTIONS_SERVICE_ACCOUNT = expr`${FUNCTIONS_SERVICE_ACCOUNT_ID}@${projectID}.iam.gserviceaccount.com`;
