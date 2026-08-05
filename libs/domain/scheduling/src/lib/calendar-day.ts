import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import { Interval } from './interval';
import {
  InvalidCalendarDayError,
  InvalidDateRangeError,
} from './calendar-day.errors';

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A calendar day in a specific zone — `2026-07-29` in `Europe/Sofia`.
 *
 * Exists because "a day" is the unit availability is stored, queried and
 * reported by, and a bare `'YYYY-MM-DD'` string cannot say *whose* day it is.
 * The same key means different instants in different zones, and the product
 * already carries a `Location.timezone` per shop.
 *
 * The zone is what makes {@link bounds} honest: a Sofia day is 23 hours on the
 * spring transition and 25 on the autumn one, so a day is NOT 24 hours and
 * nothing here may assume it is.
 */
export class CalendarDay {
  private constructor(
    readonly year: number,
    readonly month: number,
    readonly day: number,
    readonly zone: string,
  ) {}

  /** From a sortable `YYYY-MM-DD` key — the Firestore document key form. */
  static create(
    key: string,
    zone: string,
  ): Result<CalendarDay, InvalidCalendarDayError> {
    if (!DAY_KEY.test(key)) {
      return fail(new InvalidCalendarDayError(key));
    }
    const [year, month, day] = key.split('-').map(Number) as [
      number,
      number,
      number,
    ];
    // Round-trip through the zone: this rejects 2026-02-30 and an unknown
    // zone in one step, rather than trusting the regex.
    const probe = ZonedDateTime.fromParts(
      { year, month, day, hour: 12, minute: 0 },
      zone,
    );
    if (probe.isFailure() || probe.value.toISODate() !== key) {
      return fail(new InvalidCalendarDayError(key));
    }
    return ok(new CalendarDay(year, month, day, zone));
  }

  /** The calendar day an instant falls on, in that instant's own zone. */
  static fromZonedDateTime(instant: ZonedDateTime): CalendarDay {
    return new CalendarDay(
      instant.year,
      instant.month,
      instant.day,
      instant.zoneName,
    );
  }

  /** `YYYY-MM-DD` — sortable, and the document key. */
  key(): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${this.year}-${pad(this.month)}-${pad(this.day)}`;
  }

  /** Local midnight. Total: a day always has a start. */
  startOfDay(): ZonedDateTime {
    // `fromParts` at midnight can only fail in zones whose DST transition
    // lands exactly on 00:00 (Cuba, Chile, Lord Howe). Falling back to noon
    // and walking back keeps this total for every zone rather than pushing a
    // Result onto every caller for a case Europe/Sofia never hits.
    const midnight = ZonedDateTime.fromParts(
      { year: this.year, month: this.month, day: this.day, hour: 0, minute: 0 },
      this.zone,
      'shiftForward',
    );
    if (midnight.isSuccess()) return midnight.value.startOfDay();
    const noon = ZonedDateTime.fromParts(
      {
        year: this.year,
        month: this.month,
        day: this.day,
        hour: 12,
        minute: 0,
      },
      this.zone,
      'shiftForward',
    );
    if (noon.isFailure()) throw new Error('unreachable: validated day');
    return noon.value.startOfDay();
  }

  /**
   * The day as an interval, `[local midnight, next local midnight)`.
   * 23 or 25 hours on a transition day — never assume 24.
   */
  bounds(): Interval {
    const start = this.startOfDay();
    return Interval.of(start.toMillis(), start.startOfNextDay().toMillis());
  }

  next(): CalendarDay {
    return CalendarDay.fromZonedDateTime(this.startOfDay().startOfNextDay());
  }

  previous(): CalendarDay {
    return CalendarDay.fromZonedDateTime(this.startOfDay().plusDays(-1));
  }

  /**
   * `count` days away, walking one day at a time.
   *
   * Deliberately a walk and not `+ count * 86_400_000`: a day is 23 or 25
   * hours on a transition, so millisecond arithmetic silently repeats or skips
   * a date twice a year. `count` may be negative.
   */
  plusDays(count: number): CalendarDay {
    let cursor = count > 0 ? this.next() : this.previous();
    if (count === 0) return this;
    for (let step = 1; step < Math.abs(count); step++) {
      cursor = count > 0 ? cursor.next() : cursor.previous();
    }
    return cursor;
  }

  /** The 1st of this day's month, same zone. */
  startOfMonth(): CalendarDay {
    const first = CalendarDay.create(`${this.key().slice(0, 8)}01`, this.zone);
    if (first.isFailure()) throw new Error('unreachable: validated day');
    return first.value;
  }

  /**
   * The last day of this day's month — 28th, 29th, 30th or 31st, discovered by
   * walking rather than by a lookup table with a leap-year rule in it.
   */
  endOfMonth(): CalendarDay {
    if (this.next().month !== this.month) return this;
    let cursor = this.next();
    while (cursor.next().month === cursor.month) cursor = cursor.next();
    return cursor;
  }

  /** Same year and month — what a month grid asks of every cell it renders. */
  isSameMonthAs(other: CalendarDay): boolean {
    return this.year === other.year && this.month === other.month;
  }

  /** ISO weekday: 1 = Monday … 7 = Sunday. The roster pattern's key. */
  weekday(): number {
    return this.startOfDay().weekday;
  }

  equals(other: CalendarDay): boolean {
    return this.key() === other.key() && this.zone === other.zone;
  }

  isBefore(other: CalendarDay): boolean {
    return this.key() < other.key();
  }
}

/**
 * An inclusive span of calendar days — the shape a month view and a
 * materialisation horizon are both expressed in.
 */
export class DateRange {
  private constructor(
    readonly from: CalendarDay,
    readonly to: CalendarDay,
  ) {}

  static create(
    from: CalendarDay,
    to: CalendarDay,
  ): Result<DateRange, InvalidDateRangeError> {
    if (from.zone !== to.zone) {
      return fail(new InvalidDateRangeError(from.key(), to.key()));
    }
    if (to.isBefore(from)) {
      return fail(new InvalidDateRangeError(from.key(), to.key()));
    }
    return ok(new DateRange(from, to));
  }

  /** Every day in the span, inclusive of both ends. */
  days(): readonly CalendarDay[] {
    const days: CalendarDay[] = [];
    let cursor = this.from;
    while (!this.to.isBefore(cursor)) {
      days.push(cursor);
      cursor = cursor.next();
    }
    return days;
  }

  contains(day: CalendarDay): boolean {
    return !day.isBefore(this.from) && !this.to.isBefore(day);
  }

  dayCount(): number {
    return this.days().length;
  }
}
