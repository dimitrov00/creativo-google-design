import type { LocalDate, Result, Weekday } from '@core/primitives';
import type { SchedulingError } from '@core/errors';
import {
  RecurrenceEnd,
  RecurrenceEndRule,
  RecurrenceFrequency,
  RecurrencePattern,
  RecurrenceRule,
  RepeatPreset,
} from '@core/components';

/* ────────────────────────────────────────────────────────────────────────
 * THE REPEAT PAGE'S WORDS AND TYPED EDITS. The RULE is the domain's (the
 * flat `RecurrenceRule` struct, `RecurrenceSystem`); the moves a sheet makes
 * on someone's behalf — a shortcut tapped, the frequency or the end kind
 * switched, the frame stepped to another day — are the product's, and the
 * sheet calls `VisitDraftSystem` for them directly. What stays here is the
 * page's own: its word tables, and the typed edits below, each through the
 * rule's own checks on the shop day (`LocalDate`) the frame is on.
 *
 * The page's i18n key segments and DOM test ids keep their lowercase
 * spelling (Phase 4a 4A-10): each SCREAMING dictionary maps to its word
 * through ONE table here — the only feature that reads them.
 * ──────────────────────────────────────────────────────────────────────── */

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

/* ── The page's typed edits — each through the rule's own checks ────────── */

/** Every `interval`-th period; refused (`SCHEDULING_RECURRENCE_INVALID_INTERVAL`) off `1…99`. */
export function withInterval(
  rule: RecurrenceRule,
  interval: number,
): Result<RecurrenceRule, SchedulingError> {
  return RecurrenceRule.create(
    RecurrenceRule.patternOf(rule),
    interval,
    RecurrenceEndRule.of(rule),
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
    RecurrenceEndRule.of(rule),
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
    RecurrenceEndRule.of(rule),
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
