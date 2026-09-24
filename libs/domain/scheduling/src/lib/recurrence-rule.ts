import { Result, fail, ok } from '@creativo/domain/kernel';
import { CalendarDay } from './calendar-day';
import { WEEKDAYS, type Weekday, isoOf, weekdayFromIso } from './weekday';
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

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

/** Which week of its month a day is in: the first … the fourth, or the LAST (−1). */
export type WeekOfMonth = 1 | 2 | 3 | 4 | -1;

/**
 * How a monthly rule finds its day — iCalendar's `BYMONTHDAY` («on the
 * 24th») or `BYDAY` with an ordinal («on the fourth Thursday», «on the last
 * Thursday»). There is no fifth: a fifth weekday is always the last one, and
 * «last» is the reading that still means something in a four-week month.
 */
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

/**
 * How a series stops — iCalendar's `UNTIL` (inclusive) or `COUNT`.
 *
 * There is deliberately no «never»: a block series is WRITTEN, one
 * sanitized document per barber-day (the anonymous booking grid, the
 * capacity trigger and the server's commit re-check all read those days,
 * not rules), so an endless series would silently end wherever the write
 * stopped. «Never» arrives with a stored series and a job that keeps
 * writing ahead of it — not as a promise this model cannot keep.
 */
export type RecurrenceEnd =
  | { readonly kind: 'until'; readonly day: CalendarDay }
  | { readonly kind: 'count'; readonly count: number };

export interface RecurrenceRuleProps {
  readonly pattern: RecurrencePattern;
  /** Every `interval`-th period — «every 2 weeks». Defaults to 1. */
  readonly interval?: number;
  readonly end: RecurrenceEnd;
}

const MAX_INTERVAL = 99;
const MAX_OCCURRENCES = 366;
const MS_PER_DAY = 86_400_000;
/**
 * Periods a monthly or yearly walk tries before giving up on a pattern that
 * cannot land (the 31st, every twelfth month, from a February). Plain
 * arithmetic — ten thousand steps cost microseconds, never I/O.
 */
const PERIOD_GUARD = 10_000;

/* ── Civil arithmetic ─────────────────────────────────────────────────────
 * A recurrence is about CIVIL dates: «every Tuesday» names the same Tuesday
 * in every zone. So the walk runs on epoch-day integers in UTC, where a day
 * is always exactly one step, and only the days that occur are lifted back
 * into the start's zone. `CalendarDay.plusDays` walks the zone's midnights,
 * which is right for instants and far too slow to test a year of days
 * against a rule on every keystroke of a sheet.
 * ──────────────────────────────────────────────────────────────────────── */

function epochDayOf(year: number, month: number, date: number): number {
  return Date.UTC(year, month - 1, date) / MS_PER_DAY;
}

function civilOf(epochDay: number): {
  readonly year: number;
  readonly month: number;
  readonly date: number;
} {
  const at = new Date(epochDay * MS_PER_DAY);
  return {
    year: at.getUTCFullYear(),
    month: at.getUTCMonth() + 1,
    date: at.getUTCDate(),
  };
}

