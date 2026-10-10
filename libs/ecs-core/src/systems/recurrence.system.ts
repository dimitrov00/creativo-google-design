import { DayKey } from '../components/day-key.data';
import {
  Frequency,
  MonthlyDayKind,
  RecurrenceEndKind,
  RecurrenceRule,
  WeekOfMonth,
} from '../components/recurrence-rule.data';
import { Result } from '../components/result.data';
import { SchedulingError } from '../components/scheduling-errors.data';
import { Weekday } from '../components/weekday.data';

/**
 * A SERIES — a rule bound to the day it starts on, and so to its days
 * (`recurrence-rule.ts:478-557`). In memory only (§9 D16(b): a series is not
 * stored; its days are written one exception per barber-day).
 *
 * - `startDayKey` — the day the series was started from. It BOUNDS the
 *   series; it is not an occurrence by fiat (Outlook's reading, not RFC
 *   5545's): a Thursday nobody asked for is a Thursday no client can book.
 * - `dayKeys` — every day of the series, in order; never empty, never more
 *   than {@link RecurrenceRule.MAX_OCCURRENCES}.
 */
export type RecurrenceSeries = {
  readonly startDayKey: DayKey;
  readonly rule: RecurrenceRule;
  readonly dayKeys: readonly DayKey[];
};

/**
 * Periods a monthly or yearly walk tries before giving up on a pattern that
 * cannot land (the 31st, every twelfth month, from a February) —
 * `recurrence-rule.ts:70`. Plain arithmetic: ten thousand steps cost
 * microseconds.
 */
const PERIOD_GUARD = 10_000;

/** The last day a four-digit day key can name — where every walk stops. */
const LAST_EPOCH_DAY = DayKey.epochDayOf(9999, 12, 31);

/** The civil parts of an epoch day — the replacement for `civilOf`'s `new Date`. */
type Civil = {
  readonly year: number;
  readonly month: number;
  readonly date: number;
};

function civilOf(epochDay: number): Civil {
  const key = DayKey.fromEpochDay(epochDay);
  return {
    year: Number(key.slice(0, 4)),
    month: Number(key.slice(5, 7)),
    date: Number(key.slice(8, 10)),
  };
}

function civilOfKey(dayKey: DayKey): Civil {
  return {
    year: Number(dayKey.slice(0, 4)),
    month: Number(dayKey.slice(5, 7)),
    date: Number(dayKey.slice(8, 10)),
  };
}

function weekdayOfKey(dayKey: DayKey): Weekday {
  return Weekday.ofEpochDay(DayKey.toEpochDay(dayKey));
}

/** The `week`-th (or last) `weekday` of a month, as an epoch day. Always exists. */
function nthWeekdayOf(
  year: number,
  month: number,
  weekday: Weekday,
  week: WeekOfMonth,
): number {
  if (week === WeekOfMonth.Last) {
    const last = DayKey.epochDayOf(
      year,
      month,
      DayKey.daysInMonth(year, month),
    );
    return last - ((Weekday.ofEpochDay(last) - weekday + 7) % 7);
  }
  const first = DayKey.epochDayOf(year, month, 1);
  return (
    first + ((weekday - Weekday.ofEpochDay(first) + 7) % 7) + (week - 1) * 7
  );
}

function sameMonthlyDay(
  a: RecurrenceRule.MonthlyDay,
  b: RecurrenceRule.MonthlyDay,
): boolean {
  if (a.kind === MonthlyDayKind.Date) {
    return b.kind === MonthlyDayKind.Date && a.date === b.date;
  }
  return (
    b.kind === MonthlyDayKind.Weekday &&
    a.week === b.week &&
    a.weekday === b.weekday
  );
}

/** A pattern read off a real day — valid by construction, so no `Result`. */
function withPattern(
  rule: RecurrenceRule,
  pattern: RecurrenceRule.Pattern,
): RecurrenceRule {
  return { pattern, interval: rule.interval, end: rule.end };
}

