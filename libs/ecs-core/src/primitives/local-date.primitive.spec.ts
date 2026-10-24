import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Weekday } from './weekday.data';
import { deepFreeze, unwrapErr, unwrapOk } from '@core/testing';
import { LocalDate } from './local-date.primitive';
import { PrimitiveErrorCode } from './primitive.error';

/*
 * The successor of `components/day-key.data.spec.ts` and of the civil cases
 * of `day-offset.data.spec.ts` / `zoned-time.system.spec.ts` (flatten-spec
 * §1.3): integer algorithms only — no Intl, no Date.
 */
const d = (raw: string): LocalDate => unwrapOk(LocalDate.parse(raw));

describe('LocalDate.parse — the smart constructor', () => {
  it.each([
    '2026-09-28',
    '2024-02-29',
    '2026-12-31',
    '2000-02-29',
    '0001-01-01',
    '0000-01-01',
    '9999-12-31',
  ])('takes %s', (raw) => {
    expect(LocalDate.parse(raw)).toEqual({ ok: true, value: raw });
  });

  it.each([
    '2026-02-30',
    '2025-02-29',
    '1900-02-29',
    '2026-00-10',
    '2026-13-01',
    '2026-04-31',
    '2026-01-00',
    '2026-9-28',
    '2026-09-28T00:00:00.000Z',
    '28.09.2026',
    '',
  ])('refuses %j as a flat PrimitiveError', (raw) => {
    expect(unwrapErr(LocalDate.parse(raw))).toEqual({
      errorCode: PrimitiveErrorCode.LocalDateInvalid,
      raw,
      brand: 'LocalDate',
    });
  });

  it('fromParts builds a real day, refusing an impossible or non-integer one', () => {
    expect(unwrapOk(LocalDate.fromParts(2026, 3, 29))).toBe('2026-03-29');
    expect(unwrapOk(LocalDate.fromParts(1, 1, 1))).toBe('0001-01-01');
    expect(LocalDate.fromParts(2026, 2, 30).ok).toBe(false);
    expect(LocalDate.fromParts(2026, 13, 1).ok).toBe(false);
    expect(LocalDate.fromParts(10_000, 1, 1).ok).toBe(false);
    expect(unwrapErr(LocalDate.fromParts(2026, 1.5, 1))).toEqual({
      errorCode: 'PRIMITIVE_LOCAL_DATE_INVALID',
      raw: '2026-1.5-1',
      brand: 'LocalDate',
    });
  });

  it('parts reads the numeric fields back', () => {
    expect(LocalDate.parts(d('2026-03-09'))).toEqual({
      year: 2026,
      month: 3,
      day: 9,
    });
  });
});

describe('LocalDate epoch-day arithmetic (civil, no Date)', () => {
  it('anchors 1970-01-01 at epoch day 0', () => {
    expect(LocalDate.toEpochDay(d('1970-01-01'))).toBe(0);
    expect(LocalDate.fromEpochDay(0)).toBe('1970-01-01');
    expect(LocalDate.toEpochDay(d('1969-12-31'))).toBe(-1);
    expect(LocalDate.toEpochDay(d('2026-03-29'))).toBe(20_541);
    expect(LocalDate.epochDayOf(2026, 3, 29)).toBe(20_541);
    expect(LocalDate.fromEpochDay(20_541)).toBe('2026-03-29');
  });

  it('round-trips every day from 1600 to 2400, and parse accepts each', () => {
    fc.assert(
      fc.property(fc.integer({ min: -135_140, max: 157_067 }), (epochDay) => {
        const day = LocalDate.fromEpochDay(epochDay);
        expect(LocalDate.toEpochDay(day)).toBe(epochDay);
        expect(LocalDate.parse(day).ok).toBe(true);
      }),
    );
  });

  it('consecutive epoch days are consecutive days in string order', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100_000, max: 100_000 }), (epochDay) => {
        expect(
          LocalDate.fromEpochDay(epochDay) <
            LocalDate.fromEpochDay(epochDay + 1),
        ).toBe(true);
      }),
    );
  });
});

