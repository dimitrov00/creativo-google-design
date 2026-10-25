import { type LocationId, LocalDate, Result } from '@core/primitives';
import { SchedulingError } from '@core/errors';
import { ShiftSegment } from './shift-segment.data';

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
