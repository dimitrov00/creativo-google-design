import type { Observable } from 'rxjs';
import type { EnrollmentStatus } from '../components/enrollment-status.data';
import type { PositionStatus } from '../components/program-status.data';
import type { RepositoryError } from '../components/repository-errors.data';
import type { Result } from '../components/result.data';
import type { Course } from '../entities/course.entity';
import type { ShopEvent } from '../entities/event.entity';
import type { Position } from '../entities/position.entity';
import type {
  CourseId,
  EventId,
  PositionId,
} from '../primitives/ids.primitive';
import type { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';

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
) => Promise<Result<Position | null, RepositoryError>>;

export type SavePosition = (
  position: Position,
) => Promise<Result<void, RepositoryError>>;

/**
 * Careers-page roles, live, `orderBy sortOrder` — `positionStatus ==` the
 * given status (index #12; the public page asks `PositionStatus.Open`), or
 * every role when `null` (the admin list).
 */
export type ObservePositions = (
  positionStatus: PositionStatus | null,
) => Observable<Result<readonly Position[], RepositoryError>>;

// ── Courses ───────────────────────────────────────────────────────────────

/** `courses/{id}` — `null` when absent. */
export type LoadCourse = (
  id: CourseId,
) => Promise<Result<Course | null, RepositoryError>>;

export type SaveCourse = (
  course: Course,
) => Promise<Result<void, RepositoryError>>;

/**
 * Courses, live, `orderBy sortOrder` — `enrollmentStatus in` the given
 * statuses (index #11; the public page asks open and upcoming), or every
 * course when `null` (the admin list).
 */
export type ObserveCourses = (
  statuses: readonly EnrollmentStatus[] | null,
) => Observable<Result<readonly Course[], RepositoryError>>;

// ── Events ────────────────────────────────────────────────────────────────

/** `events/{id}` — `null` when absent. */
export type LoadEvent = (
  id: EventId,
) => Promise<Result<ShopEvent | null, RepositoryError>>;

export type SaveEvent = (
  event: ShopEvent,
) => Promise<Result<void, RepositoryError>>;

/** Which side of an instant an events read covers. */
export type EventsQuery = {
  /** The instant splitting upcoming from past — the caller's injected clock. */
  readonly nowUtcMs: UtcEpochMs;
  /**
   * `true`: `utcEpochMs >= nowUtcMs`, soonest first, every one. `false`:
   * `utcEpochMs < nowUtcMs`, newest first, the latest 24
   * (`event-repository.adapter.ts:96-126`). A Firestore range on the
   * event's one absolute instant (Law 7), single-field either way.
   */
  readonly upcoming: boolean;
};

/** The shop's events on one side of `nowUtcMs`, live. */
export type ObserveEvents = (
  query: EventsQuery,
) => Observable<Result<readonly ShopEvent[], RepositoryError>>;

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
