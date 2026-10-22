import type {
  LocalDate,
  Result,
  SchedulingError,
  Weekday,
} from '@core/primitives';
import {
  RecurrenceEnd,
  RecurrenceEndRule,
  RecurrenceFrequency,
  RecurrencePattern,
  RecurrenceRule,
} from '@core/components';
import { RepeatPreset, VisitDraftSystem } from '@core/systems';

/* ────────────────────────────────────────────────────────────────────────
 * THE REPEAT PAGE'S POLICY — what the sheet does to a rule when a person
 * taps a shortcut, changes the frequency, flips how the series ends or
 * steps the frame to another day. The RULE is the domain's (the flat
 * `RecurrenceRule` struct, `RecurrenceSystem`); the moves a sheet makes on
 * someone's behalf are the product's (`VisitDraftSystem`). These helpers
 * are thin calls over them, on the shop day (`LocalDate`) the frame is on.
 *
 * The page's i18n key segments and DOM test ids keep their lowercase
 * spelling (Phase 4a 4A-10): each SCREAMING dictionary maps to its word
 * through ONE table here — the only feature that reads them.
 * ──────────────────────────────────────────────────────────────────────── */

/** The shortcuts, in the page's order — Apple's Repeat list with «every weekday». */
export const REPEAT_PRESETS: readonly RepeatPreset[] =
  VisitDraftSystem.REPEAT_PRESETS;

/** Monday to Friday — the working week a calendar's «weekdays» means. */
export const MONDAY_TO_FRIDAY: readonly Weekday[] =
  VisitDraftSystem.MONDAY_TO_FRIDAY;

/** Each shortcut's word — the `staff-block-repeat-<word>` test id. */
export const REPEAT_PRESET_WORD = {
  [RepeatPreset.Never]: 'never',
  [RepeatPreset.Daily]: 'daily',
  [RepeatPreset.Weekdays]: 'weekdays',
  [RepeatPreset.Weekly]: 'weekly',
  [RepeatPreset.Monthly]: 'monthly',
  [RepeatPreset.Yearly]: 'yearly',
} as const satisfies Record<RepeatPreset, string>;

/** Each frequency's word — the `staff.block.repeat*.<word>` key segment and test id. */
export const RECURRENCE_FREQUENCY_WORD = {
  [RecurrenceFrequency.Daily]: 'daily',
  [RecurrenceFrequency.Weekly]: 'weekly',
  [RecurrenceFrequency.Monthly]: 'monthly',
  [RecurrenceFrequency.Yearly]: 'yearly',
} as const satisfies Record<RecurrenceFrequency, string>;

/** How a series ends, as its word — the `staff-block-repeat-end-<word>` test id. */
export const RECURRENCE_END_WORD = {
  [RecurrenceEnd.Until]: 'until',
  [RecurrenceEnd.Count]: 'count',
} as const satisfies Record<RecurrenceEnd, string>;

/**
 * Each ISO weekday's word — the `staff.block.repeatOnWeekday.<word>` and
 * `staff.block.repeatWeekdayGender.<word>` key segments.
 */
export const WEEKDAY_WORD = {
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday',
  6: 'saturday',
  7: 'sunday',
} as const satisfies Record<Weekday, string>;

/**
 * Where a series ends unless told otherwise. Always a DATE: the day a
 * series stops is what a person checks it against, and it is what the
 * sheet shipped with. There is no «never» — a series is written.
 */
export function defaultEnd(
  frequency: RecurrenceFrequency,
  start: LocalDate,
): RecurrenceEndRule {
  return VisitDraftSystem.defaultEnd(frequency, start);
}

/** Which shortcut a rule is from `start` — `null` for none of them, the page's «Персонализирано». */
export function presetOf(
  rule: RecurrenceRule | null,
  start: LocalDate,
): RepeatPreset | null {
  return VisitDraftSystem.presetOf(rule, start);
}

/** A shortcut, tapped: what it means from `start`, keeping the end the series had. */
export function ruleForPreset(
  preset: RepeatPreset,
  start: LocalDate,
  current: RecurrenceRule | null,
): RecurrenceRule | null {
  return VisitDraftSystem.ruleForPreset(preset, start, current);
}

/**
 * «Персонализирано», tapped: the rule there is, or — from nothing —
 * Google's own custom default, every week on the start's weekday.
 */
export function ruleForCustom(
  start: LocalDate,
  current: RecurrenceRule | null,
): RecurrenceRule | null {
  return VisitDraftSystem.ruleForCustom(start, current);
}

/** The frequency changed: the start's own days for it, the interval and the end kept. */
export function ruleForFrequency(
  rule: RecurrenceRule,
  frequency: RecurrenceFrequency,
  start: LocalDate,
): RecurrenceRule {
  return VisitDraftSystem.ruleForFrequency(rule, frequency, start);
}

/**
 * How the series ends, switched between «На дата» and «След брой пъти» —
 * WITHOUT changing its days where it has any.
 */
export function ruleForEndKind(
  rule: RecurrenceRule,
  recurrenceEnd: RecurrenceEnd,
  start: LocalDate,
): RecurrenceRule {
  return VisitDraftSystem.ruleForEndKind(rule, recurrenceEnd, start);
}

/**
 * The frame stepped to another day, so the series starts there: a pattern
 * that was the start's own follows it, and an end the new start overtook
 * moves on to the default.
 */
export function ruleForStart(
  rule: RecurrenceRule,
  from: LocalDate,
  to: LocalDate,
): RecurrenceRule {
  return VisitDraftSystem.ruleForStart(rule, from, to);
}

/* ── The page's typed edits — each through the rule's own checks ────────── */

/** Every `interval`-th period; refused (`SCHEDULING_RECURRENCE_INVALID_INTERVAL`) off `1…99`. */
export function withInterval(
  rule: RecurrenceRule,
  interval: number,
): Result<RecurrenceRule, SchedulingError> {
  return RecurrenceRule.create(
    RecurrenceRule.patternOf(rule),
    interval,
    RecurrenceRule.endOf(rule),
  );
}

/** A weekly rule's days; refused (`SCHEDULING_RECURRENCE_NO_WEEKDAYS`) for none. */
export function withWeekdays(
  rule: RecurrenceRule,
  weekdays: readonly Weekday[],
): Result<RecurrenceRule, SchedulingError> {
  return RecurrenceRule.create(
    RecurrencePattern.weekly(weekdays),
    rule.recurrenceInterval,
    RecurrenceRule.endOf(rule),
  );
}

/** A monthly rule's reading of its day. */
export function withMonthly(
  rule: RecurrenceRule,
  day: RecurrencePattern.Monthly,
): Result<RecurrenceRule, SchedulingError> {
  return RecurrenceRule.create(
    day,
    rule.recurrenceInterval,
    RecurrenceRule.endOf(rule),
  );
}

/** Ends inclusively on `until`. */
export function withUntil(
  rule: RecurrenceRule,
  until: LocalDate,
): Result<RecurrenceRule, SchedulingError> {
  return RecurrenceRule.create(
    RecurrenceRule.patternOf(rule),
    rule.recurrenceInterval,
    RecurrenceEndRule.until(until),
  );
}

/** Ends after `count` days; refused (`SCHEDULING_RECURRENCE_INVALID_COUNT`) off `1…366`. */
export function withCount(
  rule: RecurrenceRule,
  count: number,
): Result<RecurrenceRule, SchedulingError> {
  return RecurrenceRule.create(
    RecurrenceRule.patternOf(rule),
    rule.recurrenceInterval,
    RecurrenceEndRule.count(count),
  );
}
