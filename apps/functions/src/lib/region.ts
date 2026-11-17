/**
 * The region every function runs in (ADR
 * `docs/architecture/decisions/2026-11-18-europe-west8-region.md`): Milan,
 * the nearest Tier 1 region to the shop's clients in Bulgaria, and the
 * Firestore database's own location — a Firestore trigger must sit in the
 * database's location, and a callable's transaction should not cross a
 * continent. Set once for every export, through `setGlobalOptions` in
 * `main.ts`.
 *
 * The web's callable client names the same region
 * (`libs/infrastructure/firebase-app/src/lib/firebase-app.provider.ts`), and
 * the CSP's callables host follows it (`tools/verify/csp/check-csp.mjs`,
 * `firebase.json`): `tools/verify/csp/functions-region.spec.mjs` holds the
 * copies equal.
 */
export const FUNCTIONS_REGION = 'europe-west8';
