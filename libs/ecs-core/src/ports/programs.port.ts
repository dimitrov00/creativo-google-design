import type { Observable } from 'rxjs';
import type {
  EnrollmentStatus,
  PositionStatus,
  ProgramImageCall,
} from '@core/components';
import type {
  Result,
  CourseId,
  EventId,
  PositionId,
  UtcEpochMs,
} from '@core/primitives';
import type { RepositoryError } from '@core/errors';
import type {
  Course,
  CourseBody,
  Position,
  PositionBody,
  ShopEvent,
  ShopEventBody,
} from '@core/entities';
import type { Callable } from './scheduling.port';

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

// ── Bodies ────────────────────────────────────────────────────────────────
// The description of a role, a course or an event — a sibling document
// under the same id, read ONCE when the thing is opened (never by a list)
// and saved whole, under the rules, by whoever may save the thing itself.

/** `positionBodies/{id}` — `null` for a role with no description. */
export type LoadPositionBody = (
  id: PositionId,
) => Promise<Result<PositionBody | null, RepositoryError>>;

/** Removes `positionBodies/{id}` — the thing has no description any more; removing none is no failure. */
export type ClearPositionBody = (
  id: PositionId,
) => Promise<Result<void, RepositoryError>>;

/** A full-document set of `{ body }`, never a merge. */
export type SavePositionBody = (
  body: PositionBody,
) => Promise<Result<void, RepositoryError>>;

/** `courseBodies/{id}` — `null` for a course with no description. */
export type LoadCourseBody = (
  id: CourseId,
) => Promise<Result<CourseBody | null, RepositoryError>>;

/** Removes `courseBodies/{id}` — the thing has no description any more; removing none is no failure. */
export type ClearCourseBody = (
  id: CourseId,
) => Promise<Result<void, RepositoryError>>;

/** A full-document set of `{ body }`, never a merge. */
export type SaveCourseBody = (
  body: CourseBody,
) => Promise<Result<void, RepositoryError>>;

/** `eventBodies/{id}` — `null` for an event with no description. */
export type LoadEventBody = (
  id: EventId,
) => Promise<Result<ShopEventBody | null, RepositoryError>>;

/** Removes `eventBodies/{id}` — the thing has no description any more; removing none is no failure. */
export type ClearEventBody = (
  id: EventId,
) => Promise<Result<void, RepositoryError>>;

/** A full-document set of `{ body }`, never a merge. */
export type SaveEventBody = (
  body: ShopEventBody,
) => Promise<Result<void, RepositoryError>>;

/**
 * `addProgramImage` — a picture for a description, taken from an upload
 * the caller staged under their own account; answers the id the
 * description names it by.
 */
export type AddProgramImage = Callable<
  ProgramImageCall.Add,
  ProgramImageCall.Added
>;

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

/** A role's description, read when the role is opened — `POSITION_BODY_READ_PORTS`. */
export type PositionBodyReadPorts = {
  readonly loadPositionBody: LoadPositionBody;
};

/** A role's description, saved whole or removed. */
export type PositionBodyWritePorts = {
  readonly savePositionBody: SavePositionBody;
  readonly clearPositionBody: ClearPositionBody;
};

/** A course's description, read when the course is opened. */
export type CourseBodyReadPorts = {
  readonly loadCourseBody: LoadCourseBody;
};

/** A course's description, saved whole or removed. */
export type CourseBodyWritePorts = {
  readonly saveCourseBody: SaveCourseBody;
  readonly clearCourseBody: ClearCourseBody;
};

/** An event's description, read when the event is opened. */
export type ShopEventBodyReadPorts = {
  readonly loadEventBody: LoadEventBody;
};

/** An event's description, saved whole or removed. */
export type ShopEventBodyWritePorts = {
  readonly saveEventBody: SaveEventBody;
  readonly clearEventBody: ClearEventBody;
};

/** The programs suite the admin page binds — `PROGRAMS_PORTS`. */
export type ProgramsPorts = PositionReadPorts &
  PositionWritePorts &
  PositionBodyReadPorts &
  PositionBodyWritePorts &
  CourseReadPorts &
  CourseWritePorts &
  ShopEventReadPorts &
  ShopEventWritePorts;

/** A description's picture upload — `PROGRAM_IMAGE_CALL_PORTS` (web). */
export type ProgramImageCallPorts = {
  readonly addProgramImage: AddProgramImage;
};
