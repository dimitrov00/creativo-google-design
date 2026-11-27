import {
  type Firestore,
  collection,
  deleteDoc,
  doc,
  limit,
  orderBy,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { of } from 'rxjs';
import {
  Collections,
  type Course,
  type CourseBody,
  type Position,
  type PositionBody,
  type ShopEvent,
  type ShopEventBody,
} from '@core/entities';
import type {
  CourseBodyReadPorts,
  CourseBodyWritePorts,
  CourseReadPorts,
  CourseWritePorts,
  PositionBodyReadPorts,
  PositionBodyWritePorts,
  PositionReadPorts,
  PositionWritePorts,
  ProgramsPorts,
  ShopEventBodyReadPorts,
  ShopEventBodyWritePorts,
  ShopEventReadPorts,
  ShopEventWritePorts,
} from '@core/ports';
import { Result } from '@core/primitives';
import { type RepositoryError } from '@core/errors';
import { attemptWrite, observeQuery, readDoc } from './observe';

/**
 * THE PROGRAMS CONTENT (flip 4, plan §3.7) — `positions`, `courses`,
 * `events`: the careers, courses and events pages and the admin page that
 * edits them. Public-read collections, written by a catalogue manager
 * straight from the browser under the rules (§9 D9(b): static content with
 * no invariant across documents, so no callable stands in between).
 *
 * Zero mapping (Law 5, F4-1 (b)): a body IS its entity minus `id`, every
 * read is `entityOf`, so a stored document is answered as stored — the
 * system validates on the way in (`ProgramsSystem`, through the
 * `program-content` pipelines), never this reader on the way out. A save is
 * ONE full-document `setDoc` of that body, never a merge: an edit replaces
 * every field the admin form owns.
 *
 * Every query names root keys only: roles `positionStatus ==` (index #12)
 * and courses `enrollmentStatus in` (index #11), both by `sortOrder`, the
 * admin lists unfiltered; events range on their one absolute instant,
 * `utcEpochMs` (a range on a stamp, never placement math — Law 7.3), served
 * by its automatic single-field index in either direction. On equal
 * `orderBy` values Firestore breaks the tie by document id in the direction
 * of the order, which the memory doubles of `@core/testing` copy.
 */

/**
 * How many past events one read answers. The Past tab is a highlight reel,
 * not an archive — and it is on a PUBLIC page, so an unbounded listener
 * re-billed every event the shop ever held to every visitor who opened it.
 */
const PAST_EVENTS_LIMIT = 24;

/** One full-document set of `entity` minus its id, at `path/{id}` — never a merge. */
function saveBody(
  db: Firestore,
  path: string,
  entity: { readonly id: string },
): Promise<Result<void, RepositoryError>> {
  const { id, ...body } = entity;
  const ref = doc(db, path, id);
  return attemptWrite(ref.path, () => setDoc(ref, body));
}

/** Removes `path/{id}` — removing a document that is not stored is no failure. */
function clearBody(
  db: Firestore,
  path: string,
  id: string,
): Promise<Result<void, RepositoryError>> {
  const ref = doc(db, path, id);
  return attemptWrite(ref.path, () => deleteDoc(ref));
}

/** The careers page's roles, live: one status (index #12) or, `null`, every role. */
export const positionReadPorts = (db: Firestore): PositionReadPorts => ({
  observePositions: (positionStatus) =>
    observeQuery<Position>(
      // unbounded-ok: open positions, which staff write by hand
      query(
        collection(db, Collections.Positions),
        ...(positionStatus === null
          ? []
          : [where('positionStatus', '==', positionStatus)]),
        orderBy('sortOrder'),
      ),
      Collections.Positions,
    ),
});

/** One role by id (`null` when absent) and its full-document save. */
export const positionWritePorts = (db: Firestore): PositionWritePorts => ({
  loadPosition: (id) => readDoc<Position>(doc(db, Collections.Positions, id)),
  savePosition: (position) => saveBody(db, Collections.Positions, position),
});

/**
 * The courses page's courses, live: the given statuses (index #11) or,
 * `null`, every course. No status asked is no course — Firestore refuses an
 * empty `in`, so nothing is read.
 */
export const courseReadPorts = (db: Firestore): CourseReadPorts => ({
  observeCourses: (statuses) =>
    statuses !== null && statuses.length === 0
      ? of(Result.ok<readonly Course[]>([]))
      : observeQuery<Course>(
          // unbounded-ok: courses, which staff write by hand
          query(
            collection(db, Collections.Courses),
            ...(statuses === null
              ? []
              : [where('enrollmentStatus', 'in', statuses)]),
            orderBy('sortOrder'),
          ),
          Collections.Courses,
        ),
});

/** One course by id (`null` when absent) and its full-document save. */
export const courseWritePorts = (db: Firestore): CourseWritePorts => ({
  loadCourse: (id) => readDoc<Course>(doc(db, Collections.Courses, id)),
  saveCourse: (course) => saveBody(db, Collections.Courses, course),
});

/**
 * The events page's events on one side of `nowUtcMs`, live — upcoming:
 * `utcEpochMs >= now`, soonest first, every one; past: `utcEpochMs < now`,
 * latest first, the latest {@link PAST_EVENTS_LIMIT}.
 */
export const shopEventReadPorts = (db: Firestore): ShopEventReadPorts => ({
  observeEvents: ({ nowUtcMs, upcoming }) =>
    observeQuery<ShopEvent>(
      upcoming
        ? // unbounded-ok: upcoming events, which staff write by hand: past ones leave the range
          query(
            collection(db, Collections.Events),
            where('utcEpochMs', '>=', nowUtcMs),
            orderBy('utcEpochMs', 'asc'),
          )
        : query(
            collection(db, Collections.Events),
            where('utcEpochMs', '<', nowUtcMs),
            orderBy('utcEpochMs', 'desc'),
            limit(PAST_EVENTS_LIMIT),
          ),
      Collections.Events,
    ),
});

/** One event by id (`null` when absent) and its full-document save. */
export const shopEventWritePorts = (db: Firestore): ShopEventWritePorts => ({
  loadEvent: (id) => readDoc<ShopEvent>(doc(db, Collections.Events, id)),
  saveEvent: (event) => saveBody(db, Collections.Events, event),
});

// ── Bodies ────────────────────────────────────────────────────────────────
// `positionBodies`, `courseBodies`, `eventBodies` — a thing's description, a
// sibling document under the thing's own id: `{ body }`, Markdown per
// language. One `getDoc` when the thing is opened (`null` for none), one
// full-document `setDoc` on a save — the same zero mapping as above.

/** A role's description (`null` when it has none) — `POSITION_BODY_READ_PORTS`. */
export const positionBodyReadPorts = (
  db: Firestore,
): PositionBodyReadPorts => ({
  loadPositionBody: (id) =>
    readDoc<PositionBody>(doc(db, Collections.PositionBodies, id)),
});

/** A role's description, saved whole. */
export const positionBodyWritePorts = (
  db: Firestore,
): PositionBodyWritePorts => ({
  savePositionBody: (body) => saveBody(db, Collections.PositionBodies, body),
  clearPositionBody: (id) => clearBody(db, Collections.PositionBodies, id),
});

/** A course's description (`null` when it has none). */
export const courseBodyReadPorts = (db: Firestore): CourseBodyReadPorts => ({
  loadCourseBody: (id) =>
    readDoc<CourseBody>(doc(db, Collections.CourseBodies, id)),
});

/** A course's description, saved whole. */
export const courseBodyWritePorts = (db: Firestore): CourseBodyWritePorts => ({
  saveCourseBody: (body) => saveBody(db, Collections.CourseBodies, body),
  clearCourseBody: (id) => clearBody(db, Collections.CourseBodies, id),
});

/** An event's description (`null` when it has none). */
export const shopEventBodyReadPorts = (
  db: Firestore,
): ShopEventBodyReadPorts => ({
  loadEventBody: (id) =>
    readDoc<ShopEventBody>(doc(db, Collections.EventBodies, id)),
});

/** An event's description, saved whole. */
export const shopEventBodyWritePorts = (
  db: Firestore,
): ShopEventBodyWritePorts => ({
  saveEventBody: (body) => saveBody(db, Collections.EventBodies, body),
  clearEventBody: (id) => clearBody(db, Collections.EventBodies, id),
});

/** `PROGRAMS_PORTS` — the admin page's suite: the eight bundles (a role's description among them) over one instance. */
export const programsPorts = (db: Firestore): ProgramsPorts => ({
  ...positionReadPorts(db),
  ...positionWritePorts(db),
  ...positionBodyReadPorts(db),
  ...positionBodyWritePorts(db),
  ...courseReadPorts(db),
  ...courseWritePorts(db),
  ...shopEventReadPorts(db),
  ...shopEventWritePorts(db),
});
