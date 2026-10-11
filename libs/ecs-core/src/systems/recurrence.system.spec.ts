import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  RecurrenceEndRule,
  RecurrenceFrequency,
  RecurrencePattern,
  RecurrenceRule,
  WeekOfMonth,
} from '@core/components';
import { SchedulingErrorCode, Weekday, LocalDate } from '@core/primitives';
import { deepFreeze, localDate, unwrapOk } from '@core/testing';
import { RecurrenceSystem } from './recurrence.system';

/*
 * Copied (not moved) from libs/domain/scheduling/src/lib/recurrence-rule.spec.ts
 * — every case, re-targeted: `RecurrenceRule.create(props)` → the component's
 * `create(pattern, interval, end)`, `RecurrenceSeries.create` →
 * `RecurrenceSystem.series`, weekday names → ISO `Weekday`, error classes →
 * their `errorCode`; flattened by the pass (Law 6: the pattern, interval
 * and end at the rule's root). The legacy spec keeps running against the
 * shim.
 */

const day = (raw: string): LocalDate => localDate(raw);

function rule(
  pattern: RecurrencePattern,
  end: RecurrenceEndRule,
  interval = 1,
): RecurrenceRule {
  return unwrapOk(RecurrenceRule.create(pattern, interval, end));
}

const until = (raw: string): RecurrenceEndRule =>
  RecurrenceEndRule.until(day(raw));
const times = (count: number): RecurrenceEndRule =>
  RecurrenceEndRule.count(count);

const DAILY: RecurrencePattern = RecurrencePattern.daily();

/** The rule's pattern slice — what a start-following answers about. */
const patternOf = (of: RecurrenceRule): RecurrencePattern =>
  RecurrenceRule.patternOf(of);

/** The series' days — or the error's code, to assert refusals. */
function days(start: string, of: RecurrenceRule): readonly string[] | string {
  const series = RecurrenceSystem.series(day(start), of);
  return series.ok ? series.value.localDates : series.error.errorCode;
}

// Fixed points: 2026-09-24 is a Thursday, 2026-09-09 a Wednesday, and
// October 2026 has FIVE Thursdays (1, 8, 15, 22, 29) — so its fourth and its
// last are different days, which is what the monthly cases lean on.

