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
  LocalDate,
  type Weekday as IsoWeekday,
  defect,
} from '@core/primitives';
import {
  MonthlyAnchor,
  RecurrenceEnd as EcsRecurrenceEnd,
  RecurrenceEndRule,
  RecurrenceFrequency as EcsFrequency,
  RecurrencePattern as EcsPattern,
  RecurrenceRule as RuleData,
  type WeekOfMonth as IsoWeekOfMonth,
} from '@core/components';
import {
  RepeatPreset as EcsRepeatPreset,
  VisitDraftSystem,
} from '@core/systems';

/* ────────────────────────────────────────────────────────────────────────
 * THE REPEAT PAGE'S POLICY — what the sheet does to a rule when a person
 * taps a shortcut, changes the frequency, flips how the series ends or
 * steps the frame to another day. The RULE is the domain's; the moves a
 * sheet makes on someone's behalf are the product's.
 *
 * Phase 2 shim: the policy is `VisitDraftSystem` in `@core/systems`
 * (over the `RecurrenceRule` struct and `RecurrenceSystem`). This file keeps
 * the legacy names and the legacy rule class / `CalendarDay` for its
 * callers, and converts between them and the ECS structs. Flatten pass: the
 * ECS rule is FLAT (`recurrenceFrequency`, `recurrenceInterval`,
 * `recurrenceEnd` at its root, `LocalDate` days, no zone) and the presets
 * SCREAMING; the legacy lowercase words are mapped through one table each
 * way, and a `CalendarDay` is rebuilt in the zone the caller's own day
 * carries.
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The shortcuts — Apple's Repeat list (Never, Every Day, Every Week, Every
 * Month, Every Year) with Google's and Outlook's «every weekday», which is
 * what a shop's lunch break is. A preset is never STORED: which row wears
 * the check is read back off the rule ({@link presetOf}).
 */
export type RepeatPreset =
  'never' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';

/** The legacy word of each SCREAMING preset — the ONE table, and its inverse. */
const LEGACY_REPEAT_PRESET = {
  [EcsRepeatPreset.Never]: 'never',
  [EcsRepeatPreset.Daily]: 'daily',
  [EcsRepeatPreset.Weekdays]: 'weekdays',
  [EcsRepeatPreset.Weekly]: 'weekly',
  [EcsRepeatPreset.Monthly]: 'monthly',
  [EcsRepeatPreset.Yearly]: 'yearly',
} as const satisfies Record<EcsRepeatPreset, RepeatPreset>;

const REPEAT_PRESET_OF = {
  never: EcsRepeatPreset.Never,
  daily: EcsRepeatPreset.Daily,
  weekdays: EcsRepeatPreset.Weekdays,
  weekly: EcsRepeatPreset.Weekly,
  monthly: EcsRepeatPreset.Monthly,
  yearly: EcsRepeatPreset.Yearly,
} as const satisfies Record<RepeatPreset, EcsRepeatPreset>;

export const REPEAT_PRESETS: readonly RepeatPreset[] =
  VisitDraftSystem.REPEAT_PRESETS.map((preset) => LEGACY_REPEAT_PRESET[preset]);

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
    VisitDraftSystem.defaultEnd(toFrequency(frequency), localDateOf(start)),
    start.zone,
  );
}

/** Which shortcut a rule is from `start` — `null` for none of them, the page's «Персонализирано». */
export function presetOf(
  rule: RecurrenceRule | null,
  start: CalendarDay,
): RepeatPreset | null {
  const preset = VisitDraftSystem.presetOf(
    rule === null ? null : toEcsRule(rule),
    localDateOf(start),
  );
  return preset === null ? null : LEGACY_REPEAT_PRESET[preset];
}

/** A shortcut, tapped: what it means from `start`, keeping the end the series had. */
export function ruleForPreset(
  preset: RepeatPreset,
  start: CalendarDay,
  current: RecurrenceRule | null,
): RecurrenceRule | null {
  const rule = VisitDraftSystem.ruleForPreset(
    REPEAT_PRESET_OF[preset],
    localDateOf(start),
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
  const rule = VisitDraftSystem.ruleForCustom(localDateOf(start), kept);
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
      localDateOf(start),
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
      kind === 'count' ? EcsRecurrenceEnd.Count : EcsRecurrenceEnd.Until,
      localDateOf(start),
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
    VisitDraftSystem.ruleForStart(given, localDateOf(from), localDateOf(to)),
    given,
    rule,
    to.zone,
  );
}

