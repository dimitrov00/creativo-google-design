import { describe, expect, it } from 'vitest';
import { CalendarDay } from './calendar-day';
import {
  type RecurrenceEnd,
  type RecurrenceRuleProps,
  RecurrenceRule,
  RecurrenceSeries,
} from './recurrence-rule';
import {
  EmptyRecurrenceWeekdaysError,
  InvalidRecurrenceCountError,
  InvalidRecurrenceDayError,
  InvalidRecurrenceIntervalError,
  RecurrenceEndsBeforeStartError,
  RecurrenceNeverOccursError,
  RecurrenceTooLongError,
} from './recurrence-rule.errors';

const ZONE = 'Europe/Sofia';

function day(key: string): CalendarDay {
  const result = CalendarDay.create(key, ZONE);
  if (result.isFailure()) throw new Error(`bad fixture ${key}`);
  return result.value;
}

function rule(props: RecurrenceRuleProps): RecurrenceRule {
  const result = RecurrenceRule.create(props);
  if (result.isFailure()) throw result.error;
  return result.value;
}

const until = (key: string): RecurrenceEnd => ({
  kind: 'until',
  day: day(key),
});
const times = (count: number): RecurrenceEnd => ({ kind: 'count', count });

/** The series' days as keys — or the error's class name, to assert refusals. */
function days(start: string, of: RecurrenceRule): readonly string[] | string {
  const series = RecurrenceSeries.create(day(start), of);
  return series.isSuccess()
    ? series.value.keys()
    : series.error.constructor.name;
}

// Fixed points: 2026-09-24 is a Thursday, 2026-09-09 a Wednesday, and
// October 2026 has FIVE Thursdays (1, 8, 15, 22, 29) — so its fourth and its
// last are different days, which is what the monthly cases lean on.

describe('RecurrenceRule — what a rule may say', () => {
  it('refuses an interval outside 1…99 and a count outside 1…366', () => {
    const base = { pattern: { frequency: 'daily' as const }, end: times(3) };
    for (const interval of [0, 100, 1.5]) {
      const result = RecurrenceRule.create({ ...base, interval });
      expect(result.isFailure() && result.error).toBeInstanceOf(
        InvalidRecurrenceIntervalError,
      );
    }
    for (const count of [0, 367, 2.5]) {
      const result = RecurrenceRule.create({ ...base, end: times(count) });
      expect(result.isFailure() && result.error).toBeInstanceOf(
        InvalidRecurrenceCountError,
      );
    }
    expect(RecurrenceRule.create({ ...base, interval: 99 }).isSuccess()).toBe(
      true,
    );
  });

  it('refuses a week with no days, and days that do not exist', () => {
    const weekly = RecurrenceRule.create({
      pattern: { frequency: 'weekly', weekdays: [] },
      end: times(3),
    });
    expect(weekly.isFailure() && weekly.error).toBeInstanceOf(
      EmptyRecurrenceWeekdaysError,
    );
    const monthly = RecurrenceRule.create({
      pattern: { frequency: 'monthly', day: { by: 'date', date: 32 } },
      end: times(3),
    });
    expect(monthly.isFailure() && monthly.error).toBeInstanceOf(
      InvalidRecurrenceDayError,
    );
    // 30 February is no day at all; 29 February is a real, quadrennial one.
    const never = RecurrenceRule.create({
      pattern: { frequency: 'yearly', month: 2, date: 30 },
      end: times(3),
    });
    expect(never.isFailure() && never.error).toBeInstanceOf(
      InvalidRecurrenceDayError,
    );
    expect(
      RecurrenceRule.create({
        pattern: { frequency: 'yearly', month: 2, date: 29 },
        end: times(3),
      }).isSuccess(),
    ).toBe(true);
  });

  it('is canonical: the same days in any order, twice over, are the same rule', () => {
    const a = rule({
      pattern: {
        frequency: 'weekly',
        weekdays: ['friday', 'monday', 'monday'],
      },
      end: times(4),
    });
    const b = rule({
      pattern: { frequency: 'weekly', weekdays: ['monday', 'friday'] },
      end: times(4),
    });
    expect(a.pattern).toEqual({
      frequency: 'weekly',
      weekdays: ['monday', 'friday'],
    });
    expect(a.equals(b)).toBe(true);
    const longer = b.with({ end: times(5) });
    if (longer.isFailure()) throw longer.error;
    expect(a.equals(longer.value)).toBe(false);
    expect(a.equals(null)).toBe(false);
  });

  it("reads a bare frequency off the start — Google's «Weekly on Thursday»", () => {
    const thursday = day('2026-09-24');
    expect(RecurrenceRule.patternFor('weekly', thursday)).toEqual({
      frequency: 'weekly',
      weekdays: ['thursday'],
    });
    expect(RecurrenceRule.patternFor('monthly', thursday)).toEqual({
      frequency: 'monthly',
      day: { by: 'date', date: 24 },
    });
    expect(RecurrenceRule.patternFor('yearly', thursday)).toEqual({
      frequency: 'yearly',
      month: 9,
      date: 24,
    });
  });

  it('offers the monthly readings a start has — the date, its week, and «last» in the last seven days', () => {
    expect(RecurrenceRule.monthlyDaysFor(day('2026-09-24'))).toEqual([
      { by: 'date', date: 24 },
      { by: 'weekday', week: 4, weekday: 'thursday' },
      { by: 'weekday', week: -1, weekday: 'thursday' },
    ]);
    expect(RecurrenceRule.monthlyDaysFor(day('2026-09-09'))).toEqual([
      { by: 'date', date: 9 },
      { by: 'weekday', week: 2, weekday: 'wednesday' },
    ]);
    // A FIFTH Thursday is only ever the last one.
    expect(RecurrenceRule.monthlyDaysFor(day('2026-10-29'))).toEqual([
      { by: 'date', date: 29 },
      { by: 'weekday', week: -1, weekday: 'thursday' },
    ]);
  });
});

