import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  LocalDate,
  SchedulingErrorCode,
  type SchedulingError,
  type Weekday as IsoWeekday,
  defect,
} from '@core/primitives';
import {
  MonthlyAnchor,
  RecurrenceEndRule,
  RecurrenceFrequency as FrequencyTag,
  RecurrencePattern as PatternData,
  RecurrenceRule as RuleData,
  WeekOfMonth as WeekOfMonthTag,
} from '@core/components';
import { RecurrenceSystem } from '@core/systems';
import { CalendarDay } from './calendar-day';
import { type Weekday, isoOf, weekdayFromIso } from './weekday';
import {
  EmptyRecurrenceWeekdaysError,
  InvalidRecurrenceCountError,
  InvalidRecurrenceDayError,
  InvalidRecurrenceIntervalError,
  RecurrenceEndsBeforeStartError,
  RecurrenceNeverOccursError,
  type RecurrenceRuleError,
  type RecurrenceSeriesError,
  RecurrenceTooLongError,
} from './recurrence-rule.errors';

/*
 * THIN SHIM (ECS migration Phase 2). The rule's checks are the
 * `RecurrenceRule` component of `@core/components`; the presets, the
 * start-following and the walk are `RecurrenceSystem`. This file keeps the
 * legacy classes' API for their callers and only converts between the legacy
 * shapes (weekday names, `CalendarDay`, error classes) and the ECS structs.
 */

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

/** Which week of its month a day is in: the first … the fourth, or the LAST (−1). */
export type WeekOfMonth = 1 | 2 | 3 | 4 | -1;

/** How a monthly rule finds its day — «on the 24th» or «on the fourth / last Thursday». */
export type MonthlyDay =
  | { readonly by: 'date'; readonly date: number }
  | {
      readonly by: 'weekday';
      readonly week: WeekOfMonth;
      readonly weekday: Weekday;
    };

/** WHICH days of a period, per frequency. Each arm carries only what it needs. */
export type RecurrencePattern =
  | { readonly frequency: 'daily' }
  | { readonly frequency: 'weekly'; readonly weekdays: readonly Weekday[] }
  | { readonly frequency: 'monthly'; readonly day: MonthlyDay }
  | {
      readonly frequency: 'yearly';
      readonly month: number;
      readonly date: number;
    };

/** How a series stops — iCalendar's `UNTIL` (inclusive) or `COUNT`. No «never». */
export type RecurrenceEnd =
  | { readonly kind: 'until'; readonly day: CalendarDay }
  | { readonly kind: 'count'; readonly count: number };

export interface RecurrenceRuleProps {
  readonly pattern: RecurrencePattern;
  /** Every `interval`-th period — «every 2 weeks». Defaults to 1. */
  readonly interval?: number;
  readonly end: RecurrenceEnd;
}

/* ── Legacy ↔ ECS converters ─────────────────────────────────────────── */

/** The legacy lowercase frequency ↔ the SCREAMING tag — the ONE table each way. */
const LEGACY_FREQUENCY = {
  daily: FrequencyTag.Daily,
  weekly: FrequencyTag.Weekly,
  monthly: FrequencyTag.Monthly,
  yearly: FrequencyTag.Yearly,
} as const satisfies Record<RecurrenceFrequency, FrequencyTag>;

function toFrequency(frequency: RecurrenceFrequency): FrequencyTag {
  return LEGACY_FREQUENCY[frequency];
}

/** A legacy weekday name → ISO; an unknown name maps to 0, which no rule accepts. */
function toIso(weekday: Weekday): IsoWeekday {
  return isoOf(weekday) as IsoWeekday;
}

function toEcsMonthlyDay(day: MonthlyDay): PatternData.Monthly {
  return day.by === 'date'
    ? PatternData.monthlyByDate(day.date)
    : PatternData.monthlyByWeekday(
        day.week as WeekOfMonthTag,
        toIso(day.weekday),
      );
}

