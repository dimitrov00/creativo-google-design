import type { Observable } from 'rxjs';
import type { EnrollmentStatus, PositionStatus } from '@core/components';
import type {
  RepositoryError,
  Result,
  CourseId,
  EventId,
  PositionId,
  UtcEpochMs,
} from '@core/primitives';
import type { Course, ShopEvent, Position } from '@core/entities';

/**
 * The shop's programs content — `positions`, `courses`, `events` (blueprint
 * §4.2). Under §9 D9(b) this is a rules-guarded ADMIN write (static content
 * with no invariants), so `Save*` is a direct document set from the browser
 * pipeline (`program-content.pipeline.ts`), not a callable. Every body is the
 * flat entity minus `id` (Law 5), answered as stored.
 */

// ── Positions ─────────────────────────────────────────────────────────────

/** `positions/{id}` — `null` when absent. */
export type LoadPosition = (
  id: PositionId,
) => Promise<Result<Position | null, RepositoryError>>;

/** A full-document set of the body (the entity minus `id`), never a merge. */
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

/** A full-document set of the body (the entity minus `id`), never a merge. */
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

/** A full-document set of the body (the entity minus `id`), never a merge. */
export type SaveEvent = (
  event: ShopEvent,
) => Promise<Result<void, RepositoryError>>;

/** Which side of an instant an events read covers. */
export type EventsQuery = {
  /** The instant splitting upcoming from past — the caller's injected clock, read once per subscription. */
  readonly nowUtcMs: UtcEpochMs;
  /**
   * `true`: `utcEpochMs >= nowUtcMs`, `utcEpochMs` ascending, every one.
   * `false`: `utcEpochMs < nowUtcMs`, `utcEpochMs` descending, the latest
   * 24. A Firestore range on the event's one absolute instant (Law 7: a
   * range on a stamp, never placement math), served by its automatic
   * single-field index either way. Ties on `utcEpochMs` fall to the
   * document id in the direction of the order.
   */
  readonly upcoming: boolean;
};

/** The shop's events on one side of `nowUtcMs`, live. */
export type ObserveEvents = (
  query: EventsQuery,
) => Observable<Result<readonly ShopEvent[], RepositoryError>>;

// ── Focused bundles (Law 9 — composed with `&`, never sliced) ─────────────

/** The careers page's roles, live — `POSITION_READ_PORTS`. */
export type PositionReadPorts = {
  readonly observePositions: ObservePositions;
};

/** One role by id and its full-document save — the admin page's write. */
export type PositionWritePorts = {
  readonly loadPosition: LoadPosition;
  readonly savePosition: SavePosition;
};

/** The courses page's courses, live — `COURSE_READ_PORTS`. */
export type CourseReadPorts = {
  readonly observeCourses: ObserveCourses;
};

/** One course by id and its full-document save — the admin page's write. */
export type CourseWritePorts = {
  readonly loadCourse: LoadCourse;
  readonly saveCourse: SaveCourse;
};

/** The events page's events on one side of now, live — `SHOP_EVENT_READ_PORTS`. */
export type ShopEventReadPorts = {
  readonly observeEvents: ObserveEvents;
};

/** One event by id and its full-document save — the admin page's write. */
export type ShopEventWritePorts = {
  readonly loadEvent: LoadEvent;
  readonly saveEvent: SaveEvent;
};

/** The programs suite the admin page binds — `PROGRAMS_PORTS`. */
export type ProgramsPorts = PositionReadPorts &
  PositionWritePorts &
  CourseReadPorts &
  CourseWritePorts &
  ShopEventReadPorts &
  ShopEventWritePorts;
