import {
  type Principal,
  PrincipalKind,
  SettledVerdict,
} from '@core/components';

/**
 * GuestGuardSystem — the settled account verdict (`SettledVerdict`) `/auth`
 * and `/onboarding` branch on (blueprint §2.8), the pure port of the legacy
 * identity application lib's `flow/guest-guard.ts` (`classify`,
 * `latchSettledPrincipal`).
 */

/** A verdict that has settled — everything but `LOADING`. */
export type LatchedVerdict = Exclude<
  SettledVerdict,
  typeof SettledVerdict.Loading
>;

/**
 * All the guard reads of a principal: its tag. A full {@link Principal}
 * satisfies it (zero inbound mapping); so does a caller that only knows the
 * tag.
 */
export type PrincipalTag = Pick<Principal, 'principalKind'>;

export const GuestGuardSystem = {
  /** `null` (no snapshot yet) is the only source of `LOADING`; client and staff are both `ACTIVE`. */
  classify(principal: PrincipalTag | null): SettledVerdict {
    if (principal === null) return SettledVerdict.Loading;
    switch (principal.principalKind) {
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
   * `ONBOARDING → ACTIVE` mid-flow must not yank the person out of it. Only
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
