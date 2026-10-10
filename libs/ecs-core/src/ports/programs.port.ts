import type { Observable } from 'rxjs';
import type { EnrollmentStatus } from '../components/enrollment-status.data';
import type { PositionState } from '../components/program-status.data';
import type { RepositoryError } from '../components/repository-errors.data';
import type { Result } from '../components/result.data';
import type { CourseEntity, CourseId } from '../entities/course.entity';
import type { EventEntity, EventId } from '../entities/event.entity';
import type { PositionEntity, PositionId } from '../entities/position.entity';

/**
 * The shop's programs content — `positions`, `courses`, `events` (blueprint
 * §4.2). Under §9 D9(b) this is a rules-guarded ADMIN write (static content
 * with no invariants), so `Save*` is a direct document `Set` here, not a
 * callable. Successor of `PositionRepository`, `CourseRepository` and
 * `ShopEventRepository`.
 */

// ── Positions ─────────────────────────────────────────────────────────────

/** `positions/{id}` — `null` when absent. */
export type LoadPosition = (
  id: PositionId,
) => Promise<Result<PositionEntity | null, RepositoryError>>;

export type SavePosition = (
  position: PositionEntity,
) => Promise<Result<void, RepositoryError>>;

/**
 * Careers-page roles, live, `orderBy sortOrder` — `status ==` the given
 * state (index #12; the public page asks `PositionState.Open`), or every
 * role when `null` (the admin list).
 */
export type ObservePositions = (
  status: PositionState | null,
) => Observable<Result<readonly PositionEntity[], RepositoryError>>;

// ── Courses ───────────────────────────────────────────────────────────────

/** `courses/{id}` — `null` when absent. */
export type LoadCourse = (
  id: CourseId,
) => Promise<Result<CourseEntity | null, RepositoryError>>;

export type SaveCourse = (
  course: CourseEntity,
) => Promise<Result<void, RepositoryError>>;

/**
 * Courses, live, `orderBy sortOrder` — `enrollmentStatus in` the given
 * statuses (index #11; the public page asks open and upcoming), or every
 * course when `null` (the admin list).
 */
export type ObserveCourses = (
  statuses: readonly EnrollmentStatus[] | null,
) => Observable<Result<readonly CourseEntity[], RepositoryError>>;

// ── Events ────────────────────────────────────────────────────────────────

/** `events/{id}` — `null` when absent. */
export type LoadEvent = (
  id: EventId,
) => Promise<Result<EventEntity | null, RepositoryError>>;

export type SaveEvent = (
  event: EventEntity,
) => Promise<Result<void, RepositoryError>>;

/** Which side of an instant an events read covers. */
export type EventsQuery = {
  /** The instant splitting upcoming from past — the caller's injected clock. */
  readonly nowMs: number;
  /**
   * `true`: `startMs >= nowMs`, soonest first, every one. `false`:
   * `startMs < nowMs`, newest first, the latest 24
   * (`event-repository.adapter.ts:96-126`). Single-field either way.
   */
  readonly upcoming: boolean;
};

/** The shop's events on one side of `nowMs`, live. */
export type ObserveEvents = (
  query: EventsQuery,
) => Observable<Result<readonly EventEntity[], RepositoryError>>;

/** The programs bundle the web binds. */
export type ProgramsPorts = {
  readonly loadPosition: LoadPosition;
  readonly savePosition: SavePosition;
  readonly observePositions: ObservePositions;
  readonly loadCourse: LoadCourse;
  readonly saveCourse: SaveCourse;
  readonly observeCourses: ObserveCourses;
  readonly loadEvent: LoadEvent;
  readonly saveEvent: SaveEvent;
  readonly observeEvents: ObserveEvents;
};
