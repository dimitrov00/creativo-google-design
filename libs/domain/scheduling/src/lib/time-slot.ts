import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import {
  InvalidTimeSlotRangeError,
  type TimeSlotError,
} from './time-slot.errors';

export interface TimeSlotProps {
  readonly startIso: string;
  readonly endIso: string;
  readonly zone: string;
}

/**
 * Value object: a half-open interval `[start, end)` carried as
 * `ZonedDateTime` — the wall-clock-faithful shape for availability windows
 * and bookings. INVARIANT (enforced by every factory): `start` is strictly
 * before `end`, so a zero-length slot is unrepresentable.
 *
 * `calendarDayKey()` is the one place a calendar day is derived from this
 * slot, and it delegates to `ZonedDateTime.toISODate()` — the local
 * calendar day in the slot's OWN zone, never a raw `Date` — per
 * migration-blueprint.md §7.1 (v2's `DateString.fromDate` used the
 * runtime-local timezone and could pick the wrong calendar day for a UTC
 * server/foreign device on an `Europe/Sofia` product).
 */
export class TimeSlot {
  private constructor(
    readonly start: ZonedDateTime,
    readonly end: ZonedDateTime,
  ) {}

  /**
   * Rebuild from persisted ISO strings.
   *
   * SAFE ONLY for strings that carry an offset (everything this product
   * writes does — `ZonedDateTime.toISO()` always emits one). A bare
   * wall-clock string like `'2026-03-29T03:30'` is a DST hazard: Luxon
   * silently relocates a skipped time and silently picks the first of a
   * repeated one. Build from instants via {@link of} or {@link fromDuration}
   * whenever the input is wall-clock — those go through
   * `ZonedDateTime.fromParts`, which refuses both.
   */
  static create(props: TimeSlotProps): Result<TimeSlot, TimeSlotError> {
    const startResult = ZonedDateTime.fromISO(props.startIso, props.zone);
    if (startResult.isFailure()) {
      return fail(startResult.error);
    }
    const endResult = ZonedDateTime.fromISO(props.endIso, props.zone);
    if (endResult.isFailure()) {
      return fail(endResult.error);
    }
    return TimeSlot.of(startResult.value, endResult.value);
  }

  /** From two instants — the primary constructor. */
  static of(
    start: ZonedDateTime,
    end: ZonedDateTime,
  ): Result<TimeSlot, InvalidTimeSlotRangeError> {
    if (!start.isBefore(end)) {
      return fail(new InvalidTimeSlotRangeError());
    }
    return ok(new TimeSlot(start, end));
  }

  /**
   * A slot of `durationMinutes` starting at `start` — how a candidate start
   * plus a service's duration becomes a bookable slot.
   *
   * `plusMinutes` is EXACT elapsed time, so a slot that straddles a DST
   * transition still lasts the minutes it was sold for; its wall-clock end
   * simply reads an hour off, which is correct — the client really is in the
   * chair for 45 minutes.
   */
  static fromDuration(
    start: ZonedDateTime,
    durationMinutes: number,
  ): Result<TimeSlot, InvalidTimeSlotRangeError> {
    return TimeSlot.of(start, start.plusMinutes(durationMinutes));
  }

  /** Whether this slot and `other` share any instant. */
  overlaps(other: TimeSlot): boolean {
    return this.start.isBefore(other.end) && other.start.isBefore(this.end);
  }

  /**
   * Whether this slot ends exactly where `other` begins. Half-open intervals
   * make abutting slots NOT overlap, which is what lets one barber take a
   * party's second seat the moment the first ends.
   */
  abuts(other: TimeSlot): boolean {
    return this.end.equals(other.start) || other.end.equals(this.start);
  }

  /** Exact elapsed minutes — from instants, so DST cannot distort it. */
  durationMinutes(): number {
    return this.start.minutesUntil(this.end);
  }

  get startMs(): number {
    return this.start.toMillis();
  }

  get endMs(): number {
    return this.end.toMillis();
  }

  /** Whether `other` falls entirely within this slot. */
  contains(other: TimeSlot): boolean {
    return (
      this.start.isSameOrBefore(other.start) &&
      other.end.isSameOrBefore(this.end)
    );
  }

  /**
   * The calendar day this slot starts on, as a sortable `YYYY-MM-DD` key —
   * derived only from `ZonedDateTime`'s own `year`/`month`/`day`
   * accessors (see class doc, §7.1).
   */
  calendarDayKey(): string {
    return this.start.toISODate();
  }

  /** Whether this slot and `other` start on the same calendar day. */
  isSameCalendarDayAs(other: TimeSlot): boolean {
    return this.calendarDayKey() === other.calendarDayKey();
  }
}
