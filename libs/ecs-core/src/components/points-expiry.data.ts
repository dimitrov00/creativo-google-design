import type { LocalDate } from '@core/primitives';

/**
 * When the account's points lapse, and from which day the client is told —
 * a FLAT slice at the root of `loyaltyAccounts/{uid}` (today's nullable
 * nested `pointsExpiry { expiresOn; noticeFrom }`, N9). Invariant: the two
 * fields are `null` together — while expiry is off, or when nothing can
 * lapse; points expiry itself is a design-only concept today (§9 D26), so
 * no writer sets one yet.
 */
export type PointsExpiry = {
  readonly pointsExpireOn: LocalDate | null;
  readonly pointsExpiryNoticeFrom: LocalDate | null;
};

export const PointsExpiry = {
  /** Nothing lapses — both days `null`. */
  none(): PointsExpiry {
    return { pointsExpireOn: null, pointsExpiryNoticeFrom: null };
  },

  of(
    pointsExpireOn: LocalDate,
    pointsExpiryNoticeFrom: LocalDate,
  ): PointsExpiry {
    return { pointsExpireOn, pointsExpiryNoticeFrom };
  },
} as const;
