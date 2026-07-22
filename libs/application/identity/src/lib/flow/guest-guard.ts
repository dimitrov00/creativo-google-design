import { Principal } from '@creativo/domain/identity';

/**
 * The settled account verdict `/auth`/`/onboarding` branch on. Ports v2's
 * `use-guest-guard.ts` (`docs/migration-blueprint.md` §1.4/§7.5) — pure
 * functions here, wrapped in a signal by the feature store (no React
 * `useRef`, this is framework-free).
 *
 *   - `loading`    — no `Principal` observed yet → render a splash.
 *   - `anonymous`  — not signed in → allow the auth flow.
 *   - `onboarding` — signed in but not yet active → resume onboarding.
 *   - `active`     — a finished account → bounce away from guest routes.
 */
export type Settled = 'loading' | 'anonymous' | 'onboarding' | 'active';

/** Pure classification — `null` (no snapshot yet) is the only source of `loading`. */
export function classify(principal: Principal | null): Settled {
  return principal === null ? 'loading' : principal.kind;
}

/**
 * Pure latch: the first non-`loading` verdict wins and never changes for
 * the lifetime of the caller's held `prev` value.
 *
 * Anti-yank mechanism: a token auto-refresh or onboarding completion can
 * flip `onboarding → active` while the user is mid-flow on `/auth` — a
 * reactive guard would redirect them out of the flow in place. Freezing
 * the arrival verdict holds them in it; only a fresh mount (new held
 * `prev`, i.e. `null`) re-decides.
 */
export function latchSettledPrincipal(
  prev: Exclude<Settled, 'loading'> | null,
  live: Settled,
): Exclude<Settled, 'loading'> | null {
  if (prev !== null) return prev;
  return live === 'loading' ? null : live;
}
