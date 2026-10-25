/**
 * The two staff acts that are NOT lifecycle moves — the arrival stamp, set
 * and taken back (moved from the staff dashboard's `row-verb.ts`, values
 * unchanged). Arriving is a stamp beside the status, never an edge in the
 * lifecycle graph (see `Appointment.arrivedAtUtcMs`). The ONLY source of
 * these strings. (Split out of `staff-verb.data.ts`, pass D, L-1.)
 */
export const ArrivalVerb = {
  Arrived: 'ARRIVED',
  Unarrived: 'UNARRIVED',
} as const;
export type ArrivalVerb = (typeof ArrivalVerb)[keyof typeof ArrivalVerb];
