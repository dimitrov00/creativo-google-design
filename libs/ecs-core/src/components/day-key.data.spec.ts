import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DateRange, DayKey } from './day-key.data';

const key = (raw: string): DayKey => DayKey.of(raw);

describe('DayKey.isValid — the edge guard (loyalty isIsoDate cases)', () => {
  it.each([
    '2026-09-28',
    '2024-02-29',
    '2026-12-31',
    '2000-02-29',
    '0001-01-01',
    '9999-12-31',
  ])('takes %s', (raw) => {
    expect(DayKey.isValid(raw)).toBe(true);
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
    null,
    20260928,
  ])('refuses %j', (raw) => {
    expect(DayKey.isValid(raw)).toBe(false);
  });
});

describe('DayKey epoch-day arithmetic (civil, no Date)', () => {
  it('anchors 1970-01-01 at epoch day 0', () => {
    expect(DayKey.toEpochDay(key('1970-01-01'))).toBe(0);
    expect(DayKey.fromEpochDay(0)).toBe('1970-01-01');
    expect(DayKey.toEpochDay(key('1969-12-31'))).toBe(-1);
    expect(DayKey.toEpochDay(key('2026-03-29'))).toBe(20_541);
    expect(DayKey.epochDayOf(2026, 3, 29)).toBe(20_541);
    expect(DayKey.fromEpochDay(20_541)).toBe('2026-03-29');
  });

  it('round-trips every day from 1600 to 2400', () => {
    fc.assert(
      fc.property(fc.integer({ min: -135_140, max: 157_067 }), (epochDay) => {
        expect(DayKey.toEpochDay(DayKey.fromEpochDay(epochDay))).toBe(epochDay);
      }),
    );
  });

  it('consecutive epoch days are consecutive keys in day order', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100_000, max: 100_000 }), (epochDay) => {
        expect(
          DayKey.fromEpochDay(epochDay) < DayKey.fromEpochDay(epochDay + 1),
        ).toBe(true);
      }),
    );
  });
});

describe('DayKey.daysInMonth — the one month-length table (leap rule, no Date)', () => {
  it('counts February by the Gregorian leap rule', () => {
    expect(DayKey.isLeapYear(2024)).toBe(true);
    expect(DayKey.isLeapYear(2026)).toBe(false);
    expect(DayKey.isLeapYear(1900)).toBe(false);
    expect(DayKey.isLeapYear(2000)).toBe(true);
    expect(DayKey.daysInMonth(2024, 2)).toBe(29);
    expect(DayKey.daysInMonth(2026, 2)).toBe(28);
    expect(DayKey.daysInMonth(1900, 2)).toBe(28);
    expect(DayKey.daysInMonth(2000, 2)).toBe(29);
  });

  it('gives every other month its fixed length', () => {
    const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for (let month = 1; month <= 12; month++) {
      expect(DayKey.daysInMonth(2026, month)).toBe(lengths[month - 1]);
    }
  });

  it('agrees with the epoch-day arithmetic: the day after the last is the 1st', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 9998 }),
        fc.integer({ min: 1, max: 12 }),
        (year, month) => {
          const last = DayKey.epochDayOf(
            year,
            month,
            DayKey.daysInMonth(year, month),
          );
          expect(DayKey.fromEpochDay(last + 1).slice(8)).toBe('01');
          expect(DayKey.fromEpochDay(last).slice(5, 7)).toBe(
            String(month).padStart(2, '0'),
          );
        },
      ),
    );
  });
});

describe('DayKey.compare', () => {
  it('orders by day: string order is day order', () => {
    expect(DayKey.compare(key('2026-03-29'), key('2026-10-25'))).toBe(-1);
    expect(DayKey.compare(key('2026-10-25'), key('2026-03-29'))).toBe(1);
    expect(DayKey.compare(key('2026-10-25'), key('2026-10-25'))).toBe(0);
    expect(
      [key('2026-10-25'), key('2025-12-31'), key('2026-03-29')].sort(
        DayKey.compare,
      ),
    ).toEqual(['2025-12-31', '2026-03-29', '2026-10-25']);
  });
});

describe('DateRange', () => {
  const range = DateRange.of(key('2026-03-01'), key('2026-03-31'));

  it('of() is a plain { fromDayKey, toDayKey } struct', () => {
    expect(range).toEqual({ fromDayKey: '2026-03-01', toDayKey: '2026-03-31' });
  });

  it('is valid unless the end precedes the start', () => {
    expect(DateRange.isValid(range)).toBe(true);
    expect(
      DateRange.isValid(DateRange.of(key('2026-03-01'), key('2026-03-01'))),
    ).toBe(true);
    expect(
      DateRange.isValid(DateRange.of(key('2026-03-02'), key('2026-03-01'))),
    ).toBe(false);
  });

  it('contains both ends and nothing outside them', () => {
    expect(DateRange.contains(range, key('2026-03-01'))).toBe(true);
    expect(DateRange.contains(range, key('2026-03-31'))).toBe(true);
    expect(DateRange.contains(range, key('2026-02-28'))).toBe(false);
    expect(DateRange.contains(range, key('2026-04-01'))).toBe(false);
  });
});
