import type { CallableRequest } from 'firebase-functions/v2/https';
import {
  type Expression,
  defineString,
  select,
} from 'firebase-functions/params';
import { AppCheckMode, AppCheckTokenUse, StoredFields } from '@core/primitives';
import { CALLABLE_APP_CHECK_TOKEN, type CallableName } from '@core/ports';
import type { AppCheckFacts } from '@core/systems';

/**
 * THE App Check switch (security hardening S-WS-A, S-RU-19, S-L-1) — ONE
 * string param the owner flips at deploy. Its value comes from
 * `dist/apps/functions/.env.<projectId>` (and `.env.local` under the
 * emulators), which `tools/flags/write-functions-env.mjs` writes from
 * `config/app-check.json` after the build: OFF (shipped for staging and
 * production), MONITOR (every outcome reported, limited-use tokens
 * consumed, nothing refused), ENFORCE (refuse). Rollback is `OFF` plus a
 * functions-only deploy.
 *
 * Read per call, never at module load (the `flags.ts` rule) — by the edge's
 * adapter (`app-check.adapter.ts`), the one reader of `.value()`. An UNSET
 * variable reads `''`, not the declared default
 * (`firebase-functions/lib/params/types.js` `StringParam.runtimeValue`), so
 * every reader treats `''` as OFF — never `notEquals('OFF')`, which `''`
 * satisfies.
 *
 * The platform's own enforcement option is never set (S-RU-17): it refuses
 * before the handler with a bare `unauthenticated`, no coded refusal and no
 * outcome line of ours, and has no MONITOR state. The library still
 * verifies every presented token and sets `request.app`; the edge decides.
 */
export const APP_CHECK_MODE = defineString('APP_CHECK_MODE', {
  default: AppCheckMode.Off,
  description: 'App Check: OFF | MONITOR | ENFORCE (config/app-check.json)',
  input: select(Object.values(AppCheckMode)),
});

/**
 * Consume while the switch is MONITOR or ENFORCE — false for `''` (unset),
 * OFF and any unknown value. Resolved by the platform AT DEFINITION
 * (`v2/providers/https.js`: `consumeAppCheckToken.value()` inside `onCall`),
 * i.e. at each instance's load, when the runtime env holds the deployed
 * value — the one sanctioned definition-time read of the switch. MONITOR
 * consumes too, so it measures exactly the replays ENFORCE will refuse.
 */
const CONSUME_WHILE_ON: Expression<boolean> = APP_CHECK_MODE.equals(
  AppCheckMode.Monitor,
).thenElse<boolean>(true, APP_CHECK_MODE.equals(AppCheckMode.Enforce));

/** The replay protection a callable's options carry: the consuming expression, or nothing. */
export type ReplayProtection = {
  readonly consumeAppCheckToken?: Expression<boolean>;
};

/** No platform App Check option — a STANDARD callable's options stay exactly as they were. */
const STANDARD_TOKEN: ReplayProtection = {};

/**
 * The platform options of one callable's App Check token, spread into its
 * `onCall` options: a `LIMITED_USE` callable
 * (`CALLABLE_APP_CHECK_TOKEN`, the one table the web reads too) consumes
 * its token while the switch is on ({@link CONSUME_WHILE_ON}); every other
 * callable gets nothing. The platform refuses no replay itself — it only
 * reports `alreadyConsumed` — so the edge refuses one under ENFORCE.
 */
export function replayProtectedOptions(name: CallableName): ReplayProtection {
  // eslint-disable-next-line security/detect-object-injection -- `name` is a closed `CallableName` literal and the table is total over it.
  return CALLABLE_APP_CHECK_TOKEN[name] === AppCheckTokenUse.LimitedUse
    ? { consumeAppCheckToken: CONSUME_WHILE_ON }
    : STANDARD_TOKEN;
}

/** The header a client's App Check token rides in, as Node lower-cases it. */
const APP_CHECK_HEADER = 'x-firebase-appcheck';

/**
 * Whether the request carried an App Check header — its PRESENCE, never its
 * value: an own property of the raw request's headers that is not the
 * empty string (the platform reads an empty header as no header, MISSING).
 * The property is inspected through its descriptor, so a header exposed
 * through a getter is never invoked.
 */
function appCheckTokenSent(request: CallableRequest<unknown>): boolean {
  const raw = StoredFields.field(request, 'rawRequest');
  // `headers` is an ACCESSOR on Node's `IncomingMessage` prototype, never an
  // own property of the request, so it is read as a property (`Reflect.get`
  // honours the getter); an own-field read would see no header at all and
  // read every call as MISSING. The headers object itself is plain: its
  // field is read as an own property.
  if (raw === null || typeof raw !== 'object') return false;
  const headers: unknown = Reflect.get(raw, 'headers');
  if (!StoredFields.isRecord(headers)) return false;
  const header = Object.getOwnPropertyDescriptor(headers, APP_CHECK_HEADER);
  return header !== undefined && header.value !== '';
}

/**
 * What the edge reads off one request for `AppCheckSystem` (S-RU-17) —
 * read defensively, as every wire reading is (`StoredFields`): the header's
 * presence, whether the platform verified the token (`request.app` is set
 * ONLY then — `common/providers/https.js` `checkAppCheckToken`), and
 * whether it had been consumed before (`request.app.alreadyConsumed`,
 * present only on a consuming callable). Never the token itself.
 */
export function appCheckFactsOf(
  request: CallableRequest<unknown>,
): AppCheckFacts {
  const app = StoredFields.field(request, 'app');
  return {
    appCheckTokenSent: appCheckTokenSent(request),
    appCheckTokenVerified: StoredFields.isRecord(app),
    appCheckTokenReplayed: StoredFields.field(app, 'alreadyConsumed') === true,
  };
}