describe('RecurrenceRule — what a rule may say', () => {
  it('refuses an interval outside 1…99 and a count outside 1…366', () => {
    for (const interval of [0, 100, 1.5]) {
      const result = RecurrenceRule.create(DAILY, interval, times(3));
      expect(!result.ok && result.error.errorCode).toBe(
        SchedulingErrorCode.RecurrenceInvalidInterval,
      );
    }
    for (const count of [0, 367, 2.5]) {
      const result = RecurrenceRule.create(DAILY, 1, times(count));
      expect(!result.ok && result.error.errorCode).toBe(
        SchedulingErrorCode.RecurrenceInvalidCount,
      );
    }
    expect(RecurrenceRule.create(DAILY, 99, times(3)).ok).toBe(true);
  });

  it('refuses a week with no days, and days that do not exist', () => {
    const weekly = RecurrenceRule.create(
      RecurrencePattern.weekly([]),
      1,
      times(3),
    );
    expect(!weekly.ok && weekly.error.errorCode).toBe(
      SchedulingErrorCode.RecurrenceNoWeekdays,
    );
    const monthly = RecurrenceRule.create(
      RecurrencePattern.monthlyByDate(32),
      1,
      times(3),
    );
    expect(!monthly.ok && monthly.error.errorCode).toBe(
      SchedulingErrorCode.RecurrenceInvalidDay,
    );
    // 30 February is no day at all; 29 February is a real, quadrennial one.
    const never = RecurrenceRule.create(
      RecurrencePattern.yearly(2, 30),
      1,
      times(3),
    );
    expect(!never.ok && never.error.errorCode).toBe(
      SchedulingErrorCode.RecurrenceInvalidDay,
    );
    expect(
      RecurrenceRule.create(RecurrencePattern.yearly(2, 29), 1, times(3)).ok,
    ).toBe(true);
  });

  it('is canonical: the same days in any order, twice over, are the same rule', () => {
    const a = rule(
      RecurrencePattern.weekly([Weekday.Fri, Weekday.Mon, Weekday.Mon]),
      times(4),
    );
    const b = rule(
      RecurrencePattern.weekly([Weekday.Mon, Weekday.Fri]),
      times(4),
    );
    expect(patternOf(a)).toEqual(
      RecurrencePattern.weekly([Weekday.Mon, Weekday.Fri]),
    );
    expect(RecurrenceRule.equals(a, b)).toBe(true);
    const longer = RecurrenceRule.create(
      patternOf(b),
      b.recurrenceInterval,
      times(5),
    );
    if (!longer.ok) throw new Error(longer.error.errorCode);
    expect(RecurrenceRule.equals(a, longer.value)).toBe(false);
    expect(RecurrenceRule.equals(a, null)).toBe(false);
  });

  it("reads a bare frequency off the start — Google's «Weekly on Thursday»", () => {
    const thursday = day('2026-09-24');
    expect(
      RecurrenceSystem.patternFor(RecurrenceFrequency.Weekly, thursday),
    ).toEqual(RecurrencePattern.weekly([Weekday.Thu]));
    expect(
      RecurrenceSystem.patternFor(RecurrenceFrequency.Monthly, thursday),
    ).toEqual(RecurrencePattern.monthlyByDate(24));
    expect(
      RecurrenceSystem.patternFor(RecurrenceFrequency.Yearly, thursday),
    ).toEqual(RecurrencePattern.yearly(9, 24));
    // Flat: the frequency and its fields at the pattern's root.
    expect(
      RecurrenceSystem.patternFor(RecurrenceFrequency.Monthly, thursday),
    ).toEqual({
      recurrenceFrequency: 'MONTHLY',
      monthlyAnchor: 'DATE',
      monthlyDate: 24,
    });
  });

  it('offers the monthly readings a start has — the date, its week, and «last» in the last seven days', () => {
    expect(RecurrenceSystem.monthlyDaysFor(day('2026-09-24'))).toEqual([
      RecurrencePattern.monthlyByDate(24),
      RecurrencePattern.monthlyByWeekday(4, Weekday.Thu),
      RecurrencePattern.monthlyByWeekday(WeekOfMonth.Last, Weekday.Thu),
    ]);
    expect(RecurrenceSystem.monthlyDaysFor(day('2026-09-09'))).toEqual([
      RecurrencePattern.monthlyByDate(9),
      RecurrencePattern.monthlyByWeekday(2, Weekday.Wed),
    ]);
    // A FIFTH Thursday is only ever the last one.
    expect(RecurrenceSystem.monthlyDaysFor(day('2026-10-29'))).toEqual([
      RecurrencePattern.monthlyByDate(29),
      RecurrencePattern.monthlyByWeekday(WeekOfMonth.Last, Weekday.Thu),
    ]);
  });
});

