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

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * Value object: a half-open interval `[start, end)` carried as
 * `ZonedDateTime` — the wall-clock-faithful shape for availability windows
 * and bookings. INVARIANT (enforced by `create`): `start` is strictly
 * before `end`.
 *
 * `calendarDayKey()` is the one place a calendar day is derived from this
 * slot, and it goes exclusively through the kernel `ZonedDateTime`
 * accessors (`.year`/`.month`/`.day`) — never a raw `Date` — per
 * migration-blueprint.md §7.1 (v2's `DateString.fromDate` used the
 * runtime-local timezone and could pick the wrong calendar day for a UTC
 * server/foreign device on an `Europe/Sofia` product).
 */
export class TimeSlot {
  private constructor(
    readonly start: ZonedDateTime,
    readonly end: ZonedDateTime,
  ) {}

  static create(props: TimeSlotProps): Result<TimeSlot, TimeSlotError> {
    const startResult = ZonedDateTime.fromISO(props.startIso, props.zone);
    if (startResult.isFailure()) {
      return fail(startResult.error);
    }
    const endResult = ZonedDateTime.fromISO(props.endIso, props.zone);
    if (endResult.isFailure()) {
      return fail(endResult.error);
    }
    if (!startResult.value.isBefore(endResult.value)) {
      return fail(new InvalidTimeSlotRangeError());
    }
    return ok(new TimeSlot(startResult.value, endResult.value));
  }

  /** Whether this slot and `other` share any instant. */
  overlaps(other: TimeSlot): boolean {
    return this.start.isBefore(other.end) && other.start.isBefore(this.end);
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
    return `${this.start.year}-${pad2(this.start.month)}-${pad2(this.start.day)}`;
  }

  /** Whether this slot and `other` start on the same calendar day. */
  isSameCalendarDayAs(other: TimeSlot): boolean {
    return this.calendarDayKey() === other.calendarDayKey();
  }
}
