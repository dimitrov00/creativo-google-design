import {
  CalendarDay,
  type MonthlyDay,
  type RecurrenceEnd,
  type RecurrenceFrequency,
  type RecurrencePattern,
  RecurrenceRule,
  WEEKDAYS,
  type Weekday,
} from '@creativo/application/booking';
import {
  DayKey,
  Frequency,
  MonthlyDayKind,
  RecurrenceEndKind,
  type RecurrenceRule as RuleData,
  VisitDraftSystem,
  type Weekday as IsoWeekday,
  type WeekOfMonth as IsoWeekOfMonth,
} from '@creativo/ecs-core';

/* ────────────────────────────────────────────────────────────────────────
 * THE REPEAT PAGE'S POLICY — what the sheet does to a rule when a person
 * taps a shortcut, changes the frequency, flips how the series ends or
 * steps the frame to another day. The RULE is the domain's; the moves a
 * sheet makes on someone's behalf are the product's.
 *
 * Phase 2 shim: the policy is `VisitDraftSystem` in `@creativo/ecs-core`
 * (over the `RecurrenceRule` struct and `RecurrenceSystem`). This file keeps
 * the legacy names and the legacy rule class / `CalendarDay` for its
 * callers, and converts between them and the ECS structs.
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The shortcuts — Apple's Repeat list (Never, Every Day, Every Week, Every
 * Month, Every Year) with Google's and Outlook's «every weekday», which is
 * what a shop's lunch break is. A preset is never STORED: which row wears
 * the check is read back off the rule ({@link presetOf}).
 */
export type RepeatPreset =
  'never' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';

export const REPEAT_PRESETS: readonly RepeatPreset[] =
  VisitDraftSystem.REPEAT_PRESETS;

/** Monday to Friday — the working week a calendar's «weekdays» means. */
export const MONDAY_TO_FRIDAY: readonly Weekday[] = WEEKDAYS.slice(0, 5);

/**
 * Where a series ends unless told otherwise. Always a DATE: the day a
 * series stops is what a person checks it against, and it is what the
 * sheet shipped with. There is no «never» — see `RecurrenceEnd`.
 */
export function defaultEnd(
  frequency: RecurrenceFrequency,
  start: CalendarDay,
): RecurrenceEnd {
  return fromEcsEnd(
    VisitDraftSystem.defaultEnd(toFrequency(frequency), dayKeyOf(start)),
    start.zone,
  );
}

/** Which shortcut a rule is from `start` — `null` for none of them, the page's «Персонализирано». */
export function presetOf(
  rule: RecurrenceRule | null,
  start: CalendarDay,
): RepeatPreset | null {
  return VisitDraftSystem.presetOf(
    rule === null ? null : toEcsRule(rule),
    dayKeyOf(start),
  );
}

/** A shortcut, tapped: what it means from `start`, keeping the end the series had. */
export function ruleForPreset(
  preset: RepeatPreset,
  start: CalendarDay,
  current: RecurrenceRule | null,
): RecurrenceRule | null {
  const rule = VisitDraftSystem.ruleForPreset(
    preset,
    dayKeyOf(start),
    current === null ? null : toEcsRule(current),
  );
  return rule === null ? null : fromEcsRule(rule, start.zone);
}

/**
 * «Персонализирано», tapped: the rule there is, or — from nothing —
 * Google's own custom default, every week on the start's weekday.
 */
export function ruleForCustom(
  start: CalendarDay,
  current: RecurrenceRule | null,
): RecurrenceRule | null {
  const kept = current === null ? null : toEcsRule(current);
  const rule = VisitDraftSystem.ruleForCustom(dayKeyOf(start), kept);
  return rule === null ? null : backOrSame(rule, kept, current, start.zone);
}

/** The frequency changed: the start's own days for it, the interval and the end kept. */
export function ruleForFrequency(
  rule: RecurrenceRule,
  frequency: RecurrenceFrequency,
  start: CalendarDay,
): RecurrenceRule {
  const given = toEcsRule(rule);
  return backOrSame(
    VisitDraftSystem.ruleForFrequency(
      given,
      toFrequency(frequency),
      dayKeyOf(start),
    ),
    given,
    rule,
    start.zone,
  );
}

/**
 * How the series ends, switched between «На дата» and «След брой пъти» —
 * WITHOUT changing its days where it has any.
 */
export function ruleForEndKind(
  rule: RecurrenceRule,
  kind: RecurrenceEnd['kind'],
  start: CalendarDay,
): RecurrenceRule {
  const given = toEcsRule(rule);
  return backOrSame(
    VisitDraftSystem.ruleForEndKind(
      given,
      kind === 'count' ? RecurrenceEndKind.Count : RecurrenceEndKind.Until,
      dayKeyOf(start),
    ),
    given,
    rule,
    start.zone,
  );
}

