import { describe, expect, it } from 'vitest';
import { BookingStatus } from '@core/primitives';
import { statusFilterRowsVm } from './schedule-status-filter.presenter';

const WORDS: Readonly<Record<BookingStatus, string>> = {
  [BookingStatus.Pending]: 'Заявени',
  [BookingStatus.Confirmed]: 'Потвърдени',
  [BookingStatus.Completed]: 'Приключени',
  [BookingStatus.NoShow]: 'Не са дошли',
  [BookingStatus.Cancelled]: 'Отказани',
};

describe('statusFilterRowsVm', () => {
  it('words each state with the calendar’s mark, in the given order, and says which are drawn', () => {
    expect(
      statusFilterRowsVm({
        statuses: [BookingStatus.Confirmed, BookingStatus.Cancelled],
        hidden: [BookingStatus.Cancelled],
        statusWord: (status) => WORDS[status],
      }),
    ).toEqual([
      {
        bookingStatus: BookingStatus.Confirmed,
        glyph: 'visit.confirmed',
        label: 'Потвърдени',
        shown: true,
      },
      {
        bookingStatus: BookingStatus.Cancelled,
        glyph: 'visit.cancelled',
        label: 'Отказани',
        shown: false,
      },
    ]);
  });
});