describe('RecurrenceSeries — which days', () => {
  it('walks every day, every weekday, every week, up to and including the end', () => {
    // The three presets the sheet shipped with, day for day.
    const daily = rule({
      pattern: { frequency: 'daily' },
      end: until('2026-09-14'),
    });
    expect(days('2026-09-09', daily)).toEqual([
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
      '2026-09-14',
    ]);
    const workweek = rule({
      pattern: {
        frequency: 'weekly',
        weekdays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      },
      end: until('2026-09-14'),
    });
    expect(days('2026-09-09', workweek)).toEqual([
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-14',
    ]);
    const weekly = rule({
      pattern: RecurrenceRule.patternFor('weekly', day('2026-09-09')),
      end: until('2026-09-30'),
    });
    expect(days('2026-09-09', weekly)).toEqual([
      '2026-09-09',
      '2026-09-16',
      '2026-09-23',
      '2026-09-30',
    ]);
  });

  it("counts the interval from the START's own week, month or year", () => {
    const everyOther = rule({
      pattern: { frequency: 'daily' },
      interval: 2,
      end: times(3),
    });
    expect(days('2026-09-09', everyOther)).toEqual([
      '2026-09-09',
      '2026-09-11',
      '2026-09-13',
    ]);
    // Every 2 weeks on Monday and Thursday, from Thursday the 24th: that
    // week's Monday is before the start; the next period is the week of 5 Oct.
    const fortnightly = rule({
      pattern: { frequency: 'weekly', weekdays: ['monday', 'thursday'] },
      interval: 2,
      end: times(4),
    });
    expect(days('2026-09-24', fortnightly)).toEqual([
      '2026-09-24',
      '2026-10-05',
      '2026-10-08',
      '2026-10-19',
    ]);
    const biennial = rule({
      pattern: RecurrenceRule.patternFor('yearly', day('2026-09-24')),
      interval: 2,
      end: times(3),
    });
    expect(days('2026-09-24', biennial)).toEqual([
      '2026-09-24',
      '2028-09-24',
      '2030-09-24',
    ]);
  });

  it('starts on the first day the rule selects — never on a start it does not', () => {
    const mondaysAndWednesdays = rule({
      pattern: { frequency: 'weekly', weekdays: ['monday', 'wednesday'] },
      end: times(3),
    });
    const series = RecurrenceSeries.create(
      day('2026-09-24'),
      mondaysAndWednesdays,
    );
    if (series.isFailure()) throw series.error;
    expect(series.value.keys()).toEqual([
      '2026-09-28',
      '2026-09-30',
      '2026-10-05',
    ]);
    expect(series.value.startsOnStart()).toBe(false);
    expect(series.value.first.key()).toBe('2026-09-28');
    expect(series.value.last.key()).toBe('2026-10-05');
    expect(series.value.count).toBe(3);
    expect(series.value.first.zone).toBe(ZONE);
  });

  it('skips the months that lack the date rather than moving it', () => {
    const the31st = rule({
      pattern: { frequency: 'monthly', day: { by: 'date', date: 31 } },
      end: times(4),
    });
    expect(days('2026-01-31', the31st)).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
      '2026-07-31',
    ]);
    const leapDay = rule({
      pattern: { frequency: 'yearly', month: 2, date: 29 },
      end: times(3),
    });
    expect(days('2028-02-29', leapDay)).toEqual([
      '2028-02-29',
      '2032-02-29',
      '2036-02-29',
    ]);
  });

  it('tells the fourth Thursday from the last one', () => {
    const fourth = rule({
      pattern: {
        frequency: 'monthly',
        day: { by: 'weekday', week: 4, weekday: 'thursday' },
      },
      end: times(3),
    });
    expect(days('2026-09-24', fourth)).toEqual([
      '2026-09-24',
      '2026-10-22',
      '2026-11-26',
    ]);
    const last = rule({
      pattern: {
        frequency: 'monthly',
        day: { by: 'weekday', week: -1, weekday: 'thursday' },
      },
      end: times(3),
    });
    expect(days('2026-09-24', last)).toEqual([
      '2026-09-24',
      '2026-10-29',
      '2026-11-26',
    ]);
  });

  it('refuses an end before the start, a rule that never lands, and more than a year of days', () => {
    const daily = { pattern: { frequency: 'daily' as const } };
    expect(
      days('2026-09-24', rule({ ...daily, end: until('2026-09-23') })),
    ).toBe(RecurrenceEndsBeforeStartError.name);
    // The 31st, from the 1st of April, until the 30th: April has none.
    const the31st = rule({
      pattern: { frequency: 'monthly', day: { by: 'date', date: 31 } },
      end: until('2026-04-30'),
    });
    expect(days('2026-04-01', the31st)).toBe(RecurrenceNeverOccursError.name);
    // A year of days fits; a day more does not.
    expect(
      days('2026-01-01', rule({ ...daily, end: until('2027-01-01') })),
    ).toHaveLength(RecurrenceRule.MAX_OCCURRENCES);
    expect(
      days('2026-01-01', rule({ ...daily, end: until('2027-01-02') })),
    ).toBe(RecurrenceTooLongError.name);
    // An end far beyond the cap is refused, not walked to.
    expect(
      days('2026-01-01', rule({ ...daily, end: until('2400-01-01') })),
    ).toBe(RecurrenceTooLongError.name);
  });

  it('gives up on a pattern that cannot land instead of walking forever', () => {
    // The 31st, every twelfth month, from a February: always February.
    const never = rule({
      pattern: { frequency: 'monthly', day: { by: 'date', date: 31 } },
      interval: 12,
      end: times(2),
    });
    expect(days('2026-02-01', never)).toBe(RecurrenceNeverOccursError.name);
  });
});