/**
 * The walk (`recurrence-rule.ts:418-476`): every day of `rule` from `from`
 * on, in order, up to `until` (inclusive) and at most `limit` days — fewer
 * when the rule's own count stops first. Only days on or after `from` count;
 * `from` itself only if the rule selects it. Epoch-day integers throughout:
 * a day is always one step, and «every Tuesday» names the same Tuesday in
 * every zone.
 */
function walk(
  rule: RecurrenceRule,
  from: number,
  until: number,
  limit: number,
): readonly number[] {
  const wanted =
    rule.end.kind === RecurrenceEndKind.Count
      ? Math.min(rule.end.count, limit)
      : limit;
  const days: number[] = [];
  if (wanted <= 0) return days;

  /** `true` once the walk is over — past the end, or enough days. */
  const take = (day: number): boolean => {
    if (day < from) return false;
    if (day > until) return true;
    days.push(day);
    return days.length >= wanted;
  };

  const step = rule.interval;
  const pattern = rule.pattern;
  switch (pattern.kind) {
    case Frequency.Daily: {
      let day = from;
      while (!take(day)) day += step;
      break;
    }
    case Frequency.Weekly: {
      const monday = from - (Weekday.ofEpochDay(from) - 1);
      walking: for (let week = monday; week <= until; week += 7 * step) {
        for (let i = 0; i < pattern.weekdays.length; i++) {
          if (take(week + (pattern.weekdays[i] as Weekday) - 1)) break walking;
        }
      }
      break;
    }
    case Frequency.Monthly: {
      const origin = civilOf(from);
      const day = pattern.day;
      for (let period = 0; period < PERIOD_GUARD; period++) {
        const index = origin.month - 1 + period * step;
        const year = origin.year + Math.floor(index / 12);
        const month = (index % 12) + 1;
        if (DayKey.epochDayOf(year, month, 1) > until) break;
        if (day.kind === MonthlyDayKind.Date) {
          if (day.date > DayKey.daysInMonth(year, month)) continue;
          if (take(DayKey.epochDayOf(year, month, day.date))) break;
        } else if (take(nthWeekdayOf(year, month, day.weekday, day.week))) {
          break;
        }
      }
      break;
    }
    case Frequency.Yearly: {
      const origin = civilOf(from);
      for (let period = 0; period < PERIOD_GUARD; period++) {
        const year = origin.year + period * step;
        if (DayKey.epochDayOf(year, 1, 1) > until) break;
        if (pattern.date > DayKey.daysInMonth(year, pattern.month)) continue;
        if (take(DayKey.epochDayOf(year, pattern.month, pattern.date))) break;
      }
      break;
    }
  }
  return days;
}

/** The rule's own last day as an epoch day, capped at the last four-digit day. */
function endEpochDay(rule: RecurrenceRule): number {
  return rule.end.kind === RecurrenceEndKind.Until
    ? Math.min(DayKey.toEpochDay(rule.end.dayKey), LAST_EPOCH_DAY)
    : LAST_EPOCH_DAY;
}

function toKeys(days: readonly number[]): readonly DayKey[] {
  const keys: DayKey[] = [];
  for (let i = 0; i < days.length; i++) {
    keys.push(DayKey.fromEpochDay(days[i] as number));
  }
  return keys;
}

/**
 * Which days a recurrence rule selects — the walk, the presets and the
 * series limits of `recurrence-rule.ts:252-557`, over CIVIL day keys. The
 * rule itself (canonical weekdays, the interval and count caps, equality)
 * is the {@link RecurrenceRule} component.
 *
 * Civil arithmetic only: Howard Hinnant's `days_from_civil` /
 * `civil_from_days` (`DayKey.epochDayOf` / `DayKey.fromEpochDay`), the leap
 * rule's month lengths (`DayKey.daysInMonth`) and the epoch-day weekday
 * (`Weekday.ofEpochDay`) replace the legacy `Date.UTC` / `new Date` calls. A
 * weekday is a property of the civil day, the same in every zone, so no zone
 * table is needed — the series' day keys become instants only where a write
 * lifts them into the shop's zone.
 */
