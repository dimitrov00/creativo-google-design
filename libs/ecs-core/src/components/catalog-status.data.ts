/**
 * The catalogue's stored `status` strings — three `as const` dictionaries,
 * the ONLY source of these strings, replacing the bare literal unions
 * `ServiceStatus` (`service.ts:37`), `BarberStatus` (`barber.ts:13`) and
 * `LocationStatus` (`location.ts:24`). The values are unchanged: the
 * composite indexes #1–#5 filter `status == 'active'`, so a renamed string
 * would empty every public catalogue query.
 *
 * Status is a plain field an admin flips, not a transition graph — there is
 * nothing to compute on it beyond `===` against a tag, so no companion
 * members.
 */

/** A service is bookable (`active`) or kept for history only (`archived`). */
export const ServiceState = {
  Active: 'active',
  Archived: 'archived',
} as const;
export type ServiceState = (typeof ServiceState)[keyof typeof ServiceState];

/** A barber takes bookings (`active`) or is off the public roster (`inactive`). */
export const BarberState = {
  Active: 'active',
  Inactive: 'inactive',
} as const;
export type BarberState = (typeof BarberState)[keyof typeof BarberState];

/** A shop is listed (`active`) or withheld from every public surface (`hidden`). */
export const LocationState = {
  Active: 'active',
  Hidden: 'hidden',
} as const;
export type LocationState = (typeof LocationState)[keyof typeof LocationState];
