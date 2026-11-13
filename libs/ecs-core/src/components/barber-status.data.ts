/**
 * Where a barber record is in its life (team onboarding D2,
 * `docs/designs/team-onboarding.md`) — the ONLY source of these strings,
 * named after the field it types (`barberStatus`, Law 1, N8/N15). Values
 * SCREAMING_SNAKE (Law 6.2); the public catalogue query and the `barbers`
 * read rule filter the stored field.
 *
 * - `DRAFT` — being set up, never yet live: staff-only, nobody books them.
 * - `STAFF_ONLY` — live, booked by staff only, off the public site.
 * - `PUBLIC` — live, listed and bookable online.
 * - `DEPARTED` — left the shop; history stays, no new bookings.
 *
 * Each status's own fields live on its variant of `BarberLifecycle`
 * (`barber-lifecycle.data.ts`). Was `ACTIVE | INACTIVE` (`ACTIVE` →
 * `PUBLIC`, `INACTIVE` → `DEPARTED`).
 */
export const BarberStatus = {
  Draft: 'DRAFT',
  StaffOnly: 'STAFF_ONLY',
  Public: 'PUBLIC',
  Departed: 'DEPARTED',
} as const;
export type BarberStatus = (typeof BarberStatus)[keyof typeof BarberStatus];
