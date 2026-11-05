import type { BookingStatus } from '@core/primitives';
import { BOOKING_STATUS_ICONS, type StatusFilterRowVm } from './staff-day.vm';

/**
 * The status filter's rows, worded: each state in the given order with the
 * calendar's own mark for it, its word, and whether the schedule draws it.
 * Which states are hidden is the device's choice, handed in.
 */
export function statusFilterRowsVm(input: {
  readonly statuses: readonly BookingStatus[];
  readonly hidden: readonly BookingStatus[];
  /** «Отказани» — the search's word for a state. */
  readonly statusWord: (status: BookingStatus) => string;
}): readonly StatusFilterRowVm[] {
  return input.statuses.map((bookingStatus) => ({
    bookingStatus,
    glyph: BOOKING_STATUS_ICONS[bookingStatus],
    label: input.statusWord(bookingStatus),
    shown: !input.hidden.includes(bookingStatus),
  }));
}