describe('RecurrenceSystem.series — which days', () => {
  it('walks every day, every weekday, every week, up to and including the end', () => {
    // The three presets the sheet shipped with, day for day.
    const daily = rule(DAILY, until('2026-09-14'));
    expect(days('2026-09-09', daily)).toEqual([
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
      '2026-09-14',
    ]);
    const workweek = rule(
      RecurrencePattern.weekly([
        Weekday.Mon,
        Weekday.Tue,
        Weekday.Wed,
        Weekday.Thu,
        Weekday.Fri,
      ]),
      until('2026-09-14'),
    );
    expect(days('2026-09-09', workweek)).toEqual([
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-14',
    ]);
    const weekly = rule(
      RecurrenceSystem.patternFor(
        RecurrenceFrequency.Weekly,
        day('2026-09-09'),
      ),
      until('2026-09-30'),
    );
    expect(days('2026-09-09', weekly)).toEqual([
      '2026-09-09',
      '2026-09-16',
      '2026-09-23',
      '2026-09-30',
    ]);
  });

  it("counts the interval from the START's own week, month or year", () => {
    const everyOther = rule(DAILY, times(3), 2);
    expect(days('2026-09-09', everyOther)).toEqual([
      '2026-09-09',
      '2026-09-11',
      '2026-09-13',
    ]);
    // Every 2 weeks on Monday and Thursday, from Thursday the 24th: that
    // week's Monday is before the start; the next period is the week of 5 Oct.
    const fortnightly = rule(
      RecurrencePattern.weekly([Weekday.Mon, Weekday.Thu]),
      times(4),
      2,
    );
    expect(days('2026-09-24', fortnightly)).toEqual([
      '2026-09-24',
      '2026-10-05',
      '2026-10-08',
      '2026-10-19',
    ]);
    const biennial = rule(
      RecurrenceSystem.patternFor(
        RecurrenceFrequency.Yearly,
        day('2026-09-24'),
      ),
      times(3),
      2,
    );
    expect(days('2026-09-24', biennial)).toEqual([
      '2026-09-24',
      '2028-09-24',
      '2030-09-24',
    ]);
  });

  it('starts on the first day the rule selects — never on a start it does not', () => {
    const mondaysAndWednesdays = rule(
      RecurrencePattern.weekly([Weekday.Mon, Weekday.Wed]),
      times(3),
    );
    const series = unwrapOk(
      RecurrenceSystem.series(day('2026-09-24'), mondaysAndWednesdays),
    );
    expect(series.localDates).toEqual([
      '2026-09-28',
      '2026-09-30',
      '2026-10-05',
    ]);
    expect(RecurrenceSystem.startsOnStart(series)).toBe(false);
    expect(series.localDates[0]).toBe('2026-09-28');
    expect(series.localDates[series.localDates.length - 1]).toBe('2026-10-05');
    expect(series.localDates).toHaveLength(3);
    expect(series.startLocalDate).toBe('2026-09-24');
  });

  it('skips the months that lack the date rather than moving it', () => {
    const the31st = rule(RecurrencePattern.monthlyByDate(31), times(4));
    expect(days('2026-01-31', the31st)).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
      '2026-07-31',
    ]);
    const leapDay = rule(RecurrencePattern.yearly(2, 29), times(3));
    expect(days('2028-02-29', leapDay)).toEqual([
      '2028-02-29',
      '2032-02-29',
      '2036-02-29',
    ]);
  });

  it('tells the fourth Thursday from the last one', () => {
    const fourth = rule(
      RecurrencePattern.monthlyByWeekday(4, Weekday.Thu),
      times(3),
    );
    expect(days('2026-09-24', fourth)).toEqual([
      '2026-09-24',
      '2026-10-22',
      '2026-11-26',
    ]);
    const last = rule(
      RecurrencePattern.monthlyByWeekday(WeekOfMonth.Last, Weekday.Thu),
      times(3),
    );
    expect(days('2026-09-24', last)).toEqual([
      '2026-09-24',
      '2026-10-29',
      '2026-11-26',
    ]);
  });

  it('refuses an end before the start, a rule that never lands, and more than a year of days', () => {
    expect(days('2026-09-24', rule(DAILY, until('2026-09-23')))).toBe(
      SchedulingErrorCode.RecurrenceEndsBeforeStart,
    );
    // The 31st, from the 1st of April, until the 30th: April has none.
    const the31st = rule(
      RecurrencePattern.monthlyByDate(31),
      until('2026-04-30'),
    );
    expect(days('2026-04-01', the31st)).toBe(
      SchedulingErrorCode.RecurrenceNeverOccurs,
    );
    // A year of days fits; a day more does not.
    expect(days('2026-01-01', rule(DAILY, until('2027-01-01')))).toHaveLength(
      RecurrenceRule.MAX_OCCURRENCES,
    );
    expect(days('2026-01-01', rule(DAILY, until('2027-01-02')))).toBe(
      SchedulingErrorCode.RecurrenceTooLong,
    );
    // An end far beyond the cap is refused, not walked to.
    expect(days('2026-01-01', rule(DAILY, until('2400-01-01')))).toBe(
      SchedulingErrorCode.RecurrenceTooLong,
    );
  });

  it('gives up on a pattern that cannot land instead of walking forever', () => {
    // The 31st, every twelfth month, from a February: always February.
    const never = rule(RecurrencePattern.monthlyByDate(31), times(2), 12);
    expect(days('2026-02-01', never)).toBe(
      SchedulingErrorCode.RecurrenceNeverOccurs,
    );
  });
});

