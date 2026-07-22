import { DateTime } from 'luxon';
import { Result, fail, ok } from './result';
import {
  InvalidDateTimeError,
  InvalidTimeZoneError,
} from './zoned-date-time.errors';

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
    return new ZonedDateTime(this.inner.startOf('month'));
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
