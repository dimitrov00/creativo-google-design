import { describe, expect, it } from 'vitest';
import { LocalDate, Weekday } from '@core/primitives';
import { SchedulingErrorCode } from '@core/errors';
import {
  MonthlyAnchor,
  RecurrenceEnd,
  type RecurrenceEndRule,
  RecurrenceFrequency,
  type RecurrenceRule,
} from '@core/components';
import { RecurrenceSystem, RepeatPreset } from '@core/systems';
import { unwrapOk } from '@core/testing';
import {
  RECURRENCE_END_WORD,
  RECURRENCE_FREQUENCY_WORD,
  REPEAT_PRESETS,
  REPEAT_PRESET_WORD,
  WEEKDAY_WORD,
  defaultEnd,
  presetOf,
  ruleForCustom,
  ruleForEndKind,
  ruleForFrequency,
  ruleForPreset,
  ruleForStart,
  withCount,
  withInterval,
  withWeekdays,
} from './block-repeat';

function day(key: string): LocalDate {
  return unwrapOk(LocalDate.parse(key));
}

function keys(
  start: LocalDate,
  rule: RecurrenceRule | null,
): readonly string[] {
  if (rule === null) return [start];
  return unwrapOk(RecurrenceSystem.series(start, rule)).localDates;
}

function endKey(end: RecurrenceEndRule): string {
  return end.recurrenceEnd === RecurrenceEnd.Until
    ? end.untilLocalDate
    : `×${end.occurrenceCount}`;
}

// 2026-09-24 is a Thursday.
const thursday = day('2026-09-24');