describe('LocalDate — the month-length table (leap rule)', () => {
  it('counts February by the Gregorian leap rule', () => {
    expect(LocalDate.isLeapYear(2024)).toBe(true);
    expect(LocalDate.isLeapYear(2026)).toBe(false);
    expect(LocalDate.isLeapYear(1900)).toBe(false);
    expect(LocalDate.isLeapYear(2000)).toBe(true);
    expect(LocalDate.daysInMonth(2024, 2)).toBe(29);
    expect(LocalDate.daysInMonth(2026, 2)).toBe(28);
  });

  it('gives every other month its fixed length', () => {
    const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for (let month = 1; month <= 12; month++) {
      expect(LocalDate.daysInMonth(2026, month)).toBe(lengths[month - 1]);
    }
  });

  it('agrees with the epoch-day arithmetic: the day after the last is the 1st', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 9998 }),
        fc.integer({ min: 1, max: 12 }),
        (year, month) => {
          const last = LocalDate.epochDayOf(
            year,
            month,
            LocalDate.daysInMonth(year, month),
          );
          expect(LocalDate.fromEpochDay(last + 1).slice(8)).toBe('01');
          expect(LocalDate.fromEpochDay(last).slice(5, 7)).toBe(
            String(month).padStart(2, '0'),
          );
        },
      ),
    );
  });
});

