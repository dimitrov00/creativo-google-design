/**
 * The catalogue's status tags — three `as const` dictionaries, the ONLY
 * source of these strings, each named after the field it types (Law 1, N8/
 * N15): `serviceStatus: ServiceStatus`, `barberStatus: BarberStatus`,
 * `locationStatus: LocationStatus` (was `status`, flatten-spec §3.1). Values
 * SCREAMING_SNAKE (Law 6.2). The stored documents keep their legacy
 * lowercase `status` until the booking-core flip: the legacy shims convert at
 * their boundary, and the composite indexes #1–#5 keep filtering the stored
 * field.
 *
 * Status is a plain field an admin flips, not a transition graph — there is
 * nothing to compute on it beyond `===` against a tag, so no companion
 * members.
 */

/** A service is bookable (`ACTIVE`) or kept for history only (`ARCHIVED`). */
export const ServiceStatus = {
  Active: 'ACTIVE',
  Archived: 'ARCHIVED',
} as const;
export type ServiceStatus = (typeof ServiceStatus)[keyof typeof ServiceStatus];

/** A barber takes bookings (`ACTIVE`) or is off the public roster (`INACTIVE`). */
export const BarberStatus = {
  Active: 'ACTIVE',
  Inactive: 'INACTIVE',
} as const;
export type BarberStatus = (typeof BarberStatus)[keyof typeof BarberStatus];

/** A shop is listed (`ACTIVE`) or withheld from every public surface (`HIDDEN`). */
export const LocationStatus = {
  Active: 'ACTIVE',
  Hidden: 'HIDDEN',
} as const;
export type LocationStatus =
  (typeof LocationStatus)[keyof typeof LocationStatus];
