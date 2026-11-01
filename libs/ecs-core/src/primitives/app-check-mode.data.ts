/**
 * The App Check switch (security hardening S-WS-A, S-RU-19, S-L-1) — the
 * field `appCheckMode`, the ONLY source of these strings. The owner flips it
 * at deploy: `config/app-check.json` → the functions param `APP_CHECK_MODE`,
 * read per call by the callable edge (`AppCheckModePorts`). Staged so a
 * rollout can never lock out the current build: OFF (shipped for staging
 * and production), MONITOR (measure), ENFORCE (refuse). Rollback is `OFF`
 * plus a functions-only deploy.
 */
export const AppCheckMode = {
  /** Inert: nothing read, reported, consumed or refused — the shipped production value. */
  Off: 'OFF',
  /** Every callable's outcome reported and limited-use tokens consumed; nothing refused. */
  Monitor: 'MONITOR',
  /** MONITOR, and a request without a valid token is refused (`APP_CHECK_REQUIRED`). */
  Enforce: 'ENFORCE',
} as const;
export type AppCheckMode = (typeof AppCheckMode)[keyof typeof AppCheckMode];
