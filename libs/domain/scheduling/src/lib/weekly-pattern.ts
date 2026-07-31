import { Result, fail, ok } from '@creativo/domain/kernel';
import { LocationId } from '@creativo/domain/catalog';
import {
  type LocalTimeError,
  InvalidLocalTimeRangeError,
} from './local-time-of-day.errors';
import { ShiftSegment, type ShiftSegmentProps } from './shift-segment';
import {
  ImpossibleTransferError,
  type InvalidShiftSegmentError,
} from './shift-segment.errors';
import { WEEKDAYS, type Weekday } from './weekday';

export interface WeeklyPatternProps {
  /** Absent or empty ⇒ that weekday is not worked. */
  readonly byWeekday: Partial<Record<Weekday, readonly ShiftSegmentProps[]>>;
}

export type WeeklyPatternError =
  LocalTimeError | InvalidShiftSegmentError | ImpossibleTransferError;

/**
 * A recurring weekly roster — **replaces `WorkingHours`**, which could hold
 * only ONE range per weekday and therefore could not express a lunch break,
 * a split shift, or a barber who comes in for two hours on a Sunday morning.
 * Nothing in the product ever constructed it.
 *
 * Each weekday holds an ordered, non-overlapping list of {@link ShiftSegment}s
 * — each carrying **its own location**, because a barber covers Center on
 * Monday and Mladost on Tuesday, and may cover both in one day. Overlapping
 * segments are REJECTED rather than merged: nobody is in two places at once,
 * and merging would hide the authoring mistake while quietly changing what the
 * barber is rostered for.
 *
 * A pattern carries no dates and no zone. It is a claim about clock faces and
 * places, which is what lets it stay true across a DST transition; the dates
 * arrive when a specific day materialises it.
 */
export class WeeklyPattern {
  private constructor(
    private readonly byWeekday: ReadonlyMap<Weekday, readonly ShiftSegment[]>,
  ) {}

  /**
   * @param minTransferMinutes Minutes a barber needs to get from one shop to
   * another. Two segments at DIFFERENT locations closer than this are refused
   * — a roster nobody can work is an authoring mistake, and trimming it
   * silently would shrink the grid for a reason no one can see. `0` disables
   * the check, which is right for a single-shop tenant.
   */
  static create(
    props: WeeklyPatternProps,
    minTransferMinutes = 0,
  ): Result<WeeklyPattern, WeeklyPatternError[]> {
    const errors: WeeklyPatternError[] = [];
    const byWeekday = new Map<Weekday, readonly ShiftSegment[]>();

    for (const weekday of WEEKDAYS) {
      // `weekday` is always one of the seven hardcoded literals, never
      // external input — safe despite the object-injection heuristic.
      // eslint-disable-next-line security/detect-object-injection
      const raw = props.byWeekday[weekday];
      if (raw === undefined || raw.length === 0) continue;

      const segments: ShiftSegment[] = [];
      for (const entry of raw) {
        const segment = ShiftSegment.create(entry);
        if (segment.isFailure()) {
          errors.push(segment.error);
          continue;
        }
        segments.push(segment.value);
      }
      if (segments.length !== raw.length) continue;

      segments.sort(
        (a, b) => a.start.minutesFromMidnight() - b.start.minutesFromMidnight(),
      );

      const invalid = WeeklyPattern.validateDay(segments, minTransferMinutes);
      if (invalid) {
        errors.push(invalid);
        continue;
      }
      byWeekday.set(weekday, segments);
    }

    if (errors.length > 0) return fail(errors);
    return ok(new WeeklyPattern(byWeekday));
  }

  /** The first thing wrong with one day's sorted segments, or `null`. */
  private static validateDay(
    segments: readonly ShiftSegment[],
    minTransferMinutes: number,
  ): WeeklyPatternError | null {
    for (let index = 1; index < segments.length; index++) {
      const previous = segments[index - 1] as ShiftSegment;
      const current = segments[index] as ShiftSegment;

      if (previous.overlaps(current)) {
        return new InvalidLocalTimeRangeError(
          current.start.toString(),
          current.end.toString(),
        );
      }

      if (previous.atSameLocationAs(current)) continue;

      const gap =
        current.start.minutesFromMidnight() -
        previous.end.minutesFromMidnight();
      if (gap < minTransferMinutes) {
        return new ImpossibleTransferError(
          previous.toString(),
          current.toString(),
          minTransferMinutes,
        );
      }
    }
    return null;
  }

  /** Nothing worked, any day — a barber on indefinite leave, or a new hire. */
  static empty(): WeeklyPattern {
    return new WeeklyPattern(new Map());
  }

  /** Ordered, non-overlapping segments for that weekday. Empty ⇒ not worked. */
  segmentsOn(weekday: Weekday): readonly ShiftSegment[] {
    return this.byWeekday.get(weekday) ?? [];
  }

  worksOn(weekday: Weekday): boolean {
    return this.segmentsOn(weekday).length > 0;
  }

  /** Every shop this pattern touches — what "where does this barber work" means. */
  locations(): readonly LocationId[] {
    const seen = new Map<string, LocationId>();
    for (const segments of this.byWeekday.values()) {
      for (const segment of segments) {
        seen.set(segment.locationId.value, segment.locationId);
      }
    }
    return [...seen.values()].sort((a, b) => a.value.localeCompare(b.value));
  }

  worksAt(locationId: LocationId): boolean {
    return this.locations().some((candidate) => candidate.equals(locationId));
  }

  /** Rostered minutes in a nominal week — the pattern's own shape, not a real week's. */
  weeklyMinutes(): number {
    let total = 0;
    for (const segments of this.byWeekday.values()) {
      for (const segment of segments) total += segment.durationMinutes();
    }
    return total;
  }

  toProps(): WeeklyPatternProps {
    const byWeekday: Partial<Record<Weekday, readonly ShiftSegmentProps[]>> =
      {};
    for (const [weekday, segments] of this.byWeekday) {
      // eslint-disable-next-line security/detect-object-injection -- own Map keys.
      byWeekday[weekday] = segments.map((segment) => segment.toProps());
    }
    return { byWeekday };
  }
}
