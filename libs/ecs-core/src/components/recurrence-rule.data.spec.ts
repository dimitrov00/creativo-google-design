import { describe, expect, it } from 'vitest';
import { localDate } from '@core/testing';
import { RecurrenceEndRule } from './recurrence-end-rule.data';
import { RecurrencePattern, WeekOfMonth } from './recurrence-pattern.data';
import { RecurrenceRule } from './recurrence-rule.data';
import { Weekday } from '@core/primitives';

const times = (count: number): RecurrenceEndRule =>
  RecurrenceEndRule.count(count);
const until = (raw: string): RecurrenceEndRule =>
  RecurrenceEndRule.until(localDate(raw));
const DAILY: RecurrencePattern = RecurrencePattern.daily();

function rule(
  pattern: RecurrencePattern,
  end: RecurrenceEndRule,
  interval = 1,
): RecurrenceRule {
  const result = RecurrenceRule.create(pattern, interval, end);
  if (!result.ok) throw new Error(result.error.errorCode);
  return result.value;
}

/** The same rule with another end — the flat slices swapped whole. */
const withEnd = (base: RecurrenceRule, end: RecurrenceEndRule) =>
  RecurrenceRule.of(
    RecurrenceRule.patternOf(base),
    base.recurrenceInterval,
    end,
  );
/** The same rule with another interval. */
const withInterval = (base: RecurrenceRule, interval: number) =>
  RecurrenceRule.of(
    RecurrenceRule.patternOf(base),
    interval,
    RecurrenceEndRule.of(base),
  );

describe('RecurrenceRule — the caps', () => {
  it('are companion members: 99 periods, 366 occurrences', () => {
    expect(RecurrenceRule.MAX_INTERVAL).toBe(99);
    expect(RecurrenceRule.MAX_OCCURRENCES).toBe(366);
  });
});

describe('RecurrenceRule.create — what a rule may say', () => {
  it('refuses an interval outside 1…99 and a count outside 1…366', () => {
    for (const interval of [0, 100, 1.5]) {
      expect(RecurrenceRule.create(DAILY, interval, times(3))).toEqual({
        ok: false,
        error: {
          errorCode: 'SCHEDULING_RECURRENCE_INVALID_INTERVAL',
          interval,
          max: 99,
        },
      });
    }
    for (const count of [0, 367, 2.5]) {
      expect(RecurrenceRule.create(DAILY, 1, times(count))).toEqual({
        ok: false,
        error: {
          errorCode: 'SCHEDULING_RECURRENCE_INVALID_COUNT',
          count,
          max: 366,
        },
      });
    }
    expect(RecurrenceRule.create(DAILY, 99, times(366)).ok).toBe(true);
    expect(RecurrenceRule.create(DAILY, 1, until('2026-12-31')).ok).toBe(true);
  });

  it('refuses a week with no days, and days that do not exist', () => {
    const weekly = RecurrenceRule.create(
      RecurrencePattern.weekly([]),
      1,
      times(3),
    );
    expect(!weekly.ok && weekly.error.errorCode).toBe(
      'SCHEDULING_RECURRENCE_NO_WEEKDAYS',
    );

    const monthly = RecurrenceRule.create(
      RecurrencePattern.monthlyByDate(32),
      1,
      times(3),
    );
    expect(monthly).toEqual({
      ok: false,
      error: {
        errorCode: 'SCHEDULING_RECURRENCE_INVALID_DAY',
        month: null,
        date: 32,
      },
    });

    // 30 February is no day at all; 29 February is a real, quadrennial one.
    const never = RecurrenceRule.create(
      RecurrencePattern.yearly(2, 30),
      1,
      times(3),
    );
    expect(never).toEqual({
      ok: false,
      error: {
        errorCode: 'SCHEDULING_RECURRENCE_INVALID_DAY',
        month: 2,
        date: 30,
      },
    });
    expect(
      RecurrenceRule.create(RecurrencePattern.yearly(2, 29), 1, times(3)).ok,
    ).toBe(true);
    expect(
      RecurrenceRule.create(RecurrencePattern.yearly(13, 1), 1, times(3)).ok,
    ).toBe(false);
  });

  it('refuses a monthly ordinal that is not first…fourth or last', () => {
    const fifth = RecurrenceRule.create(
      RecurrencePattern.monthlyByWeekday(5 as WeekOfMonth, Weekday.Thu),
      1,
      times(3),
    );
    expect(fifth).toEqual({
      ok: false,
      error: {
        errorCode: 'SCHEDULING_RECURRENCE_INVALID_DAY',
        month: null,
        date: 5,
      },
    });
    expect(
      RecurrenceRule.create(
        RecurrencePattern.monthlyByWeekday(WeekOfMonth.Last, Weekday.Thu),
        1,
        times(3),
      ).ok,
    ).toBe(true);
  });

  it('is canonical and flat: the same days in any order, twice over, are the same rule', () => {
    const a = rule(
      RecurrencePattern.weekly([Weekday.Fri, Weekday.Mon, Weekday.Mon]),
      times(4),
    );
    const b = rule(
      RecurrencePattern.weekly([Weekday.Mon, Weekday.Fri]),
      times(4),
    );
    expect(a).toEqual({
      recurrenceFrequency: 'WEEKLY',
      recurrenceWeekdays: [1, 5],
      recurrenceInterval: 1,
      recurrenceEnd: 'COUNT',
      occurrenceCount: 4,
    });
    expect(RecurrenceRule.equals(a, b)).toBe(true);
    expect(RecurrenceRule.equals(a, withEnd(b, times(5)))).toBe(false);
    expect(RecurrenceRule.equals(a, withInterval(b, 2))).toBe(false);
    expect(RecurrenceRule.equals(a, null)).toBe(false);
    expect(RecurrenceRule.frequency(a)).toBe('WEEKLY');
  });
});

