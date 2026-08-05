import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import { CalendarDay } from './calendar-day';
import { Interval } from './interval';
import {
  InvalidLocalTimeRangeError,
  InvalidTimeOfDayError,
} from './local-time-of-day.errors';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * A wall-clock time of day, `HH:mm` — no date, no zone, no instant.
 *
 * This is what a recurring roster is written in: "Ivan works 09:00–18:00 on
 * Tuesdays" is a claim about clock faces, not about instants, and it stays
 * true across a DST transition precisely BECAUSE it has no date. The date
 * arrives later, in {@link onDay}, which is the single place a clock face
 * becomes a real moment — and therefore the single place DST can bite.
 */
export class LocalTimeOfDay {
  private constructor(
    readonly hour: number,
    readonly minute: number,
  ) {}

  static create(raw: string): Result<LocalTimeOfDay, InvalidTimeOfDayError> {
    if (!TIME_REGEX.test(raw)) {
      return fail(new InvalidTimeOfDayError(raw));
    }
    const [hour, minute] = raw.split(':').map(Number) as [number, number];
    return ok(new LocalTimeOfDay(hour, minute));
  }

  static of(
    hour: number,
    minute: number,
  ): Result<LocalTimeOfDay, InvalidTimeOfDayError> {
    return LocalTimeOfDay.create(
      `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    );
  }

  /** Zero-padded `HH:mm` — sorts lexically, which is why it is padded. */
  toString(): string {
    return `${String(this.hour).padStart(2, '0')}:${String(this.minute).padStart(2, '0')}`;
  }

  minutesFromMidnight(): number {
    return this.hour * 60 + this.minute;
  }

  isBefore(other: LocalTimeOfDay): boolean {
    return this.minutesFromMidnight() < other.minutesFromMidnight();
  }

  equals(other: LocalTimeOfDay): boolean {
    return this.minutesFromMidnight() === other.minutesFromMidnight();
  }

  /**
   * This clock face on a specific calendar day, as an instant.
   *
   * Fails when the day's DST transition erased that time — `03:30` simply
   * does not happen in Sofia on 2026-03-29. A roster claiming it must be
   * reported, not silently moved an hour, which is what the underlying
   * library would do.
   */
  onDay(day: CalendarDay): Result<ZonedDateTime, InvalidTimeOfDayError> {
    const result = day.startOfDay().atTime(this.hour, this.minute);
    if (result.isFailure()) {
      return fail(new InvalidTimeOfDayError(`${day.key()}T${this.toString()}`));
    }
    return ok(result.value);
  }
}

/**
 * A `[start, end)` span of wall-clock time within one day, e.g. the morning
 * half of a shift split by lunch.
 *
 * Cannot cross midnight: an overnight shift is two ranges on two days, which
 * keeps "a day's windows" a closed question and stops a single range from
 * silently belonging to two calendar days (and therefore two day documents).
 */
export class LocalTimeRange {
  private constructor(
    readonly start: LocalTimeOfDay,
    readonly end: LocalTimeOfDay,
  ) {}

  static of(
    start: LocalTimeOfDay,
    end: LocalTimeOfDay,
  ): Result<LocalTimeRange, InvalidLocalTimeRangeError> {
    if (!start.isBefore(end)) {
      return fail(
        new InvalidLocalTimeRangeError(start.toString(), end.toString()),
      );
    }
    return ok(new LocalTimeRange(start, end));
  }

  static create(
    startRaw: string,
    endRaw: string,
  ): Result<
    LocalTimeRange,
    InvalidTimeOfDayError | InvalidLocalTimeRangeError
  > {
    const start = LocalTimeOfDay.create(startRaw);
    if (start.isFailure()) return fail(start.error);
    const end = LocalTimeOfDay.create(endRaw);
    if (end.isFailure()) return fail(end.error);
    return LocalTimeRange.of(start.value, end.value);
  }

  durationMinutes(): number {
    return this.end.minutesFromMidnight() - this.start.minutesFromMidnight();
  }

  /** Half-open, so `09:00–12:00` and `12:00–17:00` do not overlap. */
  overlaps(other: LocalTimeRange): boolean {
    return (
      this.start.minutesFromMidnight() < other.end.minutesFromMidnight() &&
      other.start.minutesFromMidnight() < this.end.minutesFromMidnight()
    );
  }

  /**
   * This clock-face span on a specific day, as an epoch interval.
   *
   * The single place a declared window ("I'm free 08:00–12:00") becomes
   * something the availability engine can intersect — and therefore the single
   * place DST can bite, exactly as {@link LocalTimeOfDay.onDay} documents.
   * Both ends are resolved on the SAME day, so a Sofia spring-forward window
   * is 3 hours of wall clock and 2 hours of real time, which is the truth.
   */
  onDay(day: CalendarDay): Result<Interval, InvalidTimeOfDayError> {
    const start = this.start.onDay(day);
    if (start.isFailure()) return fail(start.error);
    const end = this.end.onDay(day);
    if (end.isFailure()) return fail(end.error);
    return ok(Interval.of(start.value.toMillis(), end.value.toMillis()));
  }

  equals(other: LocalTimeRange): boolean {
    return this.start.equals(other.start) && this.end.equals(other.end);
  }

  /**
   * Sorted, with overlapping and ABUTTING spans merged.
   *
   * Abutting is merged as well as overlapping — `08:00–12:00` and
   * `12:00–15:00` are one availability of `08:00–15:00`, and leaving them as
   * two would show a person two rows describing one continuous morning.
   * Merging in minutes-from-midnight keeps this pure integer arithmetic on
   * clock faces; no day, no zone, no DST.
   */
  static normalize(
    ranges: readonly LocalTimeRange[],
  ): readonly LocalTimeRange[] {
    const sorted = ranges
      .slice()
      .sort(
        (a, b) =>
          a.start.minutesFromMidnight() - b.start.minutesFromMidnight() ||
          a.end.minutesFromMidnight() - b.end.minutesFromMidnight(),
      );

    const merged: LocalTimeRange[] = [];
    for (const range of sorted) {
      const last = merged.at(-1);
      if (
        !last ||
        last.end.minutesFromMidnight() < range.start.minutesFromMidnight()
      ) {
        merged.push(range);
        continue;
      }
      if (last.end.minutesFromMidnight() >= range.end.minutesFromMidnight()) {
        continue;
      }
      // Widen in place. `of` cannot fail here: `last.start` already precedes
      // `last.end`, which this branch has established precedes `range.end`.
      const widened = LocalTimeRange.of(last.start, range.end);
      if (widened.isSuccess()) merged[merged.length - 1] = widened.value;
    }
    return merged;
  }

  toString(): string {
    return `${this.start.toString()}–${this.end.toString()}`;
  }
}