function fromEcsMonthlyDay(day: PatternData.Monthly): MonthlyDay {
  return day.monthlyAnchor === MonthlyAnchor.Date
    ? { by: 'date', date: day.monthlyDate }
    : {
        by: 'weekday',
        week: day.monthlyWeek as WeekOfMonth,
        weekday: weekdayFromIso(day.monthlyWeekday),
      };
}

function toEcsPattern(pattern: RecurrencePattern): PatternData {
  switch (pattern.frequency) {
    case 'daily':
      return PatternData.daily();
    case 'weekly':
      return PatternData.weekly(pattern.weekdays.map(toIso));
    case 'monthly':
      return toEcsMonthlyDay(pattern.day);
    case 'yearly':
      return PatternData.yearly(pattern.month, pattern.date);
  }
}

function fromEcsPattern(pattern: PatternData): RecurrencePattern {
  switch (pattern.recurrenceFrequency) {
    case FrequencyTag.Daily:
      return { frequency: 'daily' };
    case FrequencyTag.Weekly:
      return {
        frequency: 'weekly',
        weekdays: pattern.recurrenceWeekdays.map(weekdayFromIso),
      };
    case FrequencyTag.Monthly:
      return { frequency: 'monthly', day: fromEcsMonthlyDay(pattern) };
    case FrequencyTag.Yearly:
      return {
        frequency: 'yearly',
        month: pattern.yearlyMonth,
        date: pattern.yearlyDate,
      };
  }
}

/** A calendar day's key — a real day by construction (`CalendarDay`). */
function localDateOf(day: CalendarDay): LocalDate {
  const parsed = LocalDate.parse(day.key());
  if (!parsed.ok) defect(`unreachable: a CalendarDay ${day.key()}`);
  return parsed.value;
}

function toEcsEnd(end: RecurrenceEnd): RecurrenceEndRule {
  return end.kind === 'until'
    ? RecurrenceEndRule.until(localDateOf(end.day))
    : RecurrenceEndRule.count(end.count);
}

function toEcsRule(rule: RecurrenceRule): RuleData {
  return RuleData.of(
    toEcsPattern(rule.pattern),
    rule.interval,
    toEcsEnd(rule.end),
  );
}

function toLegacyRuleError(error: SchedulingError): RecurrenceRuleError {
  switch (error.errorCode) {
    case SchedulingErrorCode.RecurrenceInvalidInterval:
      return new InvalidRecurrenceIntervalError(error.interval, error.max);
    case SchedulingErrorCode.RecurrenceInvalidCount:
      return new InvalidRecurrenceCountError(error.count, error.max);
    case SchedulingErrorCode.RecurrenceInvalidDay:
      return new InvalidRecurrenceDayError(error.month, error.date);
    default:
      return new EmptyRecurrenceWeekdaysError();
  }
}

function toLegacySeriesError(error: SchedulingError): RecurrenceSeriesError {
  switch (error.errorCode) {
    case SchedulingErrorCode.RecurrenceEndsBeforeStart:
      return new RecurrenceEndsBeforeStartError(error.start, error.until);
    case SchedulingErrorCode.RecurrenceTooLong:
      return new RecurrenceTooLongError(error.max);
    default:
      return new RecurrenceNeverOccursError(
        error.errorCode === SchedulingErrorCode.RecurrenceNeverOccurs
          ? error.start
          : '',
      );
  }
}

function dayAt(key: LocalDate, zone: string): CalendarDay {
  const day = CalendarDay.create(key, zone);
  if (day.isFailure()) defect('unreachable: a civil date by arithmetic');
  return day.value;
}

/**
 * A RECURRENCE RULE — which days a thing repeats on, and when it stops (the
 * part of iCalendar's RRULE people are shown). Delegates to the ECS
 * `RecurrenceRule` component and `RecurrenceSystem`.
 */
export class RecurrenceRule {
  /** Every 1…99 periods. */
  static readonly MAX_INTERVAL: typeof RuleData.MAX_INTERVAL = 99;
  /** The most days one series may write — a year of them. */
  static readonly MAX_OCCURRENCES: typeof RuleData.MAX_OCCURRENCES = 366;