describe('RecurrenceRule.equals — per pattern and per end', () => {
  const monthlyDate = rule(
    RecurrencePattern.monthlyByDate(24),
    until('2026-12-31'),
  );
  const monthlyFourth = rule(
    RecurrencePattern.monthlyByWeekday(WeekOfMonth.Fourth, Weekday.Thu),
    until('2026-12-31'),
  );
  const monthlyLast = rule(
    RecurrencePattern.monthlyByWeekday(WeekOfMonth.Last, Weekday.Thu),
    until('2026-12-31'),
  );
  const yearly = rule(RecurrencePattern.yearly(9, 24), times(3));
  const daily = rule(DAILY, times(3));

  it('tells the date from the fourth Thursday from the last one', () => {
    expect(RecurrenceRule.equals(monthlyDate, monthlyDate)).toBe(true);
    expect(RecurrenceRule.equals(monthlyFourth, monthlyFourth)).toBe(true);
    expect(RecurrenceRule.equals(monthlyDate, monthlyFourth)).toBe(false);
    expect(RecurrenceRule.equals(monthlyFourth, monthlyDate)).toBe(false);
    expect(RecurrenceRule.equals(monthlyFourth, monthlyLast)).toBe(false);
  });

  it('never equates different frequencies or ends', () => {
    expect(RecurrenceRule.equals(daily, rule(DAILY, times(3)))).toBe(true);
    expect(RecurrenceRule.equals(daily, yearly)).toBe(false);
    expect(RecurrenceRule.equals(yearly, daily)).toBe(false);
    expect(RecurrenceRule.equals(monthlyDate, daily)).toBe(false);
    expect(
      RecurrenceRule.equals(
        yearly,
        rule(RecurrencePattern.yearly(9, 25), times(3)),
      ),
    ).toBe(false);
    expect(
      RecurrenceRule.equals(
        monthlyDate,
        withEnd(monthlyDate, until('2027-01-01')),
      ),
    ).toBe(false);
    expect(
      RecurrenceRule.equals(monthlyDate, withEnd(monthlyDate, times(3))),
    ).toBe(false);
    expect(
      RecurrenceRule.equals(daily, withEnd(daily, until('2026-12-31'))),
    ).toBe(false);
    const weekly = rule(RecurrencePattern.weekly([Weekday.Mon]), times(3));
    expect(RecurrenceRule.equals(weekly, daily)).toBe(false);
    expect(
      RecurrenceRule.equals(
        weekly,
        rule(RecurrencePattern.weekly([Weekday.Tue]), times(3)),
      ),
    ).toBe(false);
  });
});
