import type { BookingStatus } from '@core/primitives';
import { bookingStatusWords } from '@creativo/infrastructure/i18n';

/**
 * The two row acts that are NOT lifecycle moves — the arrival stamp, set and
 * taken back. Arriving is a stamp beside the status, never an edge in the
 * lifecycle graph (see `Appointment.arrivedAtUtcMs`).
 */
export const ArrivalVerb = {
  Arrived: 'ARRIVED',
  Unarrived: 'UNARRIVED',
} as const;
export type ArrivalVerb = (typeof ArrivalVerb)[keyof typeof ArrivalVerb];

/**
 * What a row can DO: a lifecycle move — the `BookingStatus` the callable is
 * asked for — or one of the arrival stamps.
 */
export type RowVerb = BookingStatus | ArrivalVerb;

/**
 * Each verb's word (Phase 4a 4A-10) — the `staff.day.act.<word>` and
 * `staff.day.undo.<word>` key segments, and the sheet's menu ids. The sheet
 * carries and emits the `RowVerb` itself (`VisitEditorVerb.rowVerb`); the
 * word is only ever printed. The statuses read the ONE shared table; the
 * stamps add their own two words beside it.
 */
export const ROW_VERB_WORD = {
  ...bookingStatusWords,
  [ArrivalVerb.Arrived]: 'arrived',
  [ArrivalVerb.Unarrived]: 'unarrived',
} as const satisfies Record<RowVerb, string>;
