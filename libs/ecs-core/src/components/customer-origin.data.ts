/**
 * How a client record came to exist — the ONLY source of these strings, the
 * field `customerOrigin` of `Customer` (D29, flatten-spec §5.2; N15: named
 * after the field, not `createdBy`, which reads like an actor id).
 *
 * - `REGISTRATION` — `completeRegistration` created it beside the account
 *   (identity flip (2));
 * - `STAFF_WALK_IN` — the staff commit or edit created it for a walk-in the
 *   desk took a contact for (the deterministic `CustomerId.forWalkIn` id over
 *   its phone, else its e-mail; `userId: null`; OR-26);
 * - `FIRST_BOOKING` — the booking pipeline created it for an account holder
 *   with no record yet, inside the commit (booking flip (1));
 * - `SEED` — the dev seed wrote it for a seeded client.
 */
export const CustomerOrigin = {
  Registration: 'REGISTRATION',
  StaffWalkIn: 'STAFF_WALK_IN',
  FirstBooking: 'FIRST_BOOKING',
  Seed: 'SEED',
} as const;
export type CustomerOrigin =
  (typeof CustomerOrigin)[keyof typeof CustomerOrigin];
