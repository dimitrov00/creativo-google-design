import { describe, expect, it } from 'vitest';
import { DayKey } from './day-key.data';
import {
  Frequency,
  MonthlyDayKind,
  RecurrenceEndKind,
  RecurrenceRule,
  WeekOfMonth,
} from './recurrence-rule.data';
import { Weekday } from './weekday.data';

const times = (count: number): RecurrenceRule.End => ({
  kind: RecurrenceEndKind.Count,
  count,
});
const until = (raw: string): RecurrenceRule.End => ({
  kind: RecurrenceEndKind.Until,
  dayKey: DayKey.of(raw),
});
const DAILY: RecurrenceRule.Pattern = { kind: Frequency.Daily };

function rule(
  pattern: RecurrenceRule.Pattern,
  end: RecurrenceRule.End,
  interval = 1,
): RecurrenceRule {
  const result = RecurrenceRule.create(pattern, interval, end);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

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
          code: 'scheduling.recurrence.invalid_interval',
          interval,
          max: 99,
        },
      });
    }
    for (const count of [0, 367, 2.5]) {
      expect(RecurrenceRule.create(DAILY, 1, times(count))).toEqual({
        ok: false,
        error: { code: 'scheduling.recurrence.invalid_count', count, max: 366 },
      });
    }
    expect(RecurrenceRule.create(DAILY, 99, times(366)).ok).toBe(true);
    expect(RecurrenceRule.create(DAILY, 1, until('2026-12-31')).ok).toBe(true);
  });

  it('refuses a week with no days, and days that do not exist', () => {
    const weekly = RecurrenceRule.create(
      { kind: Frequency.Weekly, weekdays: [] },
      1,
      times(3),
    );
    expect(!weekly.ok && weekly.error.code).toBe(
      'scheduling.recurrence.no_weekdays',
    );

    const monthly = RecurrenceRule.create(
      { kind: Frequency.Monthly, day: { kind: MonthlyDayKind.Date, date: 32 } },
      1,
      times(3),
    );
    expect(monthly).toEqual({
      ok: false,
      error: {
        code: 'scheduling.recurrence.invalid_day',
        month: null,
        date: 32,
      },
    });

    // 30 February is no day at all; 29 February is a real, quadrennial one.
    const never = RecurrenceRule.create(
      { kind: Frequency.Yearly, month: 2, date: 30 },
      1,
      times(3),
    );
    expect(never).toEqual({
      ok: false,
      error: { code: 'scheduling.recurrence.invalid_day', month: 2, date: 30 },
    });
    expect(
      RecurrenceRule.create(
        { kind: Frequency.Yearly, month: 2, date: 29 },
        1,
        times(3),
      ).ok,
    ).toBe(true);
    expect(
      RecurrenceRule.create(
        { kind: Frequency.Yearly, month: 13, date: 1 },
        1,
        times(3),
      ).ok,
    ).toBe(false);
  });

  it('refuses a monthly ordinal that is not first…fourth or last', () => {
    const fifth = RecurrenceRule.create(
      {
        kind: Frequency.Monthly,
        day: {
          kind: MonthlyDayKind.Weekday,
          week: 5 as WeekOfMonth,
          weekday: Weekday.Thu,
        },
      },
      1,
      times(3),
    );
    expect(fifth).toEqual({
      ok: false,
      error: {
        code: 'scheduling.recurrence.invalid_day',
        month: null,
        date: 5,
      },
    });
    expect(
      RecurrenceRule.create(
        {
          kind: Frequency.Monthly,
          day: {
            kind: MonthlyDayKind.Weekday,
            week: WeekOfMonth.Last,
            weekday: Weekday.Thu,
          },
        },
        1,
        times(3),
      ).ok,
    ).toBe(true);
  });

  it('is canonical: the same days in any order, twice over, are the same rule', () => {
    const a = rule(
      {
        kind: Frequency.Weekly,
        weekdays: [Weekday.Fri, Weekday.Mon, Weekday.Mon],
      },
      times(4),
    );
    const b = rule(
      { kind: Frequency.Weekly, weekdays: [Weekday.Mon, Weekday.Fri] },
      times(4),
    );
    expect(a.pattern).toEqual({ kind: 'weekly', weekdays: [1, 5] });
    expect(RecurrenceRule.equals(a, b)).toBe(true);
    expect(RecurrenceRule.equals(a, { ...b, end: times(5) })).toBe(false);
    expect(RecurrenceRule.equals(a, { ...b, interval: 2 })).toBe(false);
    expect(RecurrenceRule.equals(a, null)).toBe(false);
    expect(RecurrenceRule.frequency(a)).toBe(Frequency.Weekly);
  });
});

describe('RecurrenceRule.equals — per pattern and per end', () => {
  const monthlyDate = rule(
    { kind: Frequency.Monthly, day: { kind: MonthlyDayKind.Date, date: 24 } },
    until('2026-12-31'),
  );
  const monthlyFourth = rule(
    {
      kind: Frequency.Monthly,
      day: {
        kind: MonthlyDayKind.Weekday,
        week: WeekOfMonth.Fourth,
        weekday: Weekday.Thu,
      },
    },
    until('2026-12-31'),
  );
  const monthlyLast = rule(
    {
      kind: Frequency.Monthly,
      day: {
        kind: MonthlyDayKind.Weekday,
        week: WeekOfMonth.Last,
        weekday: Weekday.Thu,
      },
    },
    until('2026-12-31'),
  );
  const yearly = rule({ kind: Frequency.Yearly, month: 9, date: 24 }, times(3));
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
        rule({ kind: Frequency.Yearly, month: 9, date: 25 }, times(3)),
      ),
    ).toBe(false);
    expect(
      RecurrenceRule.equals(monthlyDate, {
        ...monthlyDate,
        end: until('2027-01-01'),
      }),
    ).toBe(false);
    expect(
      RecurrenceRule.equals(monthlyDate, { ...monthlyDate, end: times(3) }),
    ).toBe(false);
    expect(
      RecurrenceRule.equals(daily, { ...daily, end: until('2026-12-31') }),
    ).toBe(false);
    const weekly = rule(
      { kind: Frequency.Weekly, weekdays: [Weekday.Mon] },
      times(3),
    );
    expect(RecurrenceRule.equals(weekly, daily)).toBe(false);
    expect(
      RecurrenceRule.equals(
        weekly,
        rule({ kind: Frequency.Weekly, weekdays: [Weekday.Tue] }, times(3)),
      ),
    ).toBe(false);
  });
});
