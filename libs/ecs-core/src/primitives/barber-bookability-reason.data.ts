/**
 * Why a barber cannot be booked for a seat (team onboarding D3,
 * `BarberBookabilitySystem.verdictOf`) — the ONLY source of these strings,
 * named after the field the error `BOOKING_BARBER_NOT_BOOKABLE` carries
 * (`barberBookabilityReason`). In primitives because an error carries it
 * (errors import only primitives, Law 8).
 *
 * - `UNKNOWN` — no barber record by that id.
 * - `NOT_READY` — a `DRAFT`, being set up.
 * - `STAFF_ONLY` — staff may book them, a client online may not.
 * - `DEPARTED` — has left the shop.
 * - `BEFORE_START` / `AFTER_LAST_DAY` — the shop day lies outside their
 *   working period.
 * - `NOT_IN_ANY_POOL` — the client chose «Който и да е» and this barber
 *   takes no such bookings.
 * - `DOES_NOT_OFFER` — the service lists who performs it, and not them.
 */
export const BarberBookabilityReason = {
  Unknown: 'UNKNOWN',
  NotReady: 'NOT_READY',
  StaffOnly: 'STAFF_ONLY',
  Departed: 'DEPARTED',
  BeforeStart: 'BEFORE_START',
  AfterLastDay: 'AFTER_LAST_DAY',
  NotInAnyPool: 'NOT_IN_ANY_POOL',
  DoesNotOffer: 'DOES_NOT_OFFER',
} as const;
export type BarberBookabilityReason =
  (typeof BarberBookabilityReason)[keyof typeof BarberBookabilityReason];
