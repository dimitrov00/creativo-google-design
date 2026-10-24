import type { BookingStatus } from '@core/primitives';

/**
 * The two staff acts that are NOT lifecycle moves — the arrival stamp, set
 * and taken back (moved from the staff dashboard's `row-verb.ts`, values
 * unchanged). Arriving is a stamp beside the status, never an edge in the
 * lifecycle graph (see `Appointment.arrivedAtUtcMs`). The ONLY source of
 * these strings.
 */
export const ArrivalVerb = {
  Arrived: 'ARRIVED',
  Unarrived: 'UNARRIVED',
} as const;
export type ArrivalVerb = (typeof ArrivalVerb)[keyof typeof ArrivalVerb];

/**
 * What a staff row can DO: a lifecycle move — the `BookingStatus` the
 * transition callable is asked for — or one of the arrival stamps. What
 * `AppointmentLifecycleSystem.leadVerb` / `inverseOf` / `exitVerbs` answer in.
 */
export type StaffVerb = BookingStatus | ArrivalVerb;

/**
 * The arrival callable's verb — the field `markArrivalAction`, the ONLY
 * source of these strings (moved out of `mark-arrival.pipeline.ts`, values
 * unchanged, so no tag dictionary lives in the pipelines tier): the party
 * walked in, or the stamp is taken back.
 */
export const MarkArrivalAction = {
  Arrive: 'ARRIVE',
  Clear: 'CLEAR',
} as const;
export type MarkArrivalAction =
  (typeof MarkArrivalAction)[keyof typeof MarkArrivalAction];
