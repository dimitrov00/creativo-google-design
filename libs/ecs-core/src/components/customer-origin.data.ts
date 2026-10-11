/**
 * How a client record came to exist — the ONLY source of these strings, the
 * field `customerOrigin` of `Customer` (D29, flatten-spec §5.2; N15: named
 * after the field, not `createdBy`, which reads like an actor id).
 *
 * - `REGISTRATION` — `completeRegistration` created it beside the account
 *   (identity flip (2));
 * - `STAFF_WALK_IN` — the visit editor's «Нов клиент» created it for a
 *   person with no account (a random `cus_…` id, `userId: null`);
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

/** Every origin, dictionary order — derived, never a second source. */
export const CUSTOMER_ORIGINS: readonly CustomerOrigin[] =
  Object.values(CustomerOrigin);

/** The edge guard for an untrusted value (a stored field read back, a seed row). */
export function isCustomerOrigin(value: unknown): value is CustomerOrigin {
  for (let i = 0; i < CUSTOMER_ORIGINS.length; i++) {
    if (CUSTOMER_ORIGINS[i] === value) return true;
  }
  return false;
}