/* ── Legacy ↔ ECS converters ─────────────────────────────────────────── */

/** A calendar day's civil date — a real day by construction. */
function localDateOf(day: CalendarDay): LocalDate {
  const parsed = LocalDate.parse(day.key());
  if (!parsed.ok) defect('unreachable: a calendar day is a civil date');
  return parsed.value;
}

function toFrequency(frequency: RecurrenceFrequency): EcsFrequency {
  switch (frequency) {
    case 'daily':
      return EcsFrequency.Daily;
    case 'weekly':
      return EcsFrequency.Weekly;
    case 'monthly':
      return EcsFrequency.Monthly;
    case 'yearly':
      return EcsFrequency.Yearly;
  }
}

function toIso(weekday: Weekday): IsoWeekday {
  return (WEEKDAYS.indexOf(weekday) + 1) as IsoWeekday;
}

function fromIso(weekday: IsoWeekday): Weekday {
  return WEEKDAYS[weekday - 1] as Weekday;
}

function toEcsMonthly(day: MonthlyDay): EcsPattern.Monthly {
  return day.by === 'date'
    ? EcsPattern.monthlyByDate(day.date)
    : EcsPattern.monthlyByWeekday(
        day.week as IsoWeekOfMonth,
        toIso(day.weekday),
      );
}

function fromEcsMonthly(day: EcsPattern.Monthly): MonthlyDay {
  return day.monthlyAnchor === MonthlyAnchor.Date
    ? { by: 'date', date: day.monthlyDate }
    : {
        by: 'weekday',
        week: day.monthlyWeek,
        weekday: fromIso(day.monthlyWeekday),
      };
}

function toEcsPattern(pattern: RecurrencePattern): EcsPattern {
  switch (pattern.frequency) {
    case 'daily':
      return EcsPattern.daily();
    case 'weekly':
      return EcsPattern.weekly(pattern.weekdays.map(toIso));
    case 'monthly':
      return toEcsMonthly(pattern.day);
    case 'yearly':
      return EcsPattern.yearly(pattern.month, pattern.date);
  }
}

function fromEcsPattern(pattern: EcsPattern): RecurrencePattern {
  switch (pattern.recurrenceFrequency) {
    case EcsFrequency.Daily:
      return { frequency: 'daily' };
    case EcsFrequency.Weekly:
      return {
        frequency: 'weekly',
        weekdays: pattern.recurrenceWeekdays.map(fromIso),
      };
    case EcsFrequency.Monthly:
      return { frequency: 'monthly', day: fromEcsMonthly(pattern) };
    case EcsFrequency.Yearly:
      return {
        frequency: 'yearly',
        month: pattern.yearlyMonth,
        date: pattern.yearlyDate,
      };
  }
}

function toEcsEnd(end: RecurrenceEnd): RecurrenceEndRule {
  return end.kind === 'until'
    ? RecurrenceEndRule.until(localDateOf(end.day))
    : RecurrenceEndRule.count(end.count);
}

function fromEcsEnd(end: RecurrenceEndRule, zone: string): RecurrenceEnd {
  if (end.recurrenceEnd === EcsRecurrenceEnd.Count) {
    return { kind: 'count', count: end.occurrenceCount };
  }
  const day = CalendarDay.create(end.untilLocalDate, zone);
  if (day.isFailure()) defect('unreachable: a civil date by arithmetic');
  return { kind: 'until', day: day.value };
}

function toEcsRule(rule: RecurrenceRule): RuleData {
  return RuleData.of(
    toEcsPattern(rule.pattern),
    rule.interval,
    toEcsEnd(rule.end),
  );
}

function fromEcsRule(rule: RuleData, zone: string): RecurrenceRule {
  const created = RecurrenceRule.create({
    pattern: fromEcsPattern(RuleData.patternOf(rule)),
    interval: rule.recurrenceInterval,
    end: fromEcsEnd(RuleData.endOf(rule), zone),
  });
  if (created.isFailure()) defect('unreachable: a rule the system made');
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
