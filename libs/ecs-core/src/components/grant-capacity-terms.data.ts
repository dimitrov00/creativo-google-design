import { Result } from '@core/primitives';
import { EngagementError } from '@core/errors';

/** How many redemptions an active grant holds — the field `grantCapacity`. */
export const GrantCapacity = {
  SingleUse: 'SINGLE_USE',
  MultiUse: 'MULTI_USE',
} as const;
export type GrantCapacity = (typeof GrantCapacity)[keyof typeof GrantCapacity];

/**
 * A single-use grant, or a multi-use one counting down from `usesGranted`
 * (`usesRemaining` left) — a flat variant slice of an ACTIVE grant, kept by
 * a USED one as the terms it was issued under (OR-13; was the nested
 * `capacity: { kind, remaining, totalGranted }`).
 */
export type GrantCapacityTerms =
  GrantCapacityTerms.SingleUse | GrantCapacityTerms.MultiUse;

const SINGLE_USE: GrantCapacityTerms.SingleUse = {
  grantCapacity: GrantCapacity.SingleUse,
};

export const GrantCapacityTerms = {
  singleUse(): GrantCapacityTerms.SingleUse {
    return SINGLE_USE;
  },

  /** The edge guard: a positive whole number of uses, all of them remaining. */
  multiUse(
    total: number,
  ): Result<
    GrantCapacityTerms.MultiUse,
    EngagementError.CouponGrantCapacityInvalid
  > {
    if (!Number.isInteger(total) || total <= 0) {
      return Result.err(EngagementError.couponGrantCapacityInvalid(total));
    }
    return Result.ok({
      grantCapacity: GrantCapacity.MultiUse,
      usesRemaining: total,
      usesGranted: total,
    });
  },

  /** The capacity slice of a value that carries one (an active grant), copied. */
  of(terms: GrantCapacityTerms): GrantCapacityTerms {
    return terms.grantCapacity === GrantCapacity.SingleUse
      ? SINGLE_USE
      : {
          grantCapacity: GrantCapacity.MultiUse,
          usesRemaining: terms.usesRemaining,
          usesGranted: terms.usesGranted,
        };
  },
} as const;

export namespace GrantCapacityTerms {
  export type SingleUse = {
    readonly grantCapacity: typeof GrantCapacity.SingleUse;
  };
  export type MultiUse = {
    readonly grantCapacity: typeof GrantCapacity.MultiUse;
    /** Was `remaining`. */
    readonly usesRemaining: number;
    /** Was `totalGranted`. */
    readonly usesGranted: number;
  };
}
