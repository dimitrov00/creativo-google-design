import type { LocationId } from '../entities/location.entity';
import { DayKey } from './day-key.data';
import { Result } from './result.data';
import { SchedulingError } from './scheduling-errors.data';
import type { Weekday } from './weekday.data';

const MINUTES_PER_DAY = 1440;

/**
 * One rostered stretch of a weekday at one shop, in wall-clock minutes —
 * `{ weekday, locationId, startMinutes, endMinutes }` (the barber is the
 * document id). A weekday may hold SEVERAL segments (the lunch break the old
 * one-range model could not express), sorted, never overlapping, and two
 * consecutive segments at different shops leave room to travel between them
 * (`weekly-pattern.ts`, `shift-segment.ts`).
 */
export type ShiftSegment = {
  readonly weekday: Weekday;
  readonly locationId: LocationId;
  readonly startMinutes: number;
  readonly endMinutes: number;
};

function isMinuteRange(startMinutes: number, endMinutes: number): boolean {
  return (
    Number.isInteger(startMinutes) &&
    Number.isInteger(endMinutes) &&
    startMinutes >= 0 &&
    startMinutes < endMinutes &&
    endMinutes <= MINUTES_PER_DAY
  );
}

export const ShiftSegment = {
  of(
    weekday: Weekday,
    locationId: LocationId,
    startMinutes: number,
    endMinutes: number,
  ): ShiftSegment {
    return { weekday, locationId, startMinutes, endMinutes };
  },

  durationMinutes(segment: ShiftSegment): number {
    return segment.endMinutes - segment.startMinutes;
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
   * a real `[start, end)` within the day (`scheduling.time_range.invalid`),
   * each shop named (`scheduling.shift_segment.invalid_location`); then, per
   * weekday in time order, no overlap (`scheduling.time_range.invalid`, on
   * the later segment) and at least `minTransferMinutes` between segments at
   * different shops (`scheduling.shift_segment.impossible_transfer`). A
   * weekday with a malformed segment is not judged for overlap. Returns the
   * segments sorted in week order.
   */
  validate(
    segments: readonly ShiftSegment[],
    minTransferMinutes: number,
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
      const gap = current.startMinutes - previous.endMinutes;
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
  weeklyMinutes(segments: readonly ShiftSegment[]): number {
    let total = 0;
    for (let i = 0; i < segments.length; i++) {
      total += ShiftSegment.durationMinutes(segments[i] as ShiftSegment);
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
 * `effectiveFromDayKey` through `effectiveToDayKey` (inclusive; `null` is
 * open-ended) — the stored `barberSchedules/{barberId}.versions[]` with the
 * `'HH:mm'` weekday map flattened to `segments` (`staff-schedule.ts:78-144`).
 *
 * The HISTORY is the point: amending from a future day must leave the old
 * pattern answering for old days, so booking, availability and capacity pick
 * the version in force on a date (`RosterSystem.versionFor`). Exactly one
 * version covers any day.
 */
export type ScheduleVersion = {
  readonly seq: number;
  readonly effectiveFromDayKey: DayKey;
  readonly effectiveToDayKey: DayKey | null;
  readonly segments: readonly ShiftSegment[];
};

/** The day before `dayKey`. */
function previousDay(dayKey: DayKey): DayKey {
  return DayKey.fromEpochDay(DayKey.toEpochDay(dayKey) - 1);
}

function byEffectiveFrom(a: ScheduleVersion, b: ScheduleVersion): number {
  return DayKey.compare(a.effectiveFromDayKey, b.effectiveFromDayKey);
}

export const ScheduleVersion = {
  /** Is `dayKey` within this version's span? Day keys compare as strings. */
  coversDay(version: ScheduleVersion, dayKey: DayKey): boolean {
    if (dayKey < version.effectiveFromDayKey) return false;
    return (
      version.effectiveToDayKey === null || dayKey <= version.effectiveToDayKey
    );
  },

  isOpenEnded(version: ScheduleVersion): boolean {
    return version.effectiveToDayKey === null;
  },

  /** The same version, ending on `lastDayKey`. */
  closedAt(version: ScheduleVersion, lastDayKey: DayKey): ScheduleVersion {
    return { ...version, effectiveToDayKey: lastDayKey };
  },

  /** A roster's first and only version, open-ended from `effectiveFromDayKey`. */
  startingWith(
    segments: readonly ShiftSegment[],
    effectiveFromDayKey: DayKey,
  ): readonly ScheduleVersion[] {
    return [{ seq: 0, effectiveFromDayKey, effectiveToDayKey: null, segments }];
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
        previous.effectiveToDayKey === null ||
        previous.effectiveToDayKey >= current.effectiveFromDayKey
      ) {
        return Result.err(
          SchedulingError.staffScheduleOverlappingVersions(
            previous.effectiveFromDayKey,
            current.effectiveFromDayKey,
          ),
        );
      }
    }
    return Result.ok(sorted);
  },

  /**
   * A new pattern from `effectiveFromDayKey` on: the version in force is
   * closed the day before and the new one appended open-ended with the next
   * `seq`. Refused when the new start is at or before the current version's
   * start — the past is changed by a schedule exception, never by rewriting
   * the roster it was worked under. `history` is sorted (see {@link history}).
   */
  amend(
    history: readonly ScheduleVersion[],
    segments: readonly ShiftSegment[],
    effectiveFromDayKey: DayKey,
  ): Result<readonly ScheduleVersion[], SchedulingError> {
    const last = history[history.length - 1];
    if (last === undefined) {
      return Result.ok(
        ScheduleVersion.startingWith(segments, effectiveFromDayKey),
      );
    }
    if (last.effectiveFromDayKey >= effectiveFromDayKey) {
      return Result.err(
        SchedulingError.staffScheduleRetroactiveAmendment(
          effectiveFromDayKey,
          last.effectiveFromDayKey,
        ),
      );
    }
    const amended: ScheduleVersion[] = history.slice(0, history.length - 1);
    amended.push(
      ScheduleVersion.closedAt(last, previousDay(effectiveFromDayKey)),
    );
    amended.push({
      seq: last.seq + 1,
      effectiveFromDayKey,
      effectiveToDayKey: null,
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
