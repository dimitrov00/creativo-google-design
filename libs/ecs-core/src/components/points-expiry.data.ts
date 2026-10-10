import type { DayKey } from './day-key.data';

/**
 * When the account's points lapse, and from which day the client is told —
 * `loyaltyAccounts/{uid}.pointsExpiry` (`loyalty-document.ts:583-586`),
 * day keys with the stored names kept. The account holds `null` while
 * expiry is off, or when nothing can lapse; points expiry itself is a
 * design-only concept today (§9 D26), so no writer sets one yet.
 */
export type PointsExpiry = {
  readonly expiresOn: DayKey;
  readonly noticeFrom: DayKey;
};
