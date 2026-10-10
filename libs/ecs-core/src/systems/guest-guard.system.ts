import { type Principal, PrincipalKind } from '../components/principal.data';

/**
 * GuestGuardSystem — the settled account verdict `/auth` and `/onboarding`
 * branch on (blueprint §2.8), the pure port of `libs/application/identity/
 * src/lib/flow/guest-guard.ts` (`classify`, `latchSettledPrincipal`).
 *
 * - `loading`    — no principal observed yet → render a splash.
 * - `anonymous`  — not signed in → allow the auth flow.
 * - `onboarding` — signed in, not yet active → resume onboarding.
 * - `active`     — a finished account (client or staff) → bounce away.
 */
export const SettledVerdict = {
  Loading: 'loading',
  Anonymous: 'anonymous',
  Onboarding: 'onboarding',
  Active: 'active',
} as const;
export type SettledVerdict =
  (typeof SettledVerdict)[keyof typeof SettledVerdict];

/** A verdict that has settled — everything but `loading`. */
export type LatchedVerdict = Exclude<
  SettledVerdict,
  typeof SettledVerdict.Loading
>;

/**
 * All the guard reads of a principal: its tag. A full {@link Principal}
 * satisfies it; so does a caller that only knows the tag.
 */
export type PrincipalTag = { readonly kind: Principal['kind'] };

export const GuestGuardSystem = {
  /** `null` (no snapshot yet) is the only source of `loading`; client and staff are both `active`. */
  classify(principal: PrincipalTag | null): SettledVerdict {
    if (principal === null) return SettledVerdict.Loading;
    switch (principal.kind) {
      case PrincipalKind.Anonymous:
        return SettledVerdict.Anonymous;
      case PrincipalKind.Onboarding:
        return SettledVerdict.Onboarding;
      default:
        return SettledVerdict.Active;
    }
  },

  /**
   * The latch: the first settled verdict wins and never changes for the
   * lifetime of the caller's held `prev` — a token refresh flipping
   * `onboarding → active` mid-flow must not yank the person out of it. Only
   * a fresh mount (`prev === null`) decides again.
   */
  latch(
    prev: LatchedVerdict | null,
    live: SettledVerdict,
  ): LatchedVerdict | null {
    if (prev !== null) return prev;
    return live === SettledVerdict.Loading ? null : live;
  },
} as const;
