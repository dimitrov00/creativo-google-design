import { describe, expect, it } from 'vitest';
import {
  CalendarDay,
  type RecurrenceEnd,
  RecurrenceRule,
  RecurrenceSeries,
} from '@creativo/application/booking';
import {
  defaultEnd,
  presetOf,
  ruleForCustom,
  ruleForEndKind,
  ruleForFrequency,
  ruleForPreset,
  ruleForStart,
} from './block-repeat';

const ZONE = 'Europe/Sofia';

function day(key: string): CalendarDay {
  const result = CalendarDay.create(key, ZONE);
  if (result.isFailure()) throw new Error(`bad fixture ${key}`);
  return result.value;
}

function keys(
  start: CalendarDay,
  rule: RecurrenceRule | null,
): readonly string[] {
  if (rule === null) return [start.key()];
  const series = RecurrenceSeries.create(start, rule);
  if (series.isFailure()) throw series.error;
  return series.value.keys();
}

function endKey(end: RecurrenceEnd): string {
  return end.kind === 'until' ? end.day.key() : `×${end.count}`;
}

// 2026-09-24 is a Thursday.
const thursday = day('2026-09-24');

describe('the repeat page policy', () => {
  it('ends a series by default on a DATE — four weeks, half a year, four years', () => {
    expect(endKey(defaultEnd('daily', thursday))).toBe('2026-10-22');
    expect(endKey(defaultEnd('weekly', thursday))).toBe('2026-10-22');
    expect(endKey(defaultEnd('monthly', thursday))).toBe('2027-03-24');
    expect(endKey(defaultEnd('yearly', thursday))).toBe('2030-09-24');
    // The 31st has no 31st six months on: the month's last day instead.
    expect(endKey(defaultEnd('monthly', day('2026-08-31')))).toBe('2027-02-28');
  });

  it('turns every shortcut into its rule from the start — and reads it back', () => {
    for (const preset of [
      'daily',
      'weekdays',
      'weekly',
      'monthly',
      'yearly',
    ] as const) {
      const rule = ruleForPreset(preset, thursday, null);
      expect(presetOf(rule, thursday)).toBe(preset);
    }
    expect(ruleForPreset('never', thursday, null)).toBeNull();
    expect(presetOf(null, thursday)).toBe('never');
    // «Всяка седмица» from a Thursday is Thursdays, for four weeks.
    expect(keys(thursday, ruleForPreset('weekly', thursday, null))).toEqual([
      '2026-09-24',
      '2026-10-01',
      '2026-10-08',
      '2026-10-15',
      '2026-10-22',
    ]);
    // «Делнични дни» skips the weekend.
    expect(
      keys(thursday, ruleForPreset('weekdays', thursday, null)).slice(0, 4),
    ).toEqual(['2026-09-24', '2026-09-25', '2026-09-28', '2026-09-29']);
  });

  it('is no shortcut once shaped: another day, another interval', () => {
    const weekly = ruleForPreset('weekly', thursday, null);
    if (weekly === null) throw new Error('fixture');
    const fortnightly = weekly.with({ interval: 2 });
    if (fortnightly.isFailure()) throw fortnightly.error;
    expect(presetOf(fortnightly.value, thursday)).toBeNull();
    const mondays = weekly.with({
      pattern: { frequency: 'weekly', weekdays: ['monday'] },
    });
    if (mondays.isFailure()) throw mondays.error;
    expect(presetOf(mondays.value, thursday)).toBeNull();
  });

  it('keeps the end a series had when the shortcut changes, unless it no longer fits', () => {
    const daily = ruleForPreset('daily', thursday, null);
    const weekly = ruleForPreset('weekly', thursday, daily);
    expect(weekly && endKey(weekly.end)).toBe('2026-10-22');
    // A yearly series four years long turned daily would be ~1,500 days:
    // past the cap, so the new frequency's own end is taken instead.
    const yearly = ruleForPreset('yearly', thursday, null);
    const dailyAgain = ruleForPreset('daily', thursday, yearly);
    expect(dailyAgain && endKey(dailyAgain.end)).toBe('2026-10-22');
  });

  it("starts «Персонализирано» at Google's own default, or keeps the rule there is", () => {
    const custom = ruleForCustom(thursday, null);
    expect(custom?.pattern).toEqual({
      frequency: 'weekly',
      weekdays: ['thursday'],
    });
    const monthly = ruleForPreset('monthly', thursday, null);
    expect(ruleForCustom(thursday, monthly)).toBe(monthly);
  });

  it("changes the frequency to the start's own days for it, keeping interval and end", () => {
    const weekly = ruleForPreset('weekly', thursday, null);
    if (weekly === null) throw new Error('fixture');
    const every2 = weekly.with({ interval: 2 });
    if (every2.isFailure()) throw every2.error;
    const monthly = ruleForFrequency(every2.value, 'monthly', thursday);
    expect(monthly.pattern).toEqual({
      frequency: 'monthly',
      day: { by: 'date', date: 24 },
    });
    expect(monthly.interval).toBe(2);
  });

  it('switches how it ends WITHOUT changing the days', () => {
    const weekly = ruleForPreset('weekly', thursday, null);
    if (weekly === null) throw new Error('fixture');
    const counted = ruleForEndKind(weekly, 'count', thursday);
    expect(counted.end).toEqual({ kind: 'count', count: 5 });
    expect(keys(thursday, counted)).toEqual(keys(thursday, weekly));
    const dated = ruleForEndKind(counted, 'until', thursday);
    expect(endKey(dated.end)).toBe('2026-10-22');
    expect(keys(thursday, dated)).toEqual(keys(thursday, weekly));
  });

  it("follows the frame to another day: the start's weekday moves, an overtaken end moves on", () => {
    const weekly = ruleForPreset('weekly', thursday, null);
    if (weekly === null) throw new Error('fixture');
    const friday = ruleForStart(weekly, thursday, day('2026-09-25'));
    expect(friday.pattern).toEqual({
      frequency: 'weekly',
      weekdays: ['friday'],
    });
    expect(endKey(friday.end)).toBe('2026-10-22');
    // Stepped past its own end: the end moves four weeks on from there.
    const later = ruleForStart(weekly, thursday, day('2026-11-05'));
    expect(endKey(later.end)).toBe('2026-12-03');
  });
});