describe('RecurrenceRule.followingStart — the start moved', () => {
  const thursday = day('2026-09-24');

  it("carries the start's own weekday, date or anniversary along", () => {
    const weekly = rule({
      pattern: RecurrenceRule.patternFor('weekly', thursday),
      end: times(3),
    });
    expect(weekly.followingStart(thursday, day('2026-09-25')).pattern).toEqual({
      frequency: 'weekly',
      weekdays: ['friday'],
    });
    const monthly = rule({
      pattern: RecurrenceRule.patternFor('monthly', thursday),
      end: times(3),
    });
    expect(monthly.followingStart(thursday, day('2026-10-05')).pattern).toEqual(
      {
        frequency: 'monthly',
        day: { by: 'date', date: 5 },
      },
    );
    const yearly = rule({
      pattern: RecurrenceRule.patternFor('yearly', thursday),
      end: times(3),
    });
    expect(yearly.followingStart(thursday, day('2026-12-24')).pattern).toEqual({
      frequency: 'yearly',
      month: 12,
      date: 24,
    });
  });

  it('keeps what the user shaped — «Monday and Wednesday» is about those days', () => {
    const shaped = rule({
      pattern: { frequency: 'weekly', weekdays: ['monday', 'wednesday'] },
      end: times(3),
    });
    expect(shaped.followingStart(thursday, day('2026-09-25'))).toBe(shaped);
    const tuesdays = rule({
      pattern: { frequency: 'weekly', weekdays: ['tuesday'] },
      end: times(3),
    });
    expect(tuesdays.followingStart(thursday, day('2026-09-25'))).toBe(tuesdays);
  });

  it('keeps a monthly LAST a last where the new start can be one, and an ordinal where it cannot', () => {
    const last = rule({
      pattern: {
        frequency: 'monthly',
        day: { by: 'weekday', week: -1, weekday: 'thursday' },
      },
      end: times(3),
    });
    expect(last.followingStart(thursday, day('2026-10-29')).pattern).toEqual({
      frequency: 'monthly',
      day: { by: 'weekday', week: -1, weekday: 'thursday' },
    });
    expect(last.followingStart(thursday, day('2026-10-07')).pattern).toEqual({
      frequency: 'monthly',
      day: { by: 'weekday', week: 1, weekday: 'wednesday' },
    });
    // The fourth Thursday, moved to a FIFTH one, can only be the last.
    const fourth = rule({
      pattern: {
        frequency: 'monthly',
        day: { by: 'weekday', week: 4, weekday: 'thursday' },
      },
      end: times(3),
    });
    expect(fourth.followingStart(thursday, day('2026-10-29')).pattern).toEqual({
      frequency: 'monthly',
      day: { by: 'weekday', week: -1, weekday: 'thursday' },
    });
  });
});
