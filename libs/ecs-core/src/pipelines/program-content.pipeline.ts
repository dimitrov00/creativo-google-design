import type {
  CourseInput,
  PositionInput,
  ShopEventInput,
  LocalizedText,
} from '@core/components';
import type { Course, Position, ShopEvent } from '@core/entities';
import { CourseId, EventId, PositionId, Result } from '@core/primitives';
import {
  EngagementError,
  EngagementErrorCode,
  type ProgramSaveError,
  type RepositoryError,
} from '@core/errors';
import type {
  CourseWritePorts,
  DefaultLocationPorts,
  IdPorts,
  LocationLoadPorts,
  PositionBodyWritePorts,
  PositionWritePorts,
  ShopEventWritePorts,
} from '@core/ports';
import { ProgramsSystem, ZonedTimeSystem } from '@core/systems';

/**
 * The admin programs saves (flip 4, F4-3) — `positions`, `courses`,
 * `events` stay a rules-guarded admin write under D9(b), so these are
 * BROWSER pipelines over plain write ports, one sandwich each:
 *
 * 1. **Impure read** — on an update, the stored document (today's existence
 *    check: an update never silently re-creates a deleted document); for an
 *    event, also the ONE location whose zone places it — its own, else the
 *    default shop (F-4, OR-38).
 * 2. **Pure compute** — `ProgramsSystem` judges the raw form and builds the
 *    entity; for an event it picks the zone or refuses a shop that is not
 *    stored (`zoneOf`), this pipeline — the ingestion boundary — converts
 *    the wall clock ONCE with `ZonedTimeSystem.toUtc` (Law 7.3), and
 *    `ProgramsSystem.shopEvent` assembles the entity with that instant.
 * 3. **Impure write** — `saveX(entity)`, a full-document set of the body.
 *
 * No transaction: an admin save has no invariant across documents, and the
 * legacy read-then-write was not atomic either. On a create the id is drawn
 * BEFORE validation (as the legacy use cases did), so a refused create
 * spends one id. Nothing is written after any refusal. No logging (the web
 * holds no telemetry port).
 */

export type WritePositionPorts = PositionWritePorts & IdPorts;
export type WriteCoursePorts = CourseWritePorts & IdPorts;
export type WriteShopEventPorts = ShopEventWritePorts &
  LocationLoadPorts &
  DefaultLocationPorts &
  IdPorts;

/** `id: null` creates (a fresh `nextId`); an id updates an EXISTING document. */
export type WriteProgramCommand<Id, Input> = {
  readonly id: Id | null;
  readonly input: Input;
};

/**
 * An update's target, read: the id when its document is stored, the
 * store's failure, or the not-found refusal naming it.
 */
function existingId<Id extends PositionId | CourseId | EventId>(
  id: Id,
  loaded: Result<object | null, RepositoryError>,
  errorCode: EngagementError.ProgramNotFoundCode,
): Result<Id, readonly ProgramSaveError[]> {
  if (!loaded.ok) return Result.err([loaded.error]);
  return loaded.value === null
    ? Result.err([EngagementError.programNotFound(errorCode, id)])
    : Result.ok(id);
}

/** Creates or updates a careers-page role from the admin form. */
export const writePosition =
  (ports: WritePositionPorts) =>
  async (
    cmd: WriteProgramCommand<PositionId, PositionInput>,
  ): Promise<Result<Position, readonly ProgramSaveError[]>> => {
    const target =
      cmd.id === null
        ? Result.ok(PositionId.of(ports.nextId()))
        : existingId(
            cmd.id,
            await ports.loadPosition(cmd.id),
            EngagementErrorCode.PositionNotFound,
          );
    if (!target.ok) return target;
    const position = ProgramsSystem.position(target.value, cmd.input);
    if (!position.ok) return position;
    const saved = await ports.savePosition(position.value);
    return saved.ok ? Result.ok(position.value) : Result.err([saved.error]);
  };

/** A role's description as the editor holds it: Markdown per language, blank for none. */
export type WritePositionBodyCommand = {
  readonly id: PositionId;
  readonly body: LocalizedText;
};

/**
 * Saves a role's description from the editor — after the role itself is
 * saved, so the document it sits beside exists (the rules ask). No read:
 * `ProgramsSystem.body` judges what was typed, then ONE write — the body
 * set whole, or, when every language is blank, the document removed.
 * Nothing is written after a refusal.
 */
export const writePositionBody =
  (ports: PositionBodyWritePorts) =>
  async (
    cmd: WritePositionBodyCommand,
  ): Promise<Result<void, readonly ProgramSaveError[]>> => {
    const body = ProgramsSystem.body(cmd.body);
    if (!body.ok) return body;
    const written =
      body.value === null
        ? await ports.clearPositionBody(cmd.id)
        : await ports.savePositionBody({ id: cmd.id, body: body.value });
    return written.ok ? written : Result.err([written.error]);
  };

