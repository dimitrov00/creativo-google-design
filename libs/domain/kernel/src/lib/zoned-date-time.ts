import { DateTime } from 'luxon';
import { Result, fail, ok } from './result';
import {
  AmbiguousLocalTimeError,
  DateTimeResolutionError,
  InvalidDateTimeError,
  InvalidTimeZoneError,
  NonexistentLocalTimeError,
} from './zoned-date-time.errors';

/**
 * What to do with a wall-clock time a DST transition made impossible or
 * ambiguous. There is no safe default, which is why `reject` IS the default:
 * scheduling would rather fail loudly twice a year than move an appointment
 * by an hour without telling anyone.
 *
 * - `reject`       — fail. Every scheduling path uses this.
 * - `shiftForward` — a skipped time becomes the instant one offset later
 *                    (Luxon's silent behaviour, now an explicit opt-in).
 * - `earlier`      — a repeated time resolves to its FIRST occurrence.
 * - `later`        — a repeated time resolves to its SECOND occurrence.
 */
export type DstResolution = 'reject' | 'shiftForward' | 'earlier' | 'later';

export interface ZonedDateTimeParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

/**
 * Wraps Luxon behind a boundary that only exposes what the domain actually
 * needs — swapping the backing library later only touches this file.
 * Luxon over the Temporal polyfill: Temporal is still pre-1.0, Luxon is
 * mature/stable with a long production track record.
 */
export class ZonedDateTime {
  private constructor(private readonly inner: DateTime) {}

  static fromISO(
    iso: string,
    zone: string,
  ): Result<ZonedDateTime, InvalidDateTimeError> {
    const dt = DateTime.fromISO(iso, { zone });
    if (!dt.isValid) {
      return fail(new InvalidDateTimeError(iso, dt.invalidReason ?? 'unknown'));
    }
    return ok(new ZonedDateTime(dt));
  }

  static now(zone: string): Result<ZonedDateTime, InvalidTimeZoneError> {
    const dt = DateTime.now().setZone(zone);
    if (!dt.isValid) {
      return fail(new InvalidTimeZoneError(zone));
    }
    return ok(new ZonedDateTime(dt));
  }

  static isValidZone(zone: string): boolean {
    return DateTime.now().setZone(zone).isValid;
  }

  /**
   * Build from WALL-CLOCK parts — the only way to turn "Monday 09:00" into an
   * instant, and therefore the door every roster window and every slot start
   * comes through.
   *
   * DST is handled here, explicitly, because Luxon handles it silently:
   *
   * | input (Europe/Sofia) | Luxon gives | this returns (default) |
   * |---|---|---|
   * | `2026-03-29 03:30` (skipped) | `04:30+03:00`, isValid **true** | `NonexistentLocalTimeError` |
   * | `2026-10-25 03:30` (repeated) | `03:30+03:00`, the FIRST one | `AmbiguousLocalTimeError` |
   *
   * Detection works by asking Luxon what it did: a gap shows up as parts that
   * came back different from the ones asked for, and an ambiguity shows up as
   * the same wall clock still reading the same an hour later.
   */
  static fromParts(
    parts: ZonedDateTimeParts,
    zone: string,
    resolution: DstResolution = 'reject',
  ): Result<ZonedDateTime, DateTimeResolutionError> {
    if (!ZonedDateTime.isValidZone(zone)) {
      return fail(new InvalidTimeZoneError(zone));
    }
    const dt = DateTime.fromObject(parts, { zone });
    if (!dt.isValid) {
      return fail(
        new InvalidDateTimeError(
          ZonedDateTime.describeParts(parts),
          dt.invalidReason ?? 'unknown',
        ),
      );
    }

    // GAP — Luxon relocated the instant rather than refusing it.
    const isGap =
      dt.hour !== parts.hour ||
      dt.minute !== parts.minute ||
      dt.day !== parts.day;
    if (isGap) {
      return resolution === 'shiftForward'
        ? ok(new ZonedDateTime(dt))
        : fail(
            new NonexistentLocalTimeError(
              ZonedDateTime.describeParts(parts),
              zone,
            ),
          );
    }

    // AMBIGUOUS — the same wall clock one hour later is the second occurrence.
    const shifted = dt.plus({ hours: 1 });
    const isAmbiguous =
      shifted.hour === dt.hour && shifted.minute === dt.minute;
    if (isAmbiguous) {
      if (resolution === 'earlier') return ok(new ZonedDateTime(dt));
      if (resolution === 'later') return ok(new ZonedDateTime(shifted));
      return fail(
        new AmbiguousLocalTimeError(ZonedDateTime.describeParts(parts), zone),
      );
    }

    return ok(new ZonedDateTime(dt));
  }

  /** Rebuild from an epoch instant — the inverse of `toMillis`. */
  static fromMillis(
    ms: number,
    zone: string,
  ): Result<ZonedDateTime, InvalidTimeZoneError> {
    const dt = DateTime.fromMillis(ms, { zone });
    if (!dt.isValid) {
      return fail(new InvalidTimeZoneError(zone));
    }
    return ok(new ZonedDateTime(dt));
  }

  static min(first: ZonedDateTime, ...rest: ZonedDateTime[]): ZonedDateTime {
    return rest.reduce((a, b) => (b.isBefore(a) ? b : a), first);
  }

  static max(first: ZonedDateTime, ...rest: ZonedDateTime[]): ZonedDateTime {
    return rest.reduce((a, b) => (a.isBefore(b) ? b : a), first);
  }

