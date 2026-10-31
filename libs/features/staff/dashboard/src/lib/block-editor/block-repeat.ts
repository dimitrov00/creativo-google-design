import type { Weekday } from '@core/primitives';
import {
  RecurrenceEnd,
  RecurrenceFrequency,
  RepeatPreset,
} from '@core/components';

/* ────────────────────────────────────────────────────────────────────────
 * THE REPEAT PAGE'S WORDS. The RULE is the domain's (the
 * flat `RecurrenceRule` struct, `RecurrenceSystem`); the moves a sheet makes
 * on someone's behalf — a shortcut tapped, the frequency or the end kind
 * switched, the frame stepped to another day, a typed figure (interval,
 * days, monthly reading, end) — are the product's, and the sheet calls
 * `VisitDraftSystem` for them directly (`ruleFor*`, `ruleWith*`), each
 * through the rule's own checks. What stays here is the page's own: its
 * word tables.
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