export const RecurrenceSystem = {
  /**
   * What a bare frequency means from `startDayKey` — «every week» on the
   * start's weekday, «every month» on its date, «every year» on its day
   * (`recurrence-rule.ts:276-290`). Total: a pattern read off a real day is
   * always a real pattern.
   */
  patternFor(
    frequency: Frequency,
    startDayKey: DayKey,
  ): RecurrenceRule.Pattern {
    const start = civilOfKey(startDayKey);
    switch (frequency) {
      case Frequency.Daily:
        return { kind: Frequency.Daily };
      case Frequency.Weekly:
        return {
          kind: Frequency.Weekly,
          weekdays: [weekdayOfKey(startDayKey)],
        };
      case Frequency.Monthly:
        return {
          kind: Frequency.Monthly,
          day: { kind: MonthlyDayKind.Date, date: start.date },
        };
      case Frequency.Yearly:
        return { kind: Frequency.Yearly, month: start.month, date: start.date };
    }
  },

  /**
   * The monthly readings a start offers — Google's own list
   * (`recurrence-rule.ts:297-308`): «on the 24th», «on the fourth Thursday»,
   * and «on the last Thursday» when the start is in its month's last seven
   * days. A fifth weekday offers only «last».
   */
  monthlyDaysFor(startDayKey: DayKey): readonly RecurrenceRule.MonthlyDay[] {
    const start = civilOfKey(startDayKey);
    const weekday = weekdayOfKey(startDayKey);
    const week = Math.ceil(start.date / 7);
    const isLast = start.date + 7 > DayKey.daysInMonth(start.year, start.month);
    const days: RecurrenceRule.MonthlyDay[] = [
      { kind: MonthlyDayKind.Date, date: start.date },
    ];
    if (week <= 4) {
      days.push({
        kind: MonthlyDayKind.Weekday,
        week: week as WeekOfMonth,
        weekday,
      });
    }
    if (isLast) {
      days.push({
        kind: MonthlyDayKind.Weekday,
        week: WeekOfMonth.Last,
        weekday,
      });
    }
    return days;
  },

  /**
   * THE START MOVED (`recurrence-rule.ts:332-375`): a pattern that was the
   * start's own follows it; one the user shaped stays put. «Weekly on
   * Thursday» from a Thursday becomes «weekly on Friday» when the start steps
   * to Friday, while «Monday and Wednesday» keeps its days. A monthly «last
   * Thursday» stays a LAST where the new start can be one. An unchanged rule
   * comes back as the SAME struct (identity), so a caller can tell.
   */
  followingStart(
    rule: RecurrenceRule,
    fromDayKey: DayKey,
    toDayKey: DayKey,
  ): RecurrenceRule {
    const pattern = rule.pattern;
    switch (pattern.kind) {
      case Frequency.Daily:
        return rule;
      case Frequency.Weekly: {
        const own =
          pattern.weekdays.length === 1 &&
          pattern.weekdays[0] === weekdayOfKey(fromDayKey);
        return own
          ? withPattern(
              rule,
              RecurrenceSystem.patternFor(Frequency.Weekly, toDayKey),
            )
          : rule;
      }
      case Frequency.Monthly: {
        const fromChoices = RecurrenceSystem.monthlyDaysFor(fromDayKey);
        let own = false;
        for (let i = 0; i < fromChoices.length; i++) {
          if (
            sameMonthlyDay(
              fromChoices[i] as RecurrenceRule.MonthlyDay,
              pattern.day,
            )
          ) {
            own = true;
            break;
          }
        }
        if (!own) return rule;
        const choices = RecurrenceSystem.monthlyDaysFor(toDayKey);
        let kept: RecurrenceRule.MonthlyDay | null = null;
        if (pattern.day.kind === MonthlyDayKind.Date) {
          kept = choices[0] ?? null;
        } else {
          const wantLast = pattern.day.week === WeekOfMonth.Last;
          let anyWeekday: RecurrenceRule.MonthlyDay | null = null;
          for (let i = 0; i < choices.length; i++) {
            const choice = choices[i] as RecurrenceRule.MonthlyDay;
            if (choice.kind !== MonthlyDayKind.Weekday) continue;
            if (anyWeekday === null) anyWeekday = choice;
            if ((choice.week === WeekOfMonth.Last) === wantLast) {
              kept = choice;
              break;
            }
          }
          if (kept === null) kept = anyWeekday;
        }
        return kept === null
          ? rule
          : withPattern(rule, { kind: Frequency.Monthly, day: kept });
      }
      case Frequency.Yearly: {
        const from = civilOfKey(fromDayKey);
        const own = pattern.month === from.month && pattern.date === from.date;
        return own
          ? withPattern(
              rule,
              RecurrenceSystem.patternFor(Frequency.Yearly, toDayKey),
            )
          : rule;
      }
    }
  },

  /**
   * The days `rule` selects from `fromDayKey` through `toDayKey` (both
   * inclusive), in order — bounded by `toDayKey`, by the rule's own end (its
   * `until` day or its `count`, counted from `fromDayKey`) AND by
   * {@link RecurrenceRule.MAX_OCCURRENCES}, so no call materialises more than
   * a year of days. `[]` when nothing lands (or `toDayKey` precedes
   * `fromDayKey`).
   */
  occurrences(
    rule: RecurrenceRule,
    fromDayKey: DayKey,
    toDayKey: DayKey,
  ): readonly DayKey[] {
    const until = Math.min(endEpochDay(rule), DayKey.toEpochDay(toDayKey));
    return toKeys(
      walk(
        rule,
        DayKey.toEpochDay(fromDayKey),
        until,
        RecurrenceRule.MAX_OCCURRENCES,
      ),
    );
  },

  /**
   * Bind `rule` to the day it starts on (`RecurrenceSeries.create`,
   * `recurrence-rule.ts:501-526`). The limits live here because only here
   * are they knowable, each a refusal rather than a silently truncated write:
   * an `until` before the start (`scheduling.recurrence.ends_before_start`),
   * more than {@link RecurrenceRule.MAX_OCCURRENCES} days
   * (`scheduling.recurrence.too_long` — the walk looks one day past the cap
   * to know), and a rule that selects nothing before its end
   * (`scheduling.recurrence.never_occurs`).
   */
  series(
    startDayKey: DayKey,
    rule: RecurrenceRule,
  ): Result<RecurrenceSeries, SchedulingError> {
    if (
      rule.end.kind === RecurrenceEndKind.Until &&
      rule.end.dayKey < startDayKey
    ) {
      return Result.err(
        SchedulingError.recurrenceEndsBeforeStart(startDayKey, rule.end.dayKey),
      );
    }
    const found = walk(
      rule,
      DayKey.toEpochDay(startDayKey),
      endEpochDay(rule),
      RecurrenceRule.MAX_OCCURRENCES + 1,
    );
    if (found.length > RecurrenceRule.MAX_OCCURRENCES) {
      return Result.err(
        SchedulingError.recurrenceTooLong(RecurrenceRule.MAX_OCCURRENCES),
      );
    }
    if (found.length === 0) {
      return Result.err(SchedulingError.recurrenceNeverOccurs(startDayKey));
    }
    return Result.ok({ startDayKey, rule, dayKeys: toKeys(found) });
  },

  /** Is the day the series was started from one of its days (its first)? */
  startsOnStart(series: RecurrenceSeries): boolean {
    return series.dayKeys[0] === series.startDayKey;
  },
} as const;
