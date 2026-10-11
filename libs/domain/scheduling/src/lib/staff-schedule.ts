import { Result, fail, ok } from '@creativo/domain/kernel';
import { LocationId } from '@creativo/domain/catalog';
import { CalendarDay } from './calendar-day';
import {
  OverlappingScheduleVersionsError,
  RetroactiveScheduleAmendmentError,
  type StaffScheduleError,
} from './staff-schedule.errors';
import { WeeklyPattern } from './weekly-pattern';
import { LocalDate, SchedulingErrorCode, defect } from '@core/primitives';
import { ScheduleVersion as VersionData } from '@core/components';
import { RosterSystem } from '@core/systems';

/*
 * THIN SHIM (ECS migration Phase 2). A version's span, the history's
 * no-overlap rule, the amendment and the version in force are the ECS
 * `ScheduleVersion` component and `RosterSystem.versionFor`. The classes
 * keep their legacy API (`CalendarDay`, `WeeklyPattern`) and only convert:
 * the pattern itself is not the span arithmetic's concern, so each struct
 * carries no segments and maps back to the legacy version it was made from.
 */

/** The legacy version each ECS struct was made from. */
const LEGACY_VERSIONS = new WeakMap<VersionData, StaffScheduleVersion>();

/** A `CalendarDay` → its shop day; a `CalendarDay` key is a valid date by construction. */
function localDateOf(day: CalendarDay): LocalDate {
  const parsed = LocalDate.parse(day.key());
  // Unreachable: `CalendarDay.create` already refused an impossible date.
  if (!parsed.ok) defect(`unreachable: a calendar day ${day.key()}`);
  return parsed.value;
}

function toVersionData(version: StaffScheduleVersion): VersionData {
  const data: VersionData = {
    seq: version.seq,
    effectiveFromLocalDate: localDateOf(version.effectiveFrom),
    effectiveToLocalDate:
      version.effectiveTo === null ? null : localDateOf(version.effectiveTo),
    segments: [],
  };
  LEGACY_VERSIONS.set(data, version);
  return data;
}

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
    return VersionData.coversDay(toVersionData(this), localDateOf(day));
  }

  isOpenEnded(): boolean {
    return VersionData.isOpenEnded(toVersionData(this));
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
    const history = VersionData.history(versions.map(toVersionData));
    if (!history.ok) {
      const error = history.error;
      return fail(
        error.errorCode === SchedulingErrorCode.StaffScheduleOverlappingVersions
          ? new OverlappingScheduleVersionsError(
              error.earlierFrom,
              error.laterFrom,
            )
          : new OverlappingScheduleVersionsError('', ''),
      );
    }
    return ok(
      new StaffScheduleHistory(
        history.value.map(
          (data) => LEGACY_VERSIONS.get(data) as StaffScheduleVersion,
        ),
      ),
    );
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
    const found = RosterSystem.versionFor(
      this.versions.map(toVersionData),
      localDateOf(day),
    );
    return found === null ? null : (LEGACY_VERSIONS.get(found) ?? null);
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
    const amended = VersionData.amend(
      this.versions.map(toVersionData),
      [],
      localDateOf(effectiveFrom),
    );
    if (!amended.ok) {
      const error = amended.error;
      return fail(
        error.errorCode ===
          SchedulingErrorCode.StaffScheduleRetroactiveAmendment
          ? new RetroactiveScheduleAmendmentError(
              error.attemptedFrom,
              error.currentFrom,
            )
          : new RetroactiveScheduleAmendmentError(effectiveFrom.key(), ''),
      );
    }
    const last = this.versions[this.versions.length - 1];
    return ok(
      new StaffScheduleHistory(
        amended.value.map((data) => {
          const kept = LEGACY_VERSIONS.get(data);
          if (kept !== undefined) return kept;
          // The version in force, closed the day before the new one starts…
          if (last !== undefined && data.seq === last.seq) {
            return last.closedAt(effectiveFrom.previous());
          }
          // …and the new one, open-ended.
          return StaffScheduleVersion.of({
            seq: data.seq,
            effectiveFrom,
            effectiveTo: null,
            pattern,
          });
        }),
      ),
    );
  }
}