/**
 * The frame stepped to another day, so the series starts there: a pattern
 * that was the start's own follows it, and an end the new start overtook
 * moves on to the default.
 */
export function ruleForStart(
  rule: RecurrenceRule,
  from: CalendarDay,
  to: CalendarDay,
): RecurrenceRule {
  const given = toEcsRule(rule);
  return backOrSame(
    VisitDraftSystem.ruleForStart(given, dayKeyOf(from), dayKeyOf(to)),
    given,
    rule,
    to.zone,
  );
}

/* ── Legacy ↔ ECS converters ─────────────────────────────────────────── */

function dayKeyOf(day: CalendarDay): DayKey {
  return DayKey.of(day.key());
}

function toFrequency(frequency: RecurrenceFrequency): Frequency {
  switch (frequency) {
    case 'daily':
      return Frequency.Daily;
    case 'weekly':
      return Frequency.Weekly;
    case 'monthly':
      return Frequency.Monthly;
    case 'yearly':
      return Frequency.Yearly;
  }
}

function toIso(weekday: Weekday): IsoWeekday {
  return (WEEKDAYS.indexOf(weekday) + 1) as IsoWeekday;
}

function fromIso(weekday: IsoWeekday): Weekday {
  return WEEKDAYS[weekday - 1] as Weekday;
}

function toEcsMonthlyDay(day: MonthlyDay): RuleData.MonthlyDay {
  return day.by === 'date'
    ? { kind: MonthlyDayKind.Date, date: day.date }
    : {
        kind: MonthlyDayKind.Weekday,
        week: day.week as IsoWeekOfMonth,
        weekday: toIso(day.weekday),
      };
}

function fromEcsMonthlyDay(day: RuleData.MonthlyDay): MonthlyDay {
  return day.kind === MonthlyDayKind.Date
    ? { by: 'date', date: day.date }
    : { by: 'weekday', week: day.week, weekday: fromIso(day.weekday) };
}

function toEcsPattern(pattern: RecurrencePattern): RuleData.Pattern {
  switch (pattern.frequency) {
    case 'daily':
      return { kind: Frequency.Daily };
    case 'weekly':
      return { kind: Frequency.Weekly, weekdays: pattern.weekdays.map(toIso) };
    case 'monthly':
      return { kind: Frequency.Monthly, day: toEcsMonthlyDay(pattern.day) };
    case 'yearly':
      return {
        kind: Frequency.Yearly,
        month: pattern.month,
        date: pattern.date,
      };
  }
}

function fromEcsPattern(pattern: RuleData.Pattern): RecurrencePattern {
  switch (pattern.kind) {
    case Frequency.Daily:
      return { frequency: 'daily' };
    case Frequency.Weekly:
      return { frequency: 'weekly', weekdays: pattern.weekdays.map(fromIso) };
    case Frequency.Monthly:
      return { frequency: 'monthly', day: fromEcsMonthlyDay(pattern.day) };
    case Frequency.Yearly:
      return { frequency: 'yearly', month: pattern.month, date: pattern.date };
  }
}

function toEcsEnd(end: RecurrenceEnd): RuleData.End {
  return end.kind === 'until'
    ? { kind: RecurrenceEndKind.Until, dayKey: dayKeyOf(end.day) }
    : { kind: RecurrenceEndKind.Count, count: end.count };
}

function fromEcsEnd(end: RuleData.End, zone: string): RecurrenceEnd {
  if (end.kind === RecurrenceEndKind.Count) {
    return { kind: 'count', count: end.count };
  }
  const day = CalendarDay.create(end.dayKey, zone);
  if (day.isFailure())
    throw new Error('unreachable: a civil date by arithmetic');
  return { kind: 'until', day: day.value };
}

function toEcsRule(rule: RecurrenceRule): RuleData {
  return {
    pattern: toEcsPattern(rule.pattern),
    interval: rule.interval,
    end: toEcsEnd(rule.end),
  };
}

function fromEcsRule(rule: RuleData, zone: string): RecurrenceRule {
  const created = RecurrenceRule.create({
    pattern: fromEcsPattern(rule.pattern),
    interval: rule.interval,
    end: fromEcsEnd(rule.end, zone),
  });
  if (created.isFailure())
    throw new Error('unreachable: a rule the system made');
  return created.value;
}

/** The system handed the given struct back: the caller's own rule, unchanged. */
function backOrSame(
  rule: RuleData,
  given: RuleData | null,
  legacy: RecurrenceRule | null,
  zone: string,
): RecurrenceRule {
  return rule === given && legacy !== null ? legacy : fromEcsRule(rule, zone);
}