describe('RecurrenceSystem.followingStart — the start moved', () => {
  const thursday = day('2026-09-24');

  it("carries the start's own weekday, date or anniversary along", () => {
    const weekly = rule(
      RecurrenceSystem.patternFor(RecurrenceFrequency.Weekly, thursday),
      times(3),
    );
    expect(
      patternOf(
        RecurrenceSystem.followingStart(weekly, thursday, day('2026-09-25')),
      ),
    ).toEqual(RecurrencePattern.weekly([Weekday.Fri]));
    const monthly = rule(
      RecurrenceSystem.patternFor(RecurrenceFrequency.Monthly, thursday),
      times(3),
    );
    expect(
      patternOf(
        RecurrenceSystem.followingStart(monthly, thursday, day('2026-10-05')),
      ),
    ).toEqual(RecurrencePattern.monthlyByDate(5));
    const yearly = rule(
      RecurrenceSystem.patternFor(RecurrenceFrequency.Yearly, thursday),
      times(3),
    );
    expect(
      patternOf(
        RecurrenceSystem.followingStart(yearly, thursday, day('2026-12-24')),
      ),
    ).toEqual(RecurrencePattern.yearly(12, 24));
  });

  it('keeps what the user shaped — «Monday and Wednesday» is about those days', () => {
    const shaped = rule(
      RecurrencePattern.weekly([Weekday.Mon, Weekday.Wed]),
      times(3),
    );
    expect(
      RecurrenceSystem.followingStart(shaped, thursday, day('2026-09-25')),
    ).toBe(shaped);
    const tuesdays = rule(RecurrencePattern.weekly([Weekday.Tue]), times(3));
    expect(
      RecurrenceSystem.followingStart(tuesdays, thursday, day('2026-09-25')),
    ).toBe(tuesdays);
  });

  it('keeps a monthly LAST a last where the new start can be one, and an ordinal where it cannot', () => {
    const lastThursday: RecurrencePattern = RecurrencePattern.monthlyByWeekday(
      WeekOfMonth.Last,
      Weekday.Thu,
    );
    const last = rule(lastThursday, times(3));
    expect(
      patternOf(
        RecurrenceSystem.followingStart(last, thursday, day('2026-10-29')),
      ),
    ).toEqual(lastThursday);
    expect(
      patternOf(
        RecurrenceSystem.followingStart(last, thursday, day('2026-10-07')),
      ),
    ).toEqual(RecurrencePattern.monthlyByWeekday(1, Weekday.Wed));
    // The fourth Thursday, moved to a FIFTH one, can only be the last.
    const fourth = rule(
      RecurrencePattern.monthlyByWeekday(4, Weekday.Thu),
      times(3),
    );
    expect(
      patternOf(
        RecurrenceSystem.followingStart(fourth, thursday, day('2026-10-29')),
      ),
    ).toEqual(lastThursday);
  });
});

