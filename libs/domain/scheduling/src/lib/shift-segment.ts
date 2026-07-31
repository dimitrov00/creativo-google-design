import { Result, fail, ok } from '@creativo/domain/kernel';
import { LocationId } from '@creativo/domain/catalog';
import { LocalTimeRange } from './local-time-of-day';
import type { LocalTimeError } from './local-time-of-day.errors';
import { InvalidShiftSegmentError } from './shift-segment.errors';

export interface ShiftSegmentProps {
  readonly start: string;
  readonly end: string;
  readonly locationId: string;
}

/**
 * One continuous stretch of a barber's rostered week, **at one shop**.
 *
 * ### Why the location rides here and not on the schedule
 * The first pass pinned one `locationId` to the whole `StaffScheduleHistory`,
 * which made a barber a fixture of a single chair forever. That is not how a
 * barbershop works. A barber covers Center on Monday and Mladost on Tuesday;
 * one who covers Center in the morning and Mladost in the afternoon is
 * ordinary, not exotic. The location is a property of the SHIFT, so it belongs
 * on the segment — which is also the granularity utilisation has to be
 * attributed at, because each shop's capacity is its own number.
 *
 * `RosterWindow` already carried `locationId` per window in anticipation of
 * this; the pattern simply had no way to say it.
 *
 * A segment is a claim about clock faces plus a place, carrying no date and no
 * zone — which is what lets it stay true across a DST transition. The dates
 * arrive when a specific day materialises it.
 */
export class ShiftSegment {
  private constructor(
    readonly range: LocalTimeRange,
    readonly locationId: LocationId,
  ) {}

  static of(range: LocalTimeRange, locationId: LocationId): ShiftSegment {
    return new ShiftSegment(range, locationId);
  }

  static create(
    props: ShiftSegmentProps,
  ): Result<ShiftSegment, LocalTimeError | InvalidShiftSegmentError> {
    const range = LocalTimeRange.create(props.start, props.end);
    if (range.isFailure()) return fail(range.error);

    const locationId = LocationId.create(props.locationId);
    if (locationId.isFailure()) {
      return fail(new InvalidShiftSegmentError(props.locationId));
    }
    return ok(new ShiftSegment(range.value, locationId.value));
  }

  get start() {
    return this.range.start;
  }

  get end() {
    return this.range.end;
  }

  durationMinutes(): number {
    return this.range.durationMinutes();
  }

  /**
   * Half-open, so `09:00–13:00` and `13:00–17:00` do not overlap — and that
   * matters most across locations: back-to-back segments at two shops are
   * legal as geometry, and it is the TRANSFER rule (not this one) that decides
   * whether a barber can physically make it.
   */
  overlaps(other: ShiftSegment): boolean {
    return this.range.overlaps(other.range);
  }

  atSameLocationAs(other: ShiftSegment): boolean {
    return this.locationId.equals(other.locationId);
  }

  toProps(): ShiftSegmentProps {
    return {
      start: this.range.start.toString(),
      end: this.range.end.toString(),
      locationId: this.locationId.value,
    };
  }

  toString(): string {
    return `${this.range.toString()} @ ${this.locationId.value}`;
  }
}