describe('LocalDate civil arithmetic — immune to DST by construction', () => {
  it('compare orders by day: string order is day order', () => {
    expect(LocalDate.compare(d('2026-03-29'), d('2026-10-25'))).toBe(-1);
    expect(LocalDate.compare(d('2026-10-25'), d('2026-03-29'))).toBe(1);
    expect(LocalDate.compare(d('2026-10-25'), d('2026-10-25'))).toBe(0);
  });

  it('later answers the later of two days, in either order, and the day itself on the same day', () => {
    expect(LocalDate.later(d('2026-09-29'), d('2026-10-28'))).toBe(
      '2026-10-28',
    );
    expect(LocalDate.later(d('2026-10-28'), d('2026-09-29'))).toBe(
      '2026-10-28',
    );
    expect(LocalDate.later(d('2026-12-31'), d('2027-01-01'))).toBe(
      '2027-01-01',
    );
    expect(LocalDate.later(d('2026-10-28'), d('2026-10-28'))).toBe(
      '2026-10-28',
    );
  });

  it('later is pure: same input → same output, inputs untouched', () => {
    const a = deepFreeze(d('2026-09-29'));
    const b = deepFreeze(d('2026-10-01'));
    expect(LocalDate.later(a, b)).toBe(LocalDate.later(a, b));
    expect(a).toBe('2026-09-29');
    expect(b).toBe('2026-10-01');
  });

  it('daysBetween counts calendar days, signed, across the DST weekends', () => {
    expect(LocalDate.daysBetween(d('2026-09-01'), d('2026-09-28'))).toBe(27);
    expect(LocalDate.daysBetween(d('2026-09-28'), d('2026-09-01'))).toBe(-27);
    expect(LocalDate.daysBetween(d('2026-10-24'), d('2026-10-26'))).toBe(2);
    expect(LocalDate.daysBetween(d('2026-03-28'), d('2026-03-30'))).toBe(2);
  });

  it('addDays moves forward and backward across months and years', () => {
    expect(LocalDate.addDays(d('2026-01-31'), 1)).toBe('2026-02-01');
    expect(LocalDate.addDays(d('2026-01-31'), -1)).toBe('2026-01-30');
    expect(LocalDate.addDays(d('2026-12-31'), 1)).toBe('2027-01-01');
    expect(LocalDate.addDays(d('2028-02-28'), 1)).toBe('2028-02-29');
    expect(LocalDate.addDays(d('2026-03-28'), 0)).toBe('2026-03-28');
  });

  it('addMonths clamps to the target month’s length', () => {
    expect(LocalDate.addMonths(d('2026-01-31'), 1)).toBe('2026-02-28');
    expect(LocalDate.addMonths(d('2028-01-31'), 1)).toBe('2028-02-29');
    expect(LocalDate.addMonths(d('2026-01-31'), -1)).toBe('2025-12-31');
    expect(LocalDate.addMonths(d('2026-03-17'), 12)).toBe('2027-03-17');
    expect(LocalDate.addMonths(d('2026-05-31'), -3)).toBe('2026-02-28');
  });

  it('startOfMonth, monthKey and startOfWeek', () => {
    expect(LocalDate.startOfMonth(d('2026-03-17'))).toBe('2026-03-01');
    expect(LocalDate.monthKey(d('2026-03-17'))).toBe('2026-03');
    expect(LocalDate.startOfWeek(d('2026-10-07'))).toBe('2026-10-05');
    expect(LocalDate.startOfWeek(d('2026-10-05'))).toBe('2026-10-05');
    expect(LocalDate.startOfWeek(d('2026-10-11'))).toBe('2026-10-05');
  });

  it('range lists every day, both ends included; empty when inverted', () => {
    expect(LocalDate.range(d('2026-02-27'), d('2026-03-02'))).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
    expect(LocalDate.range(d('2026-03-02'), d('2026-03-01'))).toEqual([]);
  });

  it('weekday is the ISO weekday — negative epoch days too', () => {
    expect(LocalDate.weekday(d('2026-03-05'))).toBe(Weekday.Thu);
    expect(LocalDate.weekday(d('2026-06-15'))).toBe(Weekday.Mon);
    expect(LocalDate.weekday(d('1970-01-01'))).toBe(Weekday.Thu);
    expect(LocalDate.weekday(d('1969-12-28'))).toBe(Weekday.Sun);
  });

  it('weekday agrees with the ISO formula on the epoch day (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100_000, max: 100_000 }), (epochDay) => {
        // 1970-01-01 (epoch day 0) was a Thursday, ISO weekday 4.
        expect(LocalDate.weekday(LocalDate.fromEpochDay(epochDay))).toBe(
          ((((epochDay + 3) % 7) + 7) % 7) + 1,
        );
      }),
    );
  });

  it('wholeYearsBetween counts a year once its anniversary came round', () => {
    expect(LocalDate.wholeYearsBetween(d('1990-07-03'), d('2026-07-02'))).toBe(
      35,
    );
    expect(LocalDate.wholeYearsBetween(d('1990-07-03'), d('2026-07-03'))).toBe(
      36,
    );
    // A 29 February anniversary falls on 28 February in a common year.
    expect(LocalDate.wholeYearsBetween(d('2000-02-29'), d('2026-02-28'))).toBe(
      26,
    );
    expect(LocalDate.wholeYearsBetween(d('2000-02-29'), d('2026-02-27'))).toBe(
      25,
    );
    expect(LocalDate.wholeYearsBetween(d('2000-02-29'), d('2028-02-28'))).toBe(
      27,
    );
    expect(LocalDate.wholeYearsBetween(d('2026-07-03'), d('1990-07-03'))).toBe(
      -36,
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const from = deepFreeze(d('2026-01-31'));
    const run = () => [
      LocalDate.addMonths(from, 1),
      LocalDate.range(from, LocalDate.addDays(from, 3)),
      LocalDate.weekday(from),
    ];
    expect(run()).toEqual(run());
  });
});

/*
 * The day-key cases of `zoned-time.system.spec.ts`, moved with their subject
 * (the deprecated `ZonedTimeSystem.addDays/daysBetween/…` delegated here).
 */