/** ISO weekday, 1 = Monday … 7 = Sunday. The epoch, 1970-01-01, was a Thursday. */
function isoWeekdayOf(epochDay: number): number {
  return ((((epochDay + 3) % 7) + 7) % 7) + 1;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function epochDayOfDay(day: CalendarDay): number {
  return epochDayOf(day.year, day.month, day.day);
}

/** The last day a four-digit day key can name — where every walk stops. */
const LAST_EPOCH_DAY = epochDayOf(9999, 12, 31);

function dayAt(epochDay: number, zone: string): CalendarDay {
  const { year, month, date } = civilOf(epochDay);
  const pad = (n: number, width: number) => String(n).padStart(width, '0');
  const day = CalendarDay.create(
    `${pad(year, 4)}-${pad(month, 2)}-${pad(date, 2)}`,
    zone,
  );
  if (day.isFailure())
    throw new Error('unreachable: a civil date by arithmetic');
  return day.value;
}

function weekdayOfDay(day: CalendarDay): Weekday {
  return weekdayFromIso(isoWeekdayOf(epochDayOfDay(day)));
}

/** The `week`-th (or last) `iso` weekday of a month, as an epoch day. Always exists. */
function nthWeekdayOf(
  year: number,
  month: number,
  iso: number,
  week: WeekOfMonth,
): number {
  if (week === -1) {
    const last = epochDayOf(year, month, daysInMonth(year, month));
    return last - ((isoWeekdayOf(last) - iso + 7) % 7);
  }
  const first = epochDayOf(year, month, 1);
  return first + ((iso - isoWeekdayOf(first) + 7) % 7) + (week - 1) * 7;
}

function sameMonthlyDay(a: MonthlyDay, b: MonthlyDay): boolean {
  if (a.by === 'date') return b.by === 'date' && a.date === b.date;
  return b.by === 'weekday' && a.week === b.week && a.weekday === b.weekday;
}

function samePattern(a: RecurrencePattern, b: RecurrencePattern): boolean {
  switch (a.frequency) {
    case 'daily':
      return b.frequency === 'daily';
    case 'weekly':
      return (
        b.frequency === 'weekly' &&
        a.weekdays.length === b.weekdays.length &&
        a.weekdays.every((weekday, index) => b.weekdays[index] === weekday)
      );
    case 'monthly':
      return b.frequency === 'monthly' && sameMonthlyDay(a.day, b.day);
    case 'yearly':
      return (
        b.frequency === 'yearly' && a.month === b.month && a.date === b.date
      );
  }
}

function sameEnd(a: RecurrenceEnd, b: RecurrenceEnd): boolean {
  if (a.kind === 'until') return b.kind === 'until' && a.day.equals(b.day);
  return b.kind === 'count' && a.count === b.count;
}

/**
 * The pattern made canonical — weekdays unique and in ISO order, so two rules
 * that mean the same days are EQUAL — or the reason it cannot occur.
 */
function normalise(
  pattern: RecurrencePattern,
): Result<RecurrencePattern, RecurrenceRuleError> {
  switch (pattern.frequency) {
    case 'daily':
      return ok(pattern);
    case 'weekly': {
      const weekdays = WEEKDAYS.filter((weekday) =>
        pattern.weekdays.includes(weekday),
      );
      return weekdays.length === 0
        ? fail(new EmptyRecurrenceWeekdaysError())
        : ok({ frequency: 'weekly', weekdays });
    }
    case 'monthly': {
      const day = pattern.day;
      if (day.by === 'date') {
        return Number.isInteger(day.date) && day.date >= 1 && day.date <= 31
          ? ok(pattern)
          : fail(new InvalidRecurrenceDayError(null, day.date));
      }
      return [1, 2, 3, 4, -1].includes(day.week) &&
        WEEKDAYS.includes(day.weekday)
        ? ok(pattern)
        : fail(new InvalidRecurrenceDayError(null, day.week));
    }
    case 'yearly': {
      const { month, date } = pattern;
      // Judged against a LEAP year: 29 February is a real, if quadrennial,
      // anniversary; 30 February is not a day at all.
      const real =
        Number.isInteger(month) &&
        month >= 1 &&
        month <= 12 &&
        Number.isInteger(date) &&
        date >= 1 &&
        date <= daysInMonth(2000, month);
      return real
        ? ok(pattern)
        : fail(new InvalidRecurrenceDayError(month, date));
    }
  }
}

/**
 * A RECURRENCE RULE — which days a thing repeats on, and when it stops: the
 * part of iCalendar's RRULE (RFC 5545) that Calendar, Google Calendar and
 * Outlook all put in front of people. Every day, every weekday set, every
 * month on a date or on «the fourth Thursday», every year; every N-th
 * period; until a day or for N times.
 *
 * ### Explicit, never implied
 * RFC 5545 lets `FREQ=MONTHLY` borrow its day from DTSTART. Here every
 * pattern names its days, so a rule means the same thing wherever it is
 * read and two rules are equal exactly when they select the same days.
 * The START's part is {@link patternFor} — «Every week» from a Thursday
 * IS «weekly on Thursday» — and {@link followingStart} keeps that bond when
 * the start moves, the way Google's «Weekly on Thursday» relabels itself.
 *
 * ### Phase comes from the start
 * «Every 2 weeks» counts weeks from the start's own ISO week (RFC 5545's
 * WKST=MO), months from its month, years from its year. The rule is the
 * pattern; the days are {@link RecurrenceSeries}, which binds it to a start.
 *
 * ### Days that do not exist are skipped, never moved
 * «Monthly on the 31st» has no April; «yearly on 29 February» occurs in leap
 * years. That is RFC 5545's reading and all three calendars': a rule that
 * slid to the 30th would put a block on a day nobody named.
 */
export class RecurrenceRule {
  /** Every 1…99 periods. Apple's wheel stops at 999; a shop's has no use past 99. */
  static readonly MAX_INTERVAL = MAX_INTERVAL;
  /** The most days one series may write — a year of them. */
  static readonly MAX_OCCURRENCES = MAX_OCCURRENCES;

  private constructor(
    readonly pattern: RecurrencePattern,
    readonly interval: number,
    readonly end: RecurrenceEnd,
  ) {}

  static create(
    props: RecurrenceRuleProps,
  ): Result<RecurrenceRule, RecurrenceRuleError> {
    const interval = props.interval ?? 1;
    if (
      !Number.isInteger(interval) ||
      interval < 1 ||
      interval > MAX_INTERVAL
    ) {
      return fail(new InvalidRecurrenceIntervalError(interval, MAX_INTERVAL));
    }
    const end = props.end;
    if (
      end.kind === 'count' &&
      (!Number.isInteger(end.count) ||
        end.count < 1 ||
        end.count > MAX_OCCURRENCES)
    ) {
      return fail(new InvalidRecurrenceCountError(end.count, MAX_OCCURRENCES));
    }
    const pattern = normalise(props.pattern);
    if (pattern.isFailure()) return fail(pattern.error);
    return ok(new RecurrenceRule(pattern.value, interval, end));
  }

  /**
   * What a bare frequency means from `start` — «every week» on the start's
   * weekday, «every month» on its date, «every year» on its day. Total: a
   * pattern read off a real day is always a real pattern.
   */
  static patternFor(
    frequency: RecurrenceFrequency,
    start: CalendarDay,
  ): RecurrencePattern {
    switch (frequency) {
      case 'daily':
        return { frequency: 'daily' };
      case 'weekly':
        return { frequency: 'weekly', weekdays: [weekdayOfDay(start)] };
      case 'monthly':
        return { frequency: 'monthly', day: { by: 'date', date: start.day } };
      case 'yearly':
        return { frequency: 'yearly', month: start.month, date: start.day };
    }
  }

  /**
   * The monthly readings a start offers — Google's own list: «on the 24th»,
   * «on the fourth Thursday», and «on the last Thursday» when the start is
   * in its month's last seven days. A fifth weekday offers only «last».
   */
  static monthlyDaysFor(start: CalendarDay): readonly MonthlyDay[] {
    const weekday = weekdayOfDay(start);
    const week = Math.ceil(start.day / 7);
    const isLast = start.day + 7 > daysInMonth(start.year, start.month);
    const days: MonthlyDay[] = [{ by: 'date', date: start.day }];
    if (week <= 4) {
      days.push({ by: 'weekday', week: week as WeekOfMonth, weekday });
    }
    if (isLast) days.push({ by: 'weekday', week: -1, weekday });
    return days;
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

  /**
   * THE START MOVED: a pattern that was the start's own follows it; one the
   * user shaped stays put. «Weekly on Thursday» from a Thursday becomes
   * «weekly on Friday» when the start steps to Friday — the preset was
   * about the start — while «Monday and Wednesday» is about those days and
   * keeps them. A monthly «last Thursday» stays a LAST where the new start
   * can be one.
   */
  followingStart(from: CalendarDay, to: CalendarDay): RecurrenceRule {
    const pattern = this.pattern;
    switch (pattern.frequency) {
      case 'daily':
        return this;
      case 'weekly': {
        const own =
          pattern.weekdays.length === 1 &&
          pattern.weekdays[0] === weekdayOfDay(from);
        return own
          ? this.withPattern(RecurrenceRule.patternFor('weekly', to))
          : this;
      }
      case 'monthly': {
        const own = RecurrenceRule.monthlyDaysFor(from).some((day) =>
          sameMonthlyDay(day, pattern.day),
        );
        if (!own) return this;
        const choices = RecurrenceRule.monthlyDaysFor(to);
        const kept =
          pattern.day.by === 'date'
            ? choices[0]
            : pattern.day.week === -1
              ? (choices.find(
                  (day) => day.by === 'weekday' && day.week === -1,
                ) ?? choices.find((day) => day.by === 'weekday'))
              : (choices.find(
                  (day) => day.by === 'weekday' && day.week !== -1,
                ) ?? choices.find((day) => day.by === 'weekday'));
        return kept === undefined
          ? this
          : this.withPattern({ frequency: 'monthly', day: kept });
      }
      case 'yearly': {
        const own = pattern.month === from.month && pattern.date === from.day;
        return own
          ? this.withPattern(RecurrenceRule.patternFor('yearly', to))
          : this;
      }
    }
  }

  equals(other: RecurrenceRule | null): boolean {
    return (
      other !== null &&
      this.interval === other.interval &&
      samePattern(this.pattern, other.pattern) &&
      sameEnd(this.end, other.end)
    );
  }

  /** A pattern read off a real day — valid by construction, so no Result. */
  private withPattern(pattern: RecurrencePattern): RecurrenceRule {
    return new RecurrenceRule(pattern, this.interval, this.end);
  }
}

/**
 * The walk: every day of `rule` from `start` on, in order, until the end —
 * or until `limit` days, for an end so far off it would never be reached.
 * Only days on or after the start count; the start itself only if the rule
 * selects it (Outlook's reading — see {@link RecurrenceSeries}).
 */
function walk(
  rule: RecurrenceRule,
  start: CalendarDay,
  limit: number,
): readonly number[] {
  const from = epochDayOfDay(start);
  const until =
    rule.end.kind === 'until'
      ? Math.min(epochDayOfDay(rule.end.day), LAST_EPOCH_DAY)
      : LAST_EPOCH_DAY;
  const wanted =
    rule.end.kind === 'count' ? Math.min(rule.end.count, limit) : limit;
  const days: number[] = [];
  /** `true` once the walk is over — past the end, or enough days. */
  const take = (day: number): boolean => {
    if (day < from) return false;
    if (day > until) return true;
    days.push(day);
    return days.length >= wanted;
  };

  const step = rule.interval;
  const pattern = rule.pattern;
  switch (pattern.frequency) {
    case 'daily': {
      let day = from;
      while (!take(day)) day += step;
      break;
    }
    case 'weekly': {
      const isos = pattern.weekdays.map(isoOf);
      const monday = from - (isoWeekdayOf(from) - 1);
      walking: for (let week = monday; week <= until; week += 7 * step) {
        for (const iso of isos) if (take(week + iso - 1)) break walking;
      }
      break;
    }
    case 'monthly': {
      const origin = civilOf(from);
      for (let period = 0; period < PERIOD_GUARD; period++) {
        const index = origin.month - 1 + period * step;
        const year = origin.year + Math.floor(index / 12);
        const month = (index % 12) + 1;
        if (epochDayOf(year, month, 1) > until) break;
        const day = pattern.day;
        if (day.by === 'date') {
          if (day.date > daysInMonth(year, month)) continue;
          if (take(epochDayOf(year, month, day.date))) break;
        } else if (
          take(nthWeekdayOf(year, month, isoOf(day.weekday), day.week))
        ) {
          break;
        }
      }
      break;
    }
    case 'yearly': {
      const origin = civilOf(from);
      for (let period = 0; period < PERIOD_GUARD; period++) {
        const year = origin.year + period * step;
        if (epochDayOf(year, 1, 1) > until) break;
        if (pattern.date > daysInMonth(year, pattern.month)) continue;
        if (take(epochDayOf(year, pattern.month, pattern.date))) break;
      }
      break;
    }
  }
  return days;
}

/**
 * A SERIES — a rule bound to the day it starts on, and so to its days.
 *
 * This is where the limits live, because only here are they knowable: an
 * end before the start, a rule that selects nothing before its end («the
 * 31st» until the 20th), a series longer than
 * {@link RecurrenceRule.MAX_OCCURRENCES}. Each is a typed refusal rather
 * than a silently truncated write — the sheet says which, and «Запази»
 * waits.
 *
 * ### The start bounds the series; it is not an occurrence by fiat
 * RFC 5545 counts DTSTART as the first instance even when the rule would
 * not select it, and Google shows the result: an event on a Thursday
 * «weekly on Monday» also lands on that Thursday. Outlook moves the start
 * to the first real day instead, and that is the honest reading for a
 * block — a Thursday nobody asked for is a Thursday no client can book.
 * {@link startsOnStart} says whether the two coincide.
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
    if (rule.end.kind === 'until' && rule.end.day.isBefore(start)) {
      return fail(
        new RecurrenceEndsBeforeStartError(start.key(), rule.end.day.key()),
      );
    }
    // One past the cap, so a series that is too long says so rather than
    // quietly being cut to fit.
    const found = walk(rule, start, MAX_OCCURRENCES + 1);
    if (found.length > MAX_OCCURRENCES) {
      return fail(new RecurrenceTooLongError(MAX_OCCURRENCES));
    }
    if (found.length === 0) {
      return fail(new RecurrenceNeverOccursError(start.key()));
    }
    return ok(
      new RecurrenceSeries(
        start,
        rule,
        found.map((day) => dayAt(day, start.zone)),
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