describe('RecurrenceSystem.occurrences — a bounded window of a rule', () => {
  it('stops at the window end, the rule end and the count, whichever comes first', () => {
    const daily = rule(DAILY, until('2026-09-20'));
    expect(
      RecurrenceSystem.occurrences(daily, day('2026-09-09'), day('2026-09-12')),
    ).toEqual(['2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12']);
    expect(
      RecurrenceSystem.occurrences(daily, day('2026-09-18'), day('2026-09-30')),
    ).toEqual(['2026-09-18', '2026-09-19', '2026-09-20']);
    const thrice = rule(DAILY, times(3));
    expect(
      RecurrenceSystem.occurrences(
        thrice,
        day('2026-09-09'),
        day('2026-12-31'),
      ),
    ).toEqual(['2026-09-09', '2026-09-10', '2026-09-11']);
  });

  it('never materialises more than MAX_OCCURRENCES days, however wide the window', () => {
    const daily = rule(DAILY, until('2400-01-01'));
    const all = RecurrenceSystem.occurrences(
      daily,
      day('2026-01-01'),
      day('2399-12-31'),
    );
    expect(all).toHaveLength(RecurrenceRule.MAX_OCCURRENCES);
    expect(all[all.length - 1]).toBe('2027-01-01');
  });

  it('is empty when the window closes before it opens', () => {
    expect(
      RecurrenceSystem.occurrences(
        rule(DAILY, times(5)),
        day('2026-09-09'),
        day('2026-09-08'),
      ),
    ).toEqual([]);
  });
});

describe('RecurrenceSystem — purity and properties', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const start = day('2026-09-24');
    const shaped = deepFreeze(
      rule(
        RecurrencePattern.monthlyByWeekday(WeekOfMonth.Last, Weekday.Thu),
        times(6),
        2,
      ),
    );
    const before = JSON.stringify(shaped);
    const once = RecurrenceSystem.series(start, shaped);
    const twice = RecurrenceSystem.series(start, shaped);
    expect(twice).toEqual(once);
    expect(
      RecurrenceSystem.followingStart(shaped, start, day('2026-10-29')),
    ).toEqual(
      RecurrenceSystem.followingStart(shaped, start, day('2026-10-29')),
    );
    expect(JSON.stringify(shaped)).toBe(before);
  });

  /** Epoch day → key, in a range the property tests walk. */
  const anyStart = fc
    .integer({
      min: LocalDate.epochDayOf(2000, 1, 1),
      max: LocalDate.epochDayOf(2099, 12, 31),
    })
    .map((epochDay) => LocalDate.fromEpochDay(epochDay));

  it('a weekly series equals the brute-force scan of every day in its weeks', () => {
    fc.assert(
      fc.property(
        anyStart,
        fc.uniqueArray(fc.integer({ min: 1, max: 7 }), {
          minLength: 1,
          maxLength: 7,
        }),
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 1, max: 60 }),
        (start, isoDays, interval, count) => {
          const weekly = rule(
            RecurrencePattern.weekly(isoDays as Weekday[]),
            times(count),
            interval,
          );
          const got = RecurrenceSystem.series(start, weekly);
          // Brute force: every day from the start, kept when its weekday is
          // named and its ISO week is an interval-th week from the start's.
          const weekdayOf = (epochDay: number) =>
            LocalDate.weekday(LocalDate.fromEpochDay(epochDay));
          const from = LocalDate.toEpochDay(start);
          const monday = from - (weekdayOf(from) - 1);
          const expected: string[] = [];
          for (let d = from; expected.length < count; d++) {
            const weeks = Math.floor((d - monday) / 7);
            if (weeks % interval === 0 && isoDays.includes(weekdayOf(d))) {
              expected.push(LocalDate.fromEpochDay(d));
            }
          }
          expect(got.ok && got.value.localDates).toEqual(expected);
        },
      ),
    );
  });

  it('every occurrence is ascending, on or after the start, and selected by the rule', () => {
    fc.assert(
      fc.property(
        anyStart,
        fc.integer({ min: 1, max: 28 }),
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 1, max: 40 }),
        (start, date, interval, count) => {
          const monthly = rule(
            RecurrencePattern.monthlyByDate(date),
            times(count),
            interval,
          );
          const got = RecurrenceSystem.series(start, monthly);
          if (!got.ok) return;
          const keys = got.value.localDates;
          expect(keys.length).toBeLessThanOrEqual(count);
          let previous: LocalDate | null = null;
          for (const key of keys) {
            expect(key >= start).toBe(true);
            if (previous !== null) expect(key > previous).toBe(true);
            previous = key;
            expect(Number(key.slice(8, 10))).toBe(date);
          }
        },
      ),
    );
  });
});
