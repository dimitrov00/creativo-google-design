import {
  CalendarDay,
  type RecurrenceEnd,
  type RecurrenceFrequency,
  type RecurrencePattern,
  RecurrenceRule,
  RecurrenceSeries,
  WEEKDAYS,
  type Weekday,
} from '@creativo/application/booking';

/* ────────────────────────────────────────────────────────────────────────
 * THE REPEAT PAGE'S POLICY — what the sheet does to a rule when a person
 * taps a shortcut, changes the frequency, flips how the series ends or
 * steps the frame to another day. The RULE is the domain's; the moves a
 * sheet makes on someone's behalf are the product's, and they live here,
 * pure, so the page and its spec read the same answers.
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The shortcuts — Apple's Repeat list (Never, Every Day, Every Week, Every
 * Month, Every Year) with Google's and Outlook's «every weekday», which is
 * what a shop's lunch break is.
 *
 * A preset is never STORED. The draft holds the rule, and which row wears
 * the check is read back off it ({@link presetOf}): a custom rule that
 * happens to say «every week on the start's weekday» IS «Всяка седмица»,
 * and nothing can hold the two apart.
 */
export type RepeatPreset =
  'never' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';

export const REPEAT_PRESETS: readonly RepeatPreset[] = [
  'never',
  'daily',
  'weekdays',
  'weekly',
  'monthly',
  'yearly',
];

/** Monday to Friday — the working week a calendar's «weekdays» means. */
export const MONDAY_TO_FRIDAY: readonly Weekday[] = WEEKDAYS.slice(0, 5);

/** How far a daily or weekly series reaches unless told — four weeks of lunches, the sheet's standing default. */
const DEFAULT_DAYS = 28;
/** A monthly one, half a year; an anniversary, four more years of it. */
const DEFAULT_MONTHS: Readonly<Record<'monthly' | 'yearly', number>> = {
  monthly: 6,
  yearly: 48,
};
/** The count a series takes when its end turns into «after N times» with nothing to keep. */
const DEFAULT_COUNT = 10;

function patternOf(
  preset: Exclude<RepeatPreset, 'never'>,
  start: CalendarDay,
): RecurrencePattern {
  return preset === 'weekdays'
    ? { frequency: 'weekly', weekdays: MONDAY_TO_FRIDAY }
    : RecurrenceRule.patternFor(preset, start);
}

/** `months` on, the date held where the month has it and the month's last day where it does not. */
function plusMonths(start: CalendarDay, months: number): CalendarDay {
  const index = start.month - 1 + months;
  const year = start.year + Math.floor(index / 12);
  const month = (index % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = CalendarDay.create(
    `${year}-${pad(month)}-${pad(Math.min(start.day, last))}`,
    start.zone,
  );
  if (day.isFailure()) throw new Error('unreachable: a clamped civil date');
  return day.value;
}

/**
 * Where a series ends unless told otherwise. Always a DATE: the day a
 * series stops is what a person checks it against, and it is what the
 * sheet shipped with. There is no «never» — see `RecurrenceEnd`.
 */
export function defaultEnd(
  frequency: RecurrenceFrequency,
  start: CalendarDay,
): RecurrenceEnd {
  return {
    kind: 'until',
    day:
      frequency === 'daily' || frequency === 'weekly'
        ? start.plusDays(DEFAULT_DAYS)
        : plusMonths(start, DEFAULT_MONTHS[frequency]),
  };
}

/** Which shortcut a rule is from `start` — `null` for none of them, the page's «Персонализирано». */
export function presetOf(
  rule: RecurrenceRule | null,
  start: CalendarDay,
): RepeatPreset | null {
  if (rule === null) return 'never';
  if (rule.interval !== 1) return null;
  for (const preset of REPEAT_PRESETS) {
    if (preset === 'never') continue;
    const candidate = RecurrenceRule.create({
      pattern: patternOf(preset, start),
      end: rule.end,
    });
    if (candidate.isSuccess() && candidate.value.equals(rule)) return preset;
  }
  return null;
}

/**
 * A rule from its parts whose end still makes a series from `start` — or,
 * where it no longer does (an end the start overtook, a year of weeks
 * turned daily), the frequency's own default end.
 *
 * Only for moves the SHEET makes on someone's behalf. An end a person set
 * stands as set, and its refusal is said on the page.
 */
function fitted(
  pattern: RecurrencePattern,
  interval: number,
  end: RecurrenceEnd | null,
  start: CalendarDay,
): RecurrenceRule | null {
  if (end !== null) {
    const kept = RecurrenceRule.create({ pattern, interval, end });
    if (
      kept.isSuccess() &&
      RecurrenceSeries.create(start, kept.value).isSuccess()
    ) {
      return kept.value;
    }
  }
  const fresh = RecurrenceRule.create({
    pattern,
    interval,
    end: defaultEnd(pattern.frequency, start),
  });
  return fresh.isSuccess() ? fresh.value : null;
}

/** A shortcut, tapped: what it means from `start`, keeping the end the series had. */
export function ruleForPreset(
  preset: RepeatPreset,
  start: CalendarDay,
  current: RecurrenceRule | null,
): RecurrenceRule | null {
  if (preset === 'never') return null;
  return fitted(patternOf(preset, start), 1, current?.end ?? null, start);
}

/**
 * «Персонализирано», tapped: the rule there is, or — from nothing —
 * Google's own custom default, every week on the start's weekday.
 */
export function ruleForCustom(
  start: CalendarDay,
  current: RecurrenceRule | null,
): RecurrenceRule | null {
  return current ?? ruleForPreset('weekly', start, null);
}

/** The frequency changed: the start's own days for it, the interval and the end kept. */
export function ruleForFrequency(
  rule: RecurrenceRule,
  frequency: RecurrenceFrequency,
  start: CalendarDay,
): RecurrenceRule {
  if (rule.frequency === frequency) return rule;
  return (
    fitted(
      RecurrenceRule.patternFor(frequency, start),
      rule.interval,
      rule.end,
      start,
    ) ?? rule
  );
}

/**
 * How the series ends, switched between «На дата» and «След брой пъти» —
 * WITHOUT changing its days where it has any: the date becomes the last
 * day's, the count becomes how many there are. Switching how a series is
 * bounded is not a reason to change which days it has.
 */
export function ruleForEndKind(
  rule: RecurrenceRule,
  kind: RecurrenceEnd['kind'],
  start: CalendarDay,
): RecurrenceRule {
  if (rule.end.kind === kind) return rule;
  const series = RecurrenceSeries.create(start, rule);
  const end: RecurrenceEnd =
    kind === 'count'
      ? {
          kind: 'count',
          count: series.isSuccess() ? series.value.count : DEFAULT_COUNT,
        }
      : series.isSuccess()
        ? { kind: 'until', day: series.value.last }
        : defaultEnd(rule.frequency, start);
  const next = rule.with({ end });
  return next.isSuccess() ? next.value : rule;
}

/**
 * The frame stepped to another day, so the series starts there: a pattern
 * that was the start's own follows it (the domain's `followingStart`), and
 * an end the new start overtook moves on to the default.
 */
export function ruleForStart(
  rule: RecurrenceRule,
  from: CalendarDay,
  to: CalendarDay,
): RecurrenceRule {
  const followed = rule.followingStart(from, to);
  return (
    fitted(followed.pattern, followed.interval, followed.end, to) ?? followed
  );
}
