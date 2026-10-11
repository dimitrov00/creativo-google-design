import {
  GuestGuardSystem,
  type LatchedVerdict,
  SettledVerdict,
} from '@creativo/ecs-core';
import { Principal } from '@creativo/domain/identity';
import { principalTagOf } from './principal-tag';

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

/*
 * Phase 2 shim (ECS migration): the verdict and the latch are
 * `GuestGuardSystem` (`@creativo/ecs-core`); the principal reaches it
 * through the lib's one converter (`principal-tag.ts`), and the SCREAMING
 * verdict tags cross back through the one table below (flatten-spec §8.9).
 */

/** The system's verdict tag → this file's lowercase `Settled`. */
const LEGACY_SETTLED_VERDICT = {
  [SettledVerdict.Loading]: 'loading',
  [SettledVerdict.Anonymous]: 'anonymous',
  [SettledVerdict.Onboarding]: 'onboarding',
  [SettledVerdict.Active]: 'active',
} as const satisfies { readonly [V in SettledVerdict]: Settled };

/** This file's lowercase `Settled` → the system's verdict tag. */
const ECS_SETTLED_VERDICT = {
  loading: SettledVerdict.Loading,
  anonymous: SettledVerdict.Anonymous,
  onboarding: SettledVerdict.Onboarding,
  active: SettledVerdict.Active,
} as const satisfies { readonly [S in Settled]: SettledVerdict };

/** Pure classification — `null` (no snapshot yet) is the only source of `loading`. */
export function classify(principal: Principal | null): Settled {
  return LEGACY_SETTLED_VERDICT[
    GuestGuardSystem.classify(
      principal === null ? null : principalTagOf(principal),
    )
  ];
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
  const held: LatchedVerdict | null =
    prev === null ? null : ECS_SETTLED_VERDICT[prev];
  const latched = GuestGuardSystem.latch(held, ECS_SETTLED_VERDICT[live]);
  return latched === null ? null : LEGACY_SETTLED_VERDICT[latched];
}