  private constructor(
    readonly pattern: RecurrencePattern,
    readonly interval: number,
    readonly end: RecurrenceEnd,
  ) {}

  static create(
    props: RecurrenceRuleProps,
  ): Result<RecurrenceRule, RecurrenceRuleError> {
    const created = RuleData.create(
      toEcsPattern(props.pattern),
      props.interval ?? 1,
      toEcsEnd(props.end),
    );
    if (!created.ok) return fail(toLegacyRuleError(created.error));
    return ok(
      new RecurrenceRule(
        fromEcsPattern(RuleData.patternOf(created.value)),
        created.value.recurrenceInterval,
        props.end,
      ),
    );
  }

  /** What a bare frequency means from `start` — `RecurrenceSystem.patternFor`. */
  static patternFor(
    frequency: RecurrenceFrequency,
    start: CalendarDay,
  ): RecurrencePattern {
    return fromEcsPattern(
      RecurrenceSystem.patternFor(toFrequency(frequency), localDateOf(start)),
    );
  }

  /** The monthly readings a start offers — `RecurrenceSystem.monthlyDaysFor`. */
  static monthlyDaysFor(start: CalendarDay): readonly MonthlyDay[] {
    return RecurrenceSystem.monthlyDaysFor(localDateOf(start)).map(
      fromEcsMonthlyDay,
    );
  }

  get frequency(): RecurrenceFrequency {
    return this.pattern.frequency;
  }

  /** The same rule with some of its parts replaced — through the same checks as {@link create}. */
  with(
    changes: Partial<RecurrenceRuleProps>,
  ): Result<RecurrenceRule, RecurrenceRuleError> {
    return RecurrenceRule.create({
      pattern: changes.pattern ?? this.pattern,
      interval: changes.interval ?? this.interval,
      end: changes.end ?? this.end,
    });
  }

  /** THE START MOVED — `RecurrenceSystem.followingStart`; an unchanged rule is `this`. */
  followingStart(from: CalendarDay, to: CalendarDay): RecurrenceRule {
    const own = toEcsRule(this);
    const moved = RecurrenceSystem.followingStart(
      own,
      localDateOf(from),
      localDateOf(to),
    );
    return moved === own
      ? this
      : new RecurrenceRule(
          fromEcsPattern(RuleData.patternOf(moved)),
          this.interval,
          this.end,
        );
  }

  equals(other: RecurrenceRule | null): boolean {
    return (
      other !== null &&
      RuleData.equals(toEcsRule(this), toEcsRule(other)) &&
      (this.end.kind !== 'until' ||
        other.end.kind !== 'until' ||
        this.end.day.equals(other.end.day))
    );
  }
}

/**
 * A SERIES — a rule bound to the day it starts on, and so to its days.
 * Delegates to `RecurrenceSystem.series`; the days come back in the start's
 * zone.
 */
export class RecurrenceSeries {
  private constructor(
    readonly start: CalendarDay,
    readonly rule: RecurrenceRule,
    /** Every day of the series, in order; never empty. */
    readonly days: readonly CalendarDay[],
  ) {}

  static create(
    start: CalendarDay,
    rule: RecurrenceRule,
  ): Result<RecurrenceSeries, RecurrenceSeriesError> {
    const series = RecurrenceSystem.series(localDateOf(start), toEcsRule(rule));
    if (!series.ok) return fail(toLegacySeriesError(series.error));
    return ok(
      new RecurrenceSeries(
        start,
        rule,
        series.value.localDates.map((day) => dayAt(day, start.zone)),
      ),
    );
  }

  get count(): number {
    return this.days.length;
  }

  get first(): CalendarDay {
    return this.days[0] as CalendarDay;
  }

  get last(): CalendarDay {
    return this.days[this.days.length - 1] as CalendarDay;
  }

  /** Is the day the series was started from one of its days? */
  startsOnStart(): boolean {
    return this.first.equals(this.start);
  }

  /** `YYYY-MM-DD` of every day, in order — the document keys a write needs. */
  keys(): readonly string[] {
    return this.days.map((day) => day.key());
  }
}
