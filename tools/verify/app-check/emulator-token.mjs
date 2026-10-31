/**
 * The App Check tokens the Node journeys present to the Functions emulator
 * (security hardening S-L-4, S-RU-26) — `verify-app-check.mjs` and
 * `verify-p0.mjs` build them here, and nowhere else.
 *
 * The Functions emulator decodes an App Check token WITHOUT verifying it
 * (`skipTokenVerification`, firebase-functions
 * `lib/common/providers/https.js` `unsafeDecodeAppCheckToken`):
 *
 * - {@link emulatorAppCheckToken} — unsigned and JWT-shaped,
 *   `{"alg":"none"}` . `{"sub": appId}` . an empty signature, each part
 *   base64url: the emulator reads it `VALID` (`app_id` = `sub`), the same
 *   shape the web's `CustomProvider` presents under the emulators
 *   (`emulatorAppCheckToken` of
 *   `libs/infrastructure/firebase-app/src/lib/app-check.provider.ts`).
 *   Every real verifier refuses it.
 * - {@link invalidAppCheckToken} — JWT-shaped, but its payload segment is
 *   base64url `null`: the decoder reads `.sub` of `null`, throws, and the
 *   platform reads the header `INVALID` (plan §0.4 item 1) — the only
 *   INVALID the emulator can observe.
 *
 * Both are built at run time, never written as literals: gitleaks' JWT
 * rule binds the pre-commit hook, and `emulator-token.spec.mjs` proves no
 * source under `tools/verify` holds one.
 */

/** The header a callable reads its App Check token from (firebase-functions `checkAppCheckToken`). */
export const APP_CHECK_HEADER = 'X-Firebase-AppCheck';

/** The app the journeys' token names — no registered app: the emulator only copies `sub` into `app_id`. */
export const JOURNEY_APP_ID = 'demo-creativo-test-verify-tools';

/** `value` as JSON in base64url, unpadded — one JWT segment. */
function segment(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** The emulator's App Check token for `appId`: unsigned, JWT-shaped, `sub` = `appId`. */
export function emulatorAppCheckToken(appId) {
  return `${segment({ alg: 'none' })}.${segment({ sub: appId })}.`;
}

/** A JWT-shaped token whose payload is base64url `null` — the emulator reads it `INVALID`. */
export function invalidAppCheckToken() {
  return `${segment(null)}.${segment(null)}.`;
}
