import { ArrivalVerb, type StaffVerb } from '@core/components';
import { bookingStatusWords } from '@creativo/infrastructure/i18n';

/**
 * The two row acts that are NOT lifecycle moves — the arrival stamp, set and
 * taken back. Arriving is a stamp beside the status, never an edge in the
 * lifecycle graph (see `Appointment.arrivedAtUtcMs`). The dictionary is
 * ecs-core's (`staff-verb.data.ts`, pass C, Y-23 — values unchanged); the
 * sheet binds it and re-exports it under the name its readers always
 * imported from here.
 */
export { ArrivalVerb };

/**
 * What a row can DO: a lifecycle move — the `BookingStatus` the callable is
 * asked for — or one of the arrival stamps. ecs-core's `StaffVerb`, under
 * the sheet's own name (D-9).
 */
export type RowVerb = StaffVerb;

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