  private static describeParts(parts: ZonedDateTimeParts): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
  }

  /**
   * Short weekday labels (Mon…Sun) for a calendar header, localized. Built
   * from a fixed reference Monday rather than "now" — the labels never
   * depend on the current date, only on `locale`.
   */
  static weekdayLabels(zone: string, locale: string): readonly string[] {
    const referenceMonday = DateTime.fromISO('2025-01-06T00:00:00', {
      zone,
    }).setLocale(locale);
    return Array.from({ length: 7 }, (_, i) =>
      referenceMonday.plus({ days: i }).toLocaleString({ weekday: 'short' }),
    );
  }

  plusMinutes(minutes: number): ZonedDateTime {
    return new ZonedDateTime(this.inner.plus({ minutes }));
  }

  /** Negative values move backward — there is no separate `minusDays`. */
  plusDays(days: number): ZonedDateTime {
    return new ZonedDateTime(this.inner.plus({ days }));
  }

  /** Negative values move backward — there is no separate `minusMonths`. */
  plusMonths(months: number): ZonedDateTime {
    return new ZonedDateTime(this.inner.plus({ months }));
  }

  /** Midnight on the 1st of this instant's calendar month, same zone. */
  startOfMonth(): ZonedDateTime {
    return new ZonedDateTime(this.inner.startOf('day').startOf('month'));
  }

  /** Local midnight of this calendar day — the grid origin, never the epoch. */
  startOfDay(): ZonedDateTime {
    return new ZonedDateTime(this.inner.startOf('day'));
  }

  /**
   * Local midnight of the NEXT calendar day — the EXCLUSIVE end of this day.
   *
   * Deliberately `plus({days:1}).startOf('day')` rather than
   * `startOf('day').plus({hours:24})`: a Sofia spring day is 23 hours and an
   * autumn day is 25, so adding 24 hours lands an hour off twice a year.
   * Calendar arithmetic is the correct tool for "the next day"; exact
   * arithmetic (`plusMinutes`) is the correct tool for "later within a
   * service". They are not interchangeable.
   */
  startOfNextDay(): ZonedDateTime {
    return new ZonedDateTime(
      this.inner.startOf('day').plus({ days: 1 }).startOf('day'),
    );
  }

  /**
   * The same calendar day at a given wall-clock time — how a roster's
   * "09:00" becomes an instant on a specific date. DST-checked exactly like
   * {@link fromParts}, because a shop whose day starts at 03:00 would hit the
   * same gap.
   */
  atTime(
    hour: number,
    minute: number,
    resolution: DstResolution = 'reject',
  ): Result<ZonedDateTime, DateTimeResolutionError> {
    return ZonedDateTime.fromParts(
      { year: this.year, month: this.month, day: this.day, hour, minute },
      this.zoneName,
      resolution,
    );
  }

  isBefore(other: ZonedDateTime): boolean {
    return this.inner < other.inner;
  }

  isAfter(other: ZonedDateTime): boolean {
    return this.inner > other.inner;
  }

  isSameOrBefore(other: ZonedDateTime): boolean {
    return this.inner <= other.inner;
  }

  isSameOrAfter(other: ZonedDateTime): boolean {
    return this.inner >= other.inner;
  }

  equals(other: ZonedDateTime): boolean {
    return this.inner.toMillis() === other.inner.toMillis();
  }

  /**
   * The epoch instant. Interval algebra runs on these integers, not on
   * wall-clock values: converting once at the boundary takes DST out of every
   * inner loop, and two instants compare correctly regardless of the offsets
   * their local renderings happen to carry.
   */
  toMillis(): number {
    return this.inner.toMillis();
  }

  /**
   * Exact elapsed minutes to `other` — measured between INSTANTS, so a span
   * crossing a DST boundary reports the time that actually passed rather than
   * the difference the wall clocks suggest.
   */
  minutesUntil(other: ZonedDateTime): number {
    return (other.inner.toMillis() - this.inner.toMillis()) / 60_000;
  }

  /**
   * `YYYY-MM-DD` in this instant's own zone — the sortable calendar-day key.
   * Never derived from a raw `Date` (blueprint §7.1: a UTC server or a
   * travelling client would otherwise land on the wrong day).
   */
  toISODate(): string {
    return this.inner.toISODate() as string;
  }

  /**
   * Whole years elapsed from this instant to `other`, counting a birthday
   * only once the calendar month/day has actually passed — the one true way
   * to compute an age without ever touching a raw `Date`.
   */
  yearsUntil(other: ZonedDateTime): number {
    return Math.trunc(other.inner.diff(this.inner, 'years').years);
  }

  get year(): number {
    return this.inner.year;
  }

  get month(): number {
    return this.inner.month;
  }

  get day(): number {
    return this.inner.day;
  }

  get hour(): number {
    return this.inner.hour;
  }

  get minute(): number {
    return this.inner.minute;
  }

  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  get weekday(): number {
    return this.inner.weekday;
  }

  /** Number of days in this instant's calendar month. */
  get daysInMonth(): number {
    return this.inner.daysInMonth ?? 0;
  }

  /**
   * Locale-formatted rendering for display — the one sanctioned escape
   * hatch for turning an instant into user-facing text without any caller
   * touching `Date`/`Intl` directly (kernel-only Luxon import rule, §7.1).
   */
  toLocaleString(locale: string, options: Intl.DateTimeFormatOptions): string {
    return this.inner.setLocale(locale).toLocaleString(options);
  }

  toISO(): string {
    // Only ever constructed from an already-valid DateTime (both factories
    // check .isValid before wrapping), so toISO() cannot actually return
    // null here despite Luxon's type signature allowing it for invalid
    // instances.
    return this.inner.toISO() as string;
  }

  get zoneName(): string {
    return this.inner.zoneName as string;
  }
}