describe('the repeat page policy', () => {
  it('ends a series by default on a DATE — four weeks, half a year, four years', () => {
    expect(endKey(defaultEnd(RecurrenceFrequency.Daily, thursday))).toBe(
      '2026-10-22',
    );
    expect(endKey(defaultEnd(RecurrenceFrequency.Weekly, thursday))).toBe(
      '2026-10-22',
    );
    expect(endKey(defaultEnd(RecurrenceFrequency.Monthly, thursday))).toBe(
      '2027-03-24',
    );
    expect(endKey(defaultEnd(RecurrenceFrequency.Yearly, thursday))).toBe(
      '2030-09-24',
    );
    // The 31st has no 31st six months on: the month's last day instead.
    expect(
      endKey(defaultEnd(RecurrenceFrequency.Monthly, day('2026-08-31'))),
    ).toBe('2027-02-28');
  });

  it('turns every shortcut into its rule from the start — and reads it back', () => {
    for (const preset of [
      RepeatPreset.Daily,
      RepeatPreset.Weekdays,
      RepeatPreset.Weekly,
      RepeatPreset.Monthly,
      RepeatPreset.Yearly,
    ]) {
      const rule = ruleForPreset(preset, thursday, null);
      expect(presetOf(rule, thursday)).toBe(preset);
    }
    expect(ruleForPreset(RepeatPreset.Never, thursday, null)).toBeNull();
    expect(presetOf(null, thursday)).toBe(RepeatPreset.Never);
    // «Всяка седмица» from a Thursday is Thursdays, for four weeks.
    expect(
      keys(thursday, ruleForPreset(RepeatPreset.Weekly, thursday, null)),
    ).toEqual([
      '2026-09-24',
      '2026-10-01',
      '2026-10-08',
      '2026-10-15',
      '2026-10-22',
    ]);
    // «Делнични дни» skips the weekend.
    expect(
      keys(
        thursday,
        ruleForPreset(RepeatPreset.Weekdays, thursday, null),
      ).slice(0, 4),
    ).toEqual(['2026-09-24', '2026-09-25', '2026-09-28', '2026-09-29']);
  });

  it('is no shortcut once shaped: another day, another interval', () => {
    const weekly = ruleForPreset(RepeatPreset.Weekly, thursday, null);
    if (weekly === null) throw new Error('fixture');
    const fortnightly = unwrapOk(withInterval(weekly, 2));
    expect(presetOf(fortnightly, thursday)).toBeNull();
    const mondays = unwrapOk(withWeekdays(weekly, [Weekday.Mon]));
    expect(presetOf(mondays, thursday)).toBeNull();
  });

  it('keeps the end a series had when the shortcut changes, unless it no longer fits', () => {
    const daily = ruleForPreset(RepeatPreset.Daily, thursday, null);
    const weekly = ruleForPreset(RepeatPreset.Weekly, thursday, daily);
    expect(weekly && endKey(weekly)).toBe('2026-10-22');
    // A yearly series four years long turned daily would be ~1,500 days:
    // past the cap, so the new frequency's own end is taken instead.
    const yearly = ruleForPreset(RepeatPreset.Yearly, thursday, null);
    const dailyAgain = ruleForPreset(RepeatPreset.Daily, thursday, yearly);
    expect(dailyAgain && endKey(dailyAgain)).toBe('2026-10-22');
  });

  it("starts «Персонализирано» at Google's own default, or keeps the rule there is", () => {
    const custom = ruleForCustom(thursday, null);
    expect(custom).toMatchObject({
      recurrenceFrequency: RecurrenceFrequency.Weekly,
      recurrenceWeekdays: [Weekday.Thu],
    });
    const monthly = ruleForPreset(RepeatPreset.Monthly, thursday, null);
    expect(ruleForCustom(thursday, monthly)).toBe(monthly);
  });

  it("changes the frequency to the start's own days for it, keeping interval and end", () => {
    const weekly = ruleForPreset(RepeatPreset.Weekly, thursday, null);
    if (weekly === null) throw new Error('fixture');
    const every2 = unwrapOk(withInterval(weekly, 2));
    const monthly = ruleForFrequency(
      every2,
      RecurrenceFrequency.Monthly,
      thursday,
    );
    expect(monthly).toMatchObject({
      recurrenceFrequency: RecurrenceFrequency.Monthly,
      monthlyAnchor: MonthlyAnchor.Date,
      monthlyDate: 24,
    });
    expect(monthly.recurrenceInterval).toBe(2);
  });

  it('switches how it ends WITHOUT changing the days', () => {
    const weekly = ruleForPreset(RepeatPreset.Weekly, thursday, null);
    if (weekly === null) throw new Error('fixture');
    const counted = ruleForEndKind(weekly, RecurrenceEnd.Count, thursday);
    expect(counted).toMatchObject({
      recurrenceEnd: RecurrenceEnd.Count,
      occurrenceCount: 5,
    });
    expect(keys(thursday, counted)).toEqual(keys(thursday, weekly));
    const dated = ruleForEndKind(counted, RecurrenceEnd.Until, thursday);
    expect(endKey(dated)).toBe('2026-10-22');
    expect(keys(thursday, dated)).toEqual(keys(thursday, weekly));
  });

  it("follows the frame to another day: the start's weekday moves, an overtaken end moves on", () => {
    const weekly = ruleForPreset(RepeatPreset.Weekly, thursday, null);
    if (weekly === null) throw new Error('fixture');
    const friday = ruleForStart(weekly, thursday, day('2026-09-25'));
    expect(friday).toMatchObject({
      recurrenceFrequency: RecurrenceFrequency.Weekly,
      recurrenceWeekdays: [Weekday.Fri],
    });
    expect(endKey(friday)).toBe('2026-10-22');
    // Stepped past its own end: the end moves four weeks on from there.
    const later = ruleForStart(weekly, thursday, day('2026-11-05'));
    expect(endKey(later)).toBe('2026-12-03');
  });

  it('refuses a typed figure no rule can hold, in the domain’s words', () => {
    const weekly = ruleForPreset(RepeatPreset.Weekly, thursday, null);
    if (weekly === null) throw new Error('fixture');
    const none = withInterval(weekly, 0);
    expect(!none.ok && none.error.errorCode).toBe(
      SchedulingErrorCode.RecurrenceInvalidInterval,
    );
    const tooMany = withCount(weekly, 500);
    expect(!tooMany.ok && tooMany.error.errorCode).toBe(
      SchedulingErrorCode.RecurrenceInvalidCount,
    );
    const noDays = withWeekdays(weekly, []);
    expect(!noDays.ok && noDays.error.errorCode).toBe(
      SchedulingErrorCode.RecurrenceNoWeekdays,
    );
  });

  it('keeps the page’s lowercase words — one per dictionary value', () => {
    expect(REPEAT_PRESETS.map((preset) => REPEAT_PRESET_WORD[preset])).toEqual([
      'never',
      'daily',
      'weekdays',
      'weekly',
      'monthly',
      'yearly',
    ]);
    expect(Object.values(RECURRENCE_FREQUENCY_WORD)).toEqual([
      'daily',
      'weekly',
      'monthly',
      'yearly',
    ]);
    expect(Object.values(RECURRENCE_END_WORD)).toEqual(['until', 'count']);
    expect(Object.values(WEEKDAY_WORD)).toEqual([
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ]);
  });
});