/** Creates or updates a course listing from the admin form. */
export const writeCourse =
  (ports: WriteCoursePorts) =>
  async (
    cmd: WriteProgramCommand<CourseId, CourseInput>,
  ): Promise<Result<Course, readonly ProgramSaveError[]>> => {
    const target =
      cmd.id === null
        ? Result.ok(CourseId.of(ports.nextId()))
        : existingId(
            cmd.id,
            await ports.loadCourse(cmd.id),
            EngagementErrorCode.CourseNotFound,
          );
    if (!target.ok) return target;
    const course = ProgramsSystem.course(target.value, cmd.input);
    if (!course.ok) return course;
    const saved = await ports.saveCourse(course.value);
    return saved.ok ? Result.ok(course.value) : Result.err([saved.error]);
  };

/**
 * Creates or updates a shop event from the admin form — the ingestion
 * boundary of its instant: exactly ONE location read (its own, else the
 * default shop), the zone picked by `ProgramsSystem.zoneOf` — an event at a
 * shop that is not stored is refused, never placed on the default shop's
 * clock (OR-38) — the wall clock converted ONCE (a spring-forward gap time
 * is `DST_GAP_INVALID_TIME`, a fall-back repeat the earlier offset).
 */
export const writeShopEvent =
  (ports: WriteShopEventPorts) =>
  async (
    cmd: WriteProgramCommand<EventId, ShopEventInput>,
  ): Promise<Result<ShopEvent, readonly ProgramSaveError[]>> => {
    const target =
      cmd.id === null
        ? Result.ok(EventId.of(ports.nextId()))
        : existingId(
            cmd.id,
            await ports.loadEvent(cmd.id),
            EngagementErrorCode.ShopEventNotFound,
          );
    if (!target.ok) return target;
    const fields = ProgramsSystem.eventFields(cmd.input);
    if (!fields.ok) return fields;

    const loaded = await ports.loadLocation(
      ProgramsSystem.zoneLocationOf(fields.value, ports.defaultLocationId),
    );
    if (!loaded.ok) return Result.err([loaded.error]);
    const zone = ProgramsSystem.zoneOf(
      fields.value.locationId,
      loaded.value,
      ports.defaultLocationId,
    );
    if (!zone.ok) return Result.err([zone.error]);

    const utcEpochMs = ZonedTimeSystem.toUtc(
      fields.value.localDate,
      fields.value.startMinutes,
      zone.value,
    );
    if (!utcEpochMs.ok) return Result.err([utcEpochMs.error]);
    const event = ProgramsSystem.shopEvent(
      target.value,
      fields.value,
      utcEpochMs.value,
    );
    const saved = await ports.saveEvent(event);
    return saved.ok ? Result.ok(event) : Result.err([saved.error]);
  };

/**
 * The order of a list, as the admin just arranged it — a sandwich with no
 * read: the page hands over the stored entities in their new order,
 * `ProgramsSystem.resequenced` answers the ones whose place changed, and
 * each is saved whole, one after another. It stops at the first failed
 * write and answers it; the places written before it stay written, and the
 * live list shows the order as stored.
 */
export const reorderPositions =
  (ports: PositionWritePorts) =>
  async (
    arranged: readonly Position[],
  ): Promise<Result<void, RepositoryError>> => {
    for (const position of ProgramsSystem.resequenced(arranged)) {
      const saved = await ports.savePosition(position);
      if (!saved.ok) return saved;
    }
    return Result.ok(undefined);
  };

/**
 * Turns a role's status over (open ⇄ closed) from the list — the row's
 * quick action. No fresh read: the page hands over the stored role, and it
 * is saved whole with the other status. Answers the role as saved.
 */
export const togglePositionStatus =
  (ports: PositionWritePorts) =>
  async (position: Position): Promise<Result<Position, RepositoryError>> => {
    const next = ProgramsSystem.positionToggled(position);
    const saved = await ports.savePosition(next);
    return saved.ok ? Result.ok(next) : saved;
  };

/** A course's enrolment turned over from the list, as {@link togglePositionStatus}. */
export const toggleCourseEnrollment =
  (ports: CourseWritePorts) =>
  async (course: Course): Promise<Result<Course, RepositoryError>> => {
    const next = ProgramsSystem.courseToggled(course);
    const saved = await ports.saveCourse(next);
    return saved.ok ? Result.ok(next) : saved;
  };

/** The courses' order, as {@link reorderPositions}. */
export const reorderCourses =
  (ports: CourseWritePorts) =>
  async (
    arranged: readonly Course[],
  ): Promise<Result<void, RepositoryError>> => {
    for (const course of ProgramsSystem.resequenced(arranged)) {
      const saved = await ports.saveCourse(course);
      if (!saved.ok) return saved;
    }
    return Result.ok(undefined);
  };
