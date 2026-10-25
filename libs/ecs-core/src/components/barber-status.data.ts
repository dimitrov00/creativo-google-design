/**
 * A barber takes bookings (`ACTIVE`) or is off the public roster
 * (`INACTIVE`) — the ONLY source of these strings, named after the field it
 * types (`barberStatus`, Law 1, N8/N15; was `status`, flatten-spec §3.1).
 * Values SCREAMING_SNAKE (Law 6.2); the composite indexes filter the stored
 * field. Split out of `catalog-status.data.ts` (pass D, D-7: one dictionary
 * per file).
 */
export const BarberStatus = {
  Active: 'ACTIVE',
  Inactive: 'INACTIVE',
} as const;
export type BarberStatus = (typeof BarberStatus)[keyof typeof BarberStatus];
