import { Result, fail, ok } from '@creativo/domain/kernel';
import { LocationId } from '@creativo/domain/catalog';
import { CalendarDay } from './calendar-day';
import {
  OverlappingScheduleVersionsError,
  RetroactiveScheduleAmendmentError,
  type StaffScheduleError,
} from './staff-schedule.errors';
import { WeeklyPattern } from './weekly-pattern';

export interface StaffScheduleVersionProps {
  /** Monotonic, 0-based. Never reused, never renumbered. */
  readonly seq: number;
  readonly effectiveFrom: CalendarDay;
  /** `null` ⇒ in force indefinitely. Inclusive when set. */
  readonly effectiveTo: CalendarDay | null;
  readonly pattern: WeeklyPattern;
}

/**
 * One period during which a barber's weekly pattern held.
 *
 * **Immutable, and that is the whole point.** Every hours-denominated
 * statistic — utilisation above all — divides by the minutes a barber was
 * rostered for. If changing today's shift could rewrite what last March's
 * pattern said, then every historical utilisation figure would silently
 * restate, with no error and no audit trail: the numbers would simply become
 * different ones. Versioning the pattern instead of mutating it is what makes
 * "what were Ivan's hours in March" answerable forever.
 */
export class StaffScheduleVersion {
  private constructor(
    readonly seq: number,
    readonly effectiveFrom: CalendarDay,
    readonly effectiveTo: CalendarDay | null,
    readonly pattern: WeeklyPattern,
  ) {}

  static of(props: StaffScheduleVersionProps): StaffScheduleVersion {
    return new StaffScheduleVersion(
      props.seq,
      props.effectiveFrom,
      props.effectiveTo,
      props.pattern,
    );
  }

  coversDay(day: CalendarDay): boolean {
    if (day.isBefore(this.effectiveFrom)) return false;
    if (this.effectiveTo === null) return true;
    return !this.effectiveTo.isBefore(day);
  }

  isOpenEnded(): boolean {
    return this.effectiveTo === null;
  }

  /** A copy closed at `lastDay` — how a version retires when a new one starts. */
  closedAt(lastDay: CalendarDay): StaffScheduleVersion {
    return new StaffScheduleVersion(
      this.seq,
      this.effectiveFrom,
      lastDay,
      this.pattern,
    );
  }
}

/**
 * The full, append-only history of one barber's rosters.
 *
 * **No `locationId` here.** The first pass pinned one to the whole history,
 * which made a barber a permanent fixture of a single chair — so a barber who
 * covers Center on Monday and Mladost on Tuesday, or both in one day, was
 * unrepresentable. The location lives on each {@link ShiftSegment} instead;
 * ask the pattern (`locations()`, `worksAt()`) where a barber works.
 *
 * INVARIANT: versions never overlap, and exactly one is in force on any day
 * they cover. `versionFor` is therefore total in the only sense that matters
 * — it returns at most one answer, never two.
 */
export class StaffScheduleHistory {
  private constructor(
    private readonly versions: readonly StaffScheduleVersion[],
  ) {}

  static create(
    versions: readonly StaffScheduleVersion[],
  ): Result<StaffScheduleHistory, StaffScheduleError> {
    const sorted = versions
      .slice()
      .sort((a, b) => (a.effectiveFrom.isBefore(b.effectiveFrom) ? -1 : 1));

    for (let i = 1; i < sorted.length; i++) {
      const previous = sorted[i - 1] as StaffScheduleVersion;
      const current = sorted[i] as StaffScheduleVersion;
      // An open-ended earlier version, or one whose end reaches the next
      // start, means two patterns claim the same day.
      if (
        previous.effectiveTo === null ||
        !previous.effectiveTo.isBefore(current.effectiveFrom)
      ) {
        return fail(
          new OverlappingScheduleVersionsError(
            previous.effectiveFrom.key(),
            current.effectiveFrom.key(),
          ),
        );
      }
    }
    return ok(new StaffScheduleHistory(sorted));
  }

  static startingWith(
    pattern: WeeklyPattern,
    effectiveFrom: CalendarDay,
  ): StaffScheduleHistory {
    return new StaffScheduleHistory([
      StaffScheduleVersion.of({
        seq: 0,
        effectiveFrom,
        effectiveTo: null,
        pattern,
      }),
    ]);
  }

  /** Every shop any version touches — "which shops does this barber cover?". */
  locations(): readonly LocationId[] {
    const seen = new Map<string, LocationId>();
    for (const version of this.versions) {
      for (const locationId of version.pattern.locations()) {
        seen.set(locationId.value, locationId);
      }
    }
    return [...seen.values()].sort((a, b) => a.value.localeCompare(b.value));
  }

  all(): readonly StaffScheduleVersion[] {
    return this.versions;
  }

  /** The pattern in force on `day`, or `null` before the first version began. */
  versionFor(day: CalendarDay): StaffScheduleVersion | null {
    return this.versions.find((version) => version.coversDay(day)) ?? null;
  }

  /**
   * Change the roster from `effectiveFrom` onward: close whatever is in force
   * the day before, and append a new version.
   *
   * **Refuses to amend the past.** `effectiveFrom` must be strictly after the
   * last version's start — a "correction" that reaches backwards is exactly
   * the silent restatement this whole type exists to prevent. Real historical
   * corrections belong in a `ScheduleException` for the specific days, which
   * is explicit, dated and auditable.
   */
  amend(
    pattern: WeeklyPattern,
    effectiveFrom: CalendarDay,
  ): Result<StaffScheduleHistory, StaffScheduleError> {
    const last = this.versions[this.versions.length - 1];
    if (last && !last.effectiveFrom.isBefore(effectiveFrom)) {
      return fail(
        new RetroactiveScheduleAmendmentError(
          effectiveFrom.key(),
          last.effectiveFrom.key(),
        ),
      );
    }

    const closed = last ? [last.closedAt(effectiveFrom.previous())] : [];
    const kept = this.versions.slice(0, Math.max(0, this.versions.length - 1));
    return ok(
      new StaffScheduleHistory([
        ...kept,
        ...closed,
        StaffScheduleVersion.of({
          seq: (last?.seq ?? -1) + 1,
          effectiveFrom,
          effectiveTo: null,
          pattern,
        }),
      ]),
    );
  }
}
