import type {
  CourseInput,
  PositionInput,
  ShopEventInput,
} from '@core/components';
import type { Course, Position, ShopEvent } from '@core/entities';
import {
  CourseId,
  EngagementError,
  EngagementErrorCode,
  EventId,
  PositionId,
  Result,
  type ProgramSaveError,
  type RepositoryError,
} from '@core/primitives';
import type {
  CourseWritePorts,
  DefaultLocationPorts,
  IdPorts,
  LocationLoadPorts,
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
 *    event, also the location whose zone places it, and the default shop's
 *    when a typed location names no document (F-4).
 * 2. **Pure compute** — `ProgramsSystem` judges the raw form and builds the
 *    entity; for an event it picks the zone (`zoneOf`), this pipeline — the
 *    ingestion boundary — converts the wall clock ONCE with
 *    `ZonedTimeSystem.toUtc` (Law 7.3), and `ProgramsSystem.shopEvent`
 *    assembles the entity with that instant.
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
 * boundary of its instant: the zone's location read (its own, else the
 * default shop; the default too when a typed one is absent), the zone
 * picked by `ProgramsSystem.zoneOf`, the wall clock converted ONCE (a
 * spring-forward gap time is `DST_GAP_INVALID_TIME`, a fall-back repeat the
 * earlier offset).
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

    const zoneLocationId = ProgramsSystem.zoneLocationOf(
      fields.value,
      ports.defaultLocationId,
    );
    const named = await ports.loadLocation(zoneLocationId);
    if (!named.ok) return Result.err([named.error]);
    const fallback =
      named.value === null && zoneLocationId !== ports.defaultLocationId
        ? await ports.loadLocation(ports.defaultLocationId)
        : Result.ok(null);
    if (!fallback.ok) return Result.err([fallback.error]);
    const zone = ProgramsSystem.zoneOf(
      named.value,
      fallback.value,
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