describe('LocalDate — the former ZonedTimeSystem day-key cases', () => {
  it('counts calendar days, signed, and is not thrown by a DST change', () => {
    expect(LocalDate.daysBetween(d('2026-09-01'), d('2026-09-28'))).toBe(27);
    expect(LocalDate.daysBetween(d('2026-09-28'), d('2026-09-01'))).toBe(-27);
    expect(LocalDate.daysBetween(d('2026-09-28'), d('2026-09-28'))).toBe(0);
    // The autumn transition makes one Sofia day 25 hours long; days are still days.
    expect(LocalDate.daysBetween(d('2026-10-24'), d('2026-10-26'))).toBe(2);
    expect(LocalDate.daysBetween(d('2026-03-28'), d('2026-03-30'))).toBe(2);
  });

  it('addDays moves forward and backward across months and years', () => {
    expect(LocalDate.addDays(d('2026-01-31'), 1)).toBe('2026-02-01');
    expect(LocalDate.addDays(d('2026-01-31'), -1)).toBe('2026-01-30');
    expect(LocalDate.addDays(d('2026-12-31'), 1)).toBe('2027-01-01');
    expect(LocalDate.addDays(d('2028-02-28'), 1)).toBe('2028-02-29');
    expect(LocalDate.addDays(d('2026-03-28'), 0)).toBe('2026-03-28');
  });

  it('addMonths moves forward and backward, clamping to the month length', () => {
    expect(LocalDate.addMonths(d('2026-01-31'), 1)).toBe('2026-02-28');
    expect(LocalDate.addMonths(d('2028-01-31'), 1)).toBe('2028-02-29');
    expect(LocalDate.addMonths(d('2026-01-31'), -1)).toBe('2025-12-31');
    expect(LocalDate.addMonths(d('2026-03-17'), 12)).toBe('2027-03-17');
    expect(LocalDate.addMonths(d('2026-05-31'), -3)).toBe('2026-02-28');
  });

  it('startOfMonth resets to the 1st', () => {
    expect(LocalDate.startOfMonth(d('2026-03-17'))).toBe('2026-03-01');
  });

  it('range lists every day of the range, both ends included', () => {
    expect(LocalDate.range(d('2026-02-27'), d('2026-03-02'))).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
    expect(LocalDate.range(d('2026-03-02'), d('2026-03-01'))).toEqual([]);
  });

  it('weekday is the ISO weekday', () => {
    expect(LocalDate.weekday(d('2026-03-05'))).toBe(Weekday.Thu);
    expect(LocalDate.weekday(d('2026-06-15'))).toBe(Weekday.Mon);
    expect(LocalDate.weekday(d('1970-01-01'))).toBe(Weekday.Thu);
    expect(LocalDate.weekday(d('1969-12-28'))).toBe(Weekday.Sun);
  });

  it('wholeYearsBetween counts a birthday only once it has passed', () => {
    const birth = d('2000-06-15');
    expect(LocalDate.wholeYearsBetween(birth, d('2026-06-14'))).toBe(25);
    expect(LocalDate.wholeYearsBetween(birth, d('2026-06-15'))).toBe(26);
    expect(LocalDate.wholeYearsBetween(birth, d('2026-06-16'))).toBe(26);
    // A leap-day birthday completes its year on 28 February in a common
    // year — the legacy Luxon `yearsUntil` clamp (ZZD art. 72(2)).
    expect(LocalDate.wholeYearsBetween(d('2000-02-29'), d('2001-02-27'))).toBe(
      0,
    );
    expect(LocalDate.wholeYearsBetween(d('2000-02-29'), d('2001-02-28'))).toBe(
      1,
    );
    expect(LocalDate.wholeYearsBetween(d('2000-02-29'), d('2001-03-01'))).toBe(
      1,
    );
    expect(LocalDate.wholeYearsBetween(d('2008-02-29'), d('2025-02-28'))).toBe(
      17,
    );
    // …and on 29 February itself in a leap year, never on the 28th.
    expect(LocalDate.wholeYearsBetween(d('2000-02-29'), d('2004-02-28'))).toBe(
      3,
    );
    expect(LocalDate.wholeYearsBetween(d('2000-02-29'), d('2004-02-29'))).toBe(
      4,
    );
    expect(LocalDate.wholeYearsBetween(d('2001-02-28'), d('2000-02-29'))).toBe(
      -1,
    );
    // Backwards, truncated toward zero.
    expect(LocalDate.wholeYearsBetween(d('2026-06-15'), d('2000-06-16'))).toBe(
      -25,
    );
  });
});
