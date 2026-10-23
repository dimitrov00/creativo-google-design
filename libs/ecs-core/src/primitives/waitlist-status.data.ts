/**
 * Where a waitlist request is in its life — the ONLY source of these strings,
 * named after the field it types (`waitlistStatus`, N15; index #14 filters on
 * it). SCREAMING since the flatten pass; the legacy stored documents read
 * `open`/`matched`/… until the booking-flow 3b flip, which the legacy shim
 * mapped.
 */
export const WaitlistStatus = {
  /** Watching. The only state a matcher considers. */
  Open: 'OPEN',
  /** Something opened up and the client was told. Still live: told is not booked. */
  Matched: 'MATCHED',
  /** It turned into an appointment. Terminal. */
  Booked: 'BOOKED',
  /** The client withdrew it. Terminal. */
  Cancelled: 'CANCELLED',
  /** Every day it named is in the past. Terminal. */
  Expired: 'EXPIRED',
} as const;
export type WaitlistStatus =
  (typeof WaitlistStatus)[keyof typeof WaitlistStatus];
