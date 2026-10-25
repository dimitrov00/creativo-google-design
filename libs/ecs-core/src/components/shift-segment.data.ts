import {
  defect,
  MinuteCount,
  MinuteDelta,
  type LocationId,
  type EndMinute,
  MinuteOfDay,
  Result,
  type Weekday,
} from '@core/primitives';
import { SchedulingError } from '@core/errors';

const MINUTES_PER_DAY = 1440;

/**
 * One rostered stretch of a weekday at one shop, on the shop's wall clock —
 * `{ weekday, locationId, startMinutes, endMinutes }` (the barber is the
 * document id), an element of `ScheduleVersion.segments`. A weekday may hold
 * SEVERAL segments (the lunch break the old one-range model could not
 * express), sorted, never overlapping, and two consecutive segments at
 * different shops leave room to travel between them (`weekly-pattern.ts`,
 * `shift-segment.ts`). `endMinutes` may be the closing midnight, 1440.
 * Split out of `schedule-version.data.ts` (pass D, D-7).
 */
export type ShiftSegment = {
  readonly weekday: Weekday;
  readonly locationId: LocationId;
  readonly startMinutes: MinuteOfDay;
  readonly endMinutes: EndMinute;
};

/** A real, non-empty `[start, end)` inside one day. */
function isMinuteRange(startMinutes: number, endMinutes: number): boolean {
  return (
    Number.isInteger(startMinutes) &&
    Number.isInteger(endMinutes) &&
    startMinutes >= 0 &&
    startMinutes < endMinutes &&
    endMinutes <= MINUTES_PER_DAY
  );
}

/** The minutes between one segment's end and the next one's start (the two do not overlap). */
function gapBetween(
  previous: ShiftSegment,
  current: ShiftSegment,
): MinuteDelta {
  const from = MinuteOfDay.fromEnd(previous.endMinutes);
  // A segment ending at midnight has no later, non-overlapping neighbour.
  return from.ok
    ? MinuteDelta.between(from.value, current.startMinutes)
    : defect('ShiftSegment: a segment follows one that ends at midnight');
}

export const ShiftSegment = {
  of(
    weekday: Weekday,
    locationId: LocationId,
    startMinutes: MinuteOfDay,
    endMinutes: EndMinute,
  ): ShiftSegment {
    return { weekday, locationId, startMinutes, endMinutes };
  },

  durationMinutes(segment: ShiftSegment): MinuteCount {
    return MinuteCount.span(segment.startMinutes, segment.endMinutes);
  },

  /** Same weekday and overlapping minutes — half-open, so touching is not overlapping. */
  overlaps(a: ShiftSegment, b: ShiftSegment): boolean {
    return (
      a.weekday === b.weekday &&
      a.startMinutes < b.endMinutes &&
      b.startMinutes < a.endMinutes
    );
  },

  /** Week order: weekday, then start. */
  compare(a: ShiftSegment, b: ShiftSegment): number {
    return a.weekday - b.weekday || a.startMinutes - b.startMinutes;
  },

  /**
   * The edge guard for a week of segments, every refusal at once: each span
   * a real, non-empty `[start, end)` within the day
   * (`SCHEDULING_TIME_RANGE_INVALID`), each shop named
   * (`SCHEDULING_SHIFT_SEGMENT_INVALID_LOCATION`); then, per weekday in time
   * order, no overlap (`SCHEDULING_TIME_RANGE_INVALID`, on the later segment)
   * and at least `minTransferMinutes` between segments at different shops
   * (`SCHEDULING_SHIFT_SEGMENT_IMPOSSIBLE_TRANSFER`). A weekday with a
   * malformed segment is not judged for overlap. Returns the segments sorted
   * in week order.
   */
  validate(
    segments: readonly ShiftSegment[],
    minTransferMinutes: MinuteCount,
  ): Result<readonly ShiftSegment[], readonly SchedulingError[]> {
    const errors: SchedulingError[] = [];
    const malformedDays: number[] = [];
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i] as ShiftSegment;
      let bad = false;
      if (!isMinuteRange(segment.startMinutes, segment.endMinutes)) {
        errors.push(
          SchedulingError.timeRangeInvalid(
            segment.startMinutes,
            segment.endMinutes,
          ),
        );
        bad = true;
      }
      if (segment.locationId.trim().length === 0) {
        errors.push(
          SchedulingError.shiftSegmentInvalidLocation(segment.locationId),
        );
        bad = true;
      }
      if (bad && !malformedDays.includes(segment.weekday)) {
        malformedDays.push(segment.weekday);
      }
    }
    const sorted = [...segments].sort(ShiftSegment.compare);
    for (let i = 1; i < sorted.length; i++) {
      const previous = sorted[i - 1] as ShiftSegment;
      const current = sorted[i] as ShiftSegment;
      if (previous.weekday !== current.weekday) continue;
      if (malformedDays.includes(current.weekday)) continue;
      if (ShiftSegment.overlaps(previous, current)) {
        errors.push(
          SchedulingError.timeRangeInvalid(
            current.startMinutes,
            current.endMinutes,
          ),
        );
        continue;
      }
      if (previous.locationId === current.locationId) continue;
      const gap = gapBetween(previous, current);
      if (gap < minTransferMinutes) {
        errors.push(
          SchedulingError.shiftSegmentImpossibleTransfer(
            current.weekday,
            previous.locationId,
            current.locationId,
            gap,
            minTransferMinutes,
          ),
        );
      }
    }
    return errors.length > 0 ? Result.err(errors) : Result.ok(sorted);
  },

  /** A nominal week's rostered minutes. */
  weeklyMinutes(segments: readonly ShiftSegment[]): MinuteCount {
    let total = MinuteCount.ZERO;
    for (let i = 0; i < segments.length; i++) {
      total = MinuteCount.add(
        total,
        ShiftSegment.durationMinutes(segments[i] as ShiftSegment),
      );
    }
    return total;
  },

  /** Every shop the segments name, distinct, sorted. */
  locations(segments: readonly ShiftSegment[]): readonly LocationId[] {
    const seen: LocationId[] = [];
    for (let i = 0; i < segments.length; i++) {
      const locationId = (segments[i] as ShiftSegment).locationId;
      if (!seen.includes(locationId)) seen.push(locationId);
    }
    return seen.sort();
  },
} as const;
