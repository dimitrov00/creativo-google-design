import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DayKey } from '../components/day-key.data';
import { Weekday } from '../components/weekday.data';
import { dayTableFixture, deepFreeze } from '../testing';
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
 */

const S = CalendarGridSystem;
const key = (raw: string): DayKey => DayKey.of(raw);

/** The table a store builds once for the month's visible range. */
function tableFor(monthDay: DayKey) {
  const range = S.gridRange(monthDay);
  return dayTableFixture(range.fromDayKey, range.toDayKey);
}

describe('buildCalendarMonth', () => {
  it('builds a Monday-first grid padded to whole weeks, anchored on the given month', () => {
    const anchor = key('2026-03-17');
    const month = S.monthGrid(anchor, tableFor(anchor), []);
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
    const month = S.monthGrid(today, tableFor(today), appointments);

    const cell = month.flat().find((c) => c.dayOfMonth === 5 && c.inMonth);
    expect(cell?.dayKey === today).toBe(true);
    expect(cell?.marks).toBe(2);

    const otherCell = month.flat().find((c) => c.dayOfMonth === 6 && c.inMonth);
    expect(otherCell?.dayKey === today).toBe(false);
    expect(otherCell?.marks).toBe(0);
  });
});

describe('the month grid', () => {
  it('pads with the neighbours’ real days, which a blank-padded list reads as blanks', () => {
    const anchor = key('2026-03-01');
    const month = S.monthGrid(anchor, tableFor(anchor), []);
    // March 2026: Sunday the 1st to Tuesday the 31st — six weeks.
    expect(month).toHaveLength(6);
    expect(month[0]?.slice(0, 6).map((cell) => cell.dayKey)).toEqual([
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
    const four = S.monthGrid(feb, tableFor(feb), []);
    expect(four).toHaveLength(4);
    expect(four.flat().every((cell) => cell.inMonth)).toBe(true);
  });

  it('reads every weekday off the table, Monday first', () => {
    const anchor = key('2026-10-25'); // the autumn transition day in Sofia
    const month = S.monthGrid(anchor, tableFor(anchor), []);
    for (const week of month) {
      expect(week.map((cell) => cell.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    }
    // Without a table the civil count says the same.
    expect(S.monthGrid(anchor, [], [])).toEqual(month);
  });

  it('spans the grid from the Monday on or before the 1st to the Sunday on or after the last', () => {
    expect(S.gridRange(key('2026-03-17'))).toEqual({
      fromDayKey: '2026-02-23',
      toDayKey: '2026-04-05',
    });
    expect(S.gridRange(key('2027-02-01'))).toEqual({
      fromDayKey: '2027-02-01',
      toDayKey: '2027-02-28',
    });
  });

  it('finds the Monday of a week', () => {
    const days = dayTableFixture('2026-09-21', '2026-09-27');
    expect(S.startOfWeek(key('2026-09-24'), days)).toBe('2026-09-21');
    expect(S.startOfWeek(key('2026-09-21'), days)).toBe('2026-09-21');
    expect(S.startOfWeek(key('2026-09-27'), days)).toBe('2026-09-21');
  });

  it('lays out every month as whole Monday-first weeks covering it exactly once (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1990, max: 2100 }),
        fc.integer({ min: 1, max: 12 }),
        (year, month) => {
          const anchor = key(`${year}-${String(month).padStart(2, '0')}-15`);
          const grid = S.monthGrid(anchor, [], []);
          const cells = grid.flat();
          expect(cells.length % 7).toBe(0);
          expect(grid.length).toBeGreaterThanOrEqual(4);
          expect(grid.length).toBeLessThanOrEqual(6);
          expect(cells[0]?.weekday).toBe(Weekday.Mon);
          const own = cells.filter((cell) => cell.inMonth);
          expect(own.length).toBe(DayKey.daysInMonth(year, month));
          expect(own.map((cell) => cell.dayOfMonth)).toEqual(
            own.map((_, i) => i + 1),
          );
          for (let i = 1; i < cells.length; i++) {
            expect(
              DayKey.toEpochDay((cells.at(i) as CalendarCell).dayKey) -
                DayKey.toEpochDay((cells[i - 1] as CalendarCell).dayKey),
            ).toBe(1);
          }
          // The counters are the day key's own figures: the civil weekday
          // and the day of the month, padding days included.
          for (const cell of cells) {
            expect(cell.weekday).toBe(
              Weekday.ofEpochDay(DayKey.toEpochDay(cell.dayKey)),
            );
            expect(cell.dayOfMonth).toBe(Number(cell.dayKey.slice(8, 10)));
          }
          // The grid range is exactly the cells.
          const range = S.gridRange(anchor);
          expect(cells[0]?.dayKey).toBe(range.fromDayKey);
          expect(cells.at(-1)?.dayKey).toBe(range.toDayKey);
        },
      ),
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const anchor = key('2026-03-17');
    const days = deepFreeze(tableFor(anchor));
    const marks = deepFreeze([key('2026-03-05'), key('2026-02-24')]);
    const once = S.monthGrid(anchor, days, marks);
    const twice = S.monthGrid(anchor, days, marks);
    expect(twice).toEqual(once);
    expect(
      once.flat().find((cell) => cell.dayKey === '2026-02-24')?.marks,
    ).toBe(1);
    expect(marks).toEqual(['2026-03-05', '2026-02-24']);
  });
});
