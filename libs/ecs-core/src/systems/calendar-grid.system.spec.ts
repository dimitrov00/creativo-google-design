import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Weekday, LocalDate } from '@core/primitives';
import { deepFreeze, localDate } from '@core/testing';
import { type CalendarCell, CalendarGridSystem } from './calendar-grid.system';

/*
 * COPIED and re-targeted: both cases of libs/features/client/appointments/
 * src/lib/calendar-month.spec.ts (`buildCalendarMonth`) — the anchor and
 * today as day keys, the appointments as the day keys they fall on, the
 * cell's `date.day` as `dayOfMonth`, `inCurrentMonth` as `inMonth`, and
 * `isToday` as the template's day-key comparison. libs/ui/patterns/src/lib/
 * calendar-grid/calendar-grid.spec.ts holds no grid math (three DOM cases of
 * a headless layout), so nothing of it is copied. Plus the blank-padded
 * reading of `client-appointments.ts` `buildMonth`, the grid range, the
 * Monday-first week, properties and purity.
 *
 * Flatten pass (Law 7, T1): days are `LocalDate`s and the grid takes no day
 * table — a weekday is the civil day's own (`LocalDate.weekday`), so the
 * «reads every weekday off the table» case now proves the civil reading on
 * the DST transition month; the Monday of a week is `LocalDate.startOfWeek`
 * (flatten-spec §2.4), whose case stays here with its grid.
 */

const S = CalendarGridSystem;
const key = (raw: string): LocalDate => localDate(raw);

describe('buildCalendarMonth', () => {
  it('builds a Monday-first grid padded to whole weeks, anchored on the given month', () => {
    const anchor = key('2026-03-17');
    const month = S.monthGrid(anchor, []);
    expect(anchor.slice(0, 4)).toBe('2026');
    expect(Number(anchor.slice(5, 7))).toBe(3);
    for (const week of month) {
      expect(week).toHaveLength(7);
    }
    // 2026-03-01 is a Sunday: 6 leading blanks from the prior month.
    const firstWeek = month[0];
    expect(firstWeek?.[0]?.inMonth).toBe(false);
    expect(firstWeek?.[6]?.inMonth).toBe(true);
    expect(firstWeek?.[6]?.dayOfMonth).toBe(1);
  });

  it('marks the cell matching `today` and counts appointments per day', () => {
    const today = key('2026-03-05');
    const appointments = [key('2026-03-05'), key('2026-03-05')];
    const month = S.monthGrid(today, appointments);

    const cell = month.flat().find((c) => c.dayOfMonth === 5 && c.inMonth);
    expect(cell?.localDate === today).toBe(true);
    expect(cell?.marks).toBe(2);

    const otherCell = month.flat().find((c) => c.dayOfMonth === 6 && c.inMonth);
    expect(otherCell?.localDate === today).toBe(false);
    expect(otherCell?.marks).toBe(0);
  });
});

describe('the month grid', () => {
  it('pads with the neighbours’ real days, which a blank-padded list reads as blanks', () => {
    const anchor = key('2026-03-01');
    const month = S.monthGrid(anchor, []);
    // March 2026: Sunday the 1st to Tuesday the 31st — six weeks.
    expect(month).toHaveLength(6);
    expect(month[0]?.slice(0, 6).map((cell) => cell.localDate)).toEqual([
      '2026-02-23',
      '2026-02-24',
      '2026-02-25',
      '2026-02-26',
      '2026-02-27',
      '2026-02-28',
    ]);
    expect(month[5]?.map((cell) => cell.inMonth)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
    // A month that starts on a Monday and fills four weeks exactly.
    const feb = key('2027-02-10');
    const four = S.monthGrid(feb, []);
    expect(four).toHaveLength(4);
    expect(four.flat().every((cell) => cell.inMonth)).toBe(true);
  });

  it('reads every weekday off the civil day, Monday first', () => {
    const anchor = key('2026-10-25'); // the autumn transition day in Sofia
    const month = S.monthGrid(anchor, []);
    for (const week of month) {
      expect(week.map((cell) => cell.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    }
    // The civil count is the day's own: no zone, no table, the same value.
    for (const cell of month.flat()) {
      expect(cell.weekday).toBe(LocalDate.weekday(cell.localDate));
    }
  });

  it('spans the grid from the Monday on or before the 1st to the Sunday on or after the last', () => {
    expect(S.gridRange(key('2026-03-17'))).toEqual({
      fromLocalDate: '2026-02-23',
      toLocalDate: '2026-04-05',
    });
    expect(S.gridRange(key('2027-02-01'))).toEqual({
      fromLocalDate: '2027-02-01',
      toLocalDate: '2027-02-28',
    });
  });

  it('finds the Monday of a week', () => {
    expect(LocalDate.startOfWeek(key('2026-09-24'))).toBe('2026-09-21');
    expect(LocalDate.startOfWeek(key('2026-09-21'))).toBe('2026-09-21');
    expect(LocalDate.startOfWeek(key('2026-09-27'))).toBe('2026-09-21');
    // The week of a grid's first row is the range's first day.
    const range = S.gridRange(key('2026-09-24'));
    expect(LocalDate.startOfWeek(key('2026-09-01'))).toBe(range.fromLocalDate);
  });

  it('lays out every month as whole Monday-first weeks covering it exactly once (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1990, max: 2100 }),
        fc.integer({ min: 1, max: 12 }),
        (year, month) => {
          const anchor = key(`${year}-${String(month).padStart(2, '0')}-15`);
          const grid = S.monthGrid(anchor, []);
          const cells = grid.flat();
          expect(cells.length % 7).toBe(0);
          expect(grid.length).toBeGreaterThanOrEqual(4);
          expect(grid.length).toBeLessThanOrEqual(6);
          expect(cells[0]?.weekday).toBe(Weekday.Mon);
          const own = cells.filter((cell) => cell.inMonth);
          expect(own.length).toBe(LocalDate.daysInMonth(year, month));
          expect(own.map((cell) => cell.dayOfMonth)).toEqual(
            own.map((_, i) => i + 1),
          );
          for (let i = 1; i < cells.length; i++) {
            expect(
              LocalDate.daysBetween(
                (cells[i - 1] as CalendarCell).localDate,
                (cells.at(i) as CalendarCell).localDate,
              ),
            ).toBe(1);
          }
          // The counters are the local date's own figures: the civil
          // weekday and the day of the month, padding days included.
          for (const cell of cells) {
            expect(cell.weekday).toBe(LocalDate.weekday(cell.localDate));
            expect(cell.dayOfMonth).toBe(LocalDate.parts(cell.localDate).day);
          }
          // The grid range is exactly the cells.
          const range = S.gridRange(anchor);
          expect(cells[0]?.localDate).toBe(range.fromLocalDate);
          expect(cells.at(-1)?.localDate).toBe(range.toLocalDate);
        },
      ),
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const anchor = key('2026-03-17');
    const marks = deepFreeze([key('2026-03-05'), key('2026-02-24')]);
    const once = S.monthGrid(anchor, marks);
    const twice = S.monthGrid(anchor, marks);
    expect(twice).toEqual(once);
    expect(S.gridRange(anchor)).toEqual(S.gridRange(anchor));
    expect(
      once.flat().find((cell) => cell.localDate === '2026-02-24')?.marks,
    ).toBe(1);
    expect(marks).toEqual(['2026-03-05', '2026-02-24']);
  });
});
