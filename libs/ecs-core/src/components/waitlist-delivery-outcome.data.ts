/*
 * How one watching waitlist request ended a `matchWaitlist` delivery — the
 * pipeline's tag. A pipeline-local dictionary moved to components under its
 * domain name (pass D, S-21, D-7.7: was `RequestOutcome`, field `outcome`),
 * values unchanged and internal — the call answers the notified and expired
 * request ids, never this tag.
 */

/** How one watching request ended this delivery — the ONLY source of these strings, the field `waitlistDeliveryOutcome`. */
export const WaitlistDeliveryOutcome = {
  /** The request was told about the freed day. */
  Notified: 'NOTIFIED',
  /** Every day the request watched had passed: it moved to `EXPIRED`. */
  Expired: 'EXPIRED',
  /** Nothing to do for this request this time. */
  None: 'NONE',
} as const;
export type WaitlistDeliveryOutcome =
  (typeof WaitlistDeliveryOutcome)[keyof typeof WaitlistDeliveryOutcome];
