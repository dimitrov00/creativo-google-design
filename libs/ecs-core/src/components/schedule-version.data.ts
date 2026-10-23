import {
  defect,
  MinuteCount,
  MinuteDelta,
  type LocationId,
  LocalDate,
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

/**
 * One version of a barber's weekly roster, in force from
 * `effectiveFromLocalDate` through `effectiveToLocalDate` (inclusive; `null`
 * is open-ended) — an element of the stored `barberSchedules/{barberId}
 * .versions[]` with the `'HH:mm'` weekday map flattened to `segments`
 * (`staff-schedule.ts:78-144`).
 *
 * The HISTORY is the point: amending from a future day must leave the old
 * pattern answering for old days, so booking, availability and capacity pick
 * the version in force on a shop day (`RosterSystem.versionFor`). Exactly
 * one version covers any day.
 */
export type ScheduleVersion = {
  readonly seq: number;
  readonly effectiveFromLocalDate: LocalDate;
  readonly effectiveToLocalDate: LocalDate | null;
  readonly segments: readonly ShiftSegment[];
};

function byEffectiveFrom(a: ScheduleVersion, b: ScheduleVersion): number {
  return LocalDate.compare(a.effectiveFromLocalDate, b.effectiveFromLocalDate);
}

export const ScheduleVersion = {
  /** Is `localDate` within this version's span? Days compare as strings. */
  coversDay(version: ScheduleVersion, localDate: LocalDate): boolean {
    if (localDate < version.effectiveFromLocalDate) return false;
    return (
      version.effectiveToLocalDate === null ||
      localDate <= version.effectiveToLocalDate
    );
  },

  isOpenEnded(version: ScheduleVersion): boolean {
    return version.effectiveToLocalDate === null;
  },

  /** The same version, ending on `lastLocalDate`. */
  closedAt(
    version: ScheduleVersion,
    lastLocalDate: LocalDate,
  ): ScheduleVersion {
    return { ...version, effectiveToLocalDate: lastLocalDate };
  },

  /** A roster's first and only version, open-ended from `effectiveFromLocalDate`. */
  startingWith(
    segments: readonly ShiftSegment[],
    effectiveFromLocalDate: LocalDate,
  ): readonly ScheduleVersion[] {
    return [
      {
        seq: 0,
        effectiveFromLocalDate,
        effectiveToLocalDate: null,
        segments,
      },
    ];
  },

  /**
   * The edge guard for a stored history: sorted by start, and refused when
   * two versions claim one day — an open-ended version followed by another,
   * or one whose end reaches the next one's start.
   */
  history(
    versions: readonly ScheduleVersion[],
  ): Result<readonly ScheduleVersion[], SchedulingError> {
    const sorted = [...versions].sort(byEffectiveFrom);
    for (let i = 1; i < sorted.length; i++) {
      const previous = sorted[i - 1] as ScheduleVersion;
      const current = sorted[i] as ScheduleVersion;
      if (
        previous.effectiveToLocalDate === null ||
        previous.effectiveToLocalDate >= current.effectiveFromLocalDate
      ) {
        return Result.err(
          SchedulingError.staffScheduleOverlappingVersions(
            previous.effectiveFromLocalDate,
            current.effectiveFromLocalDate,
          ),
        );
      }
    }
    return Result.ok(sorted);
  },

  /**
   * A new pattern from `effectiveFromLocalDate` on: the version in force is
   * closed the day before and the new one appended open-ended with the next
   * `seq`. Refused when the new start is at or before the current version's
   * start — the past is changed by a schedule exception, never by rewriting
   * the roster it was worked under. `history` is sorted (see {@link history}).
   */
  amend(
    history: readonly ScheduleVersion[],
    segments: readonly ShiftSegment[],
    effectiveFromLocalDate: LocalDate,
  ): Result<readonly ScheduleVersion[], SchedulingError> {
    const last = history[history.length - 1];
    if (last === undefined) {
      return Result.ok(
        ScheduleVersion.startingWith(segments, effectiveFromLocalDate),
      );
    }
    if (last.effectiveFromLocalDate >= effectiveFromLocalDate) {
      return Result.err(
        SchedulingError.staffScheduleRetroactiveAmendment(
          effectiveFromLocalDate,
          last.effectiveFromLocalDate,
        ),
      );
    }
    const amended: ScheduleVersion[] = history.slice(0, history.length - 1);
    amended.push(
      ScheduleVersion.closedAt(
        last,
        LocalDate.addDays(effectiveFromLocalDate, -1),
      ),
    );
    amended.push({
      seq: last.seq + 1,
      effectiveFromLocalDate,
      effectiveToLocalDate: null,
      segments,
    });
    return Result.ok(amended);
  },

  /** Every shop any version rosters the barber at, distinct, sorted. */
  locations(versions: readonly ScheduleVersion[]): readonly LocationId[] {
    const seen: LocationId[] = [];
    for (let i = 0; i < versions.length; i++) {
      const own = ShiftSegment.locations(
        (versions[i] as ScheduleVersion).segments,
      );
      for (let k = 0; k < own.length; k++) {
        const locationId = own[k] as LocationId;
        if (!seen.includes(locationId)) seen.push(locationId);
      }
    }
    return seen.sort();
  },
} as const;
