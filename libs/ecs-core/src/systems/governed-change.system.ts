import {
  type Actor,
  AuditAction,
  AuditContext,
  AuditTargetRef,
  type GovernedAction,
  GovernedCollection,
  type GovernedDocCollection,
} from '@core/components';
import {
  type AuditResourceId,
  type CustomerId,
  Result,
  type StoredFields,
  type TriggerEventId,
  type UtcEpochMs,
} from '@core/primitives';
import { GovernanceError } from '@core/errors';
import {
  type AppointmentNote,
  type AppointmentPhoto,
  Collections,
  type ScheduleException,
} from '@core/entities';
import {
  AuditSystem,
  type AuditRowPlan,
  type ProfileChange,
} from './audit.system';
import { CanonicalJsonSystem } from './canonical-json.system';

/**
 * A write to one of the thirteen governed collections, as the
 * document-change trigger sees it (audit-hardening WS-3, RU-40): the
 * delivery's event id (the row id's change key — a redelivery derives the
 * same row), the event's own instant, the collection, the resource
 * `<path>/<docId>` (branded at the wire edge by `AuditResourceId.parse` —
 * Law 7.4, never a raw id field), the client record for a CUSTOMERS write
 * (`CustomerId.parse` of the document id at the edge, else `null`), who
 * wrote it, both sides' existence and the changed top-level field NAMES
 * ({@link GovernedChangeSystem.changedFields}).
 */
export type GovernedChange = {
  readonly governedCollection: GovernedDocCollection;
  readonly eventId: TriggerEventId;
  /** The event's instant; `null` when it did not parse — the plan's `nowUtcMs` stands in. */
  readonly eventAtUtcMs: UtcEpochMs | null;
  readonly resourceId: AuditResourceId;
  readonly targetCustomerId: CustomerId | null;
  readonly writer: Actor;
  readonly beforeExists: boolean;
  readonly afterExists: boolean;
  readonly fields: readonly string[];
};

/**
 * One document write the trigger audits — narrowed with `===` on
 * `governedCollection` (RU-40): `USERS` is a {@link ProfileChange}, every
 * other member a {@link GovernedChange}.
 */
export type DocumentChange = ProfileChange | GovernedChange;

/** Code-unit order — the order a `sort()` with no comparator gives strings. */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A side's top-level keys, ascending — the field list of a create or a delete. */
function keysOf(side: StoredFields): readonly string[] {
  return Object.keys(side).sort(byCodeUnit);
}

/** Every stored root key of an entity, over all its variants — its `id` is the document id, never a field. */
type StoredKey<T> = T extends unknown ? Exclude<keyof T, 'id'> : never;

/**
 * The key table of one entity: EVERY stored root key, and nothing else —
 * a renamed, added or dropped field fails to compile here.
 */
type KeyTable<T> = { readonly [K in StoredKey<T>]: true };

const NOTE_KEYS: KeyTable<AppointmentNote> = {
  authorUserId: true,
  text: true,
  writtenAtUtcMs: true,
};

const PHOTO_KEYS: KeyTable<AppointmentPhoto> = {
  appointmentId: true,
  barberId: true,
  clientCustomerId: true,
  clientLabel: true,
  height: true,
  label: true,
  path: true,
  photoOrigin: true,
  takenAtUtcMs: true,
  takenByUserId: true,
  url: true,
  width: true,
};

const EXCEPTION_KEYS: KeyTable<ScheduleException> = {
  barberId: true,
  exceptionEffect: true,
  exceptionRanges: true,
  localDate: true,
  locationId: true,
  utcEpochMs: true,
};

/** The one name a row keeps for every field its collection does not declare (R36). */
const UNKNOWN_FIELD = '<unknown>';

/**
 * The stored keys of a collection the BROWSER writes with no key-set rule
 * (`appointmentNotes`, `appointmentPhotos` — `worksTheBook()`;
 * `scheduleExceptions` — `mayEditRoster()`), where a field NAME is caller
 * text; `null` for every other collection — written by the Admin SDK only,
 * or by a rule that pins its keys (`keys().hasOnly`: positions, courses,
 * events) — whose names are the schema's.
 */
function knownKeysOf(collection: GovernedDocCollection): object | null {
  switch (collection) {
    case GovernedCollection.AppointmentNotes:
      return NOTE_KEYS;
    case GovernedCollection.AppointmentPhotos:
      return PHOTO_KEYS;
    case GovernedCollection.ScheduleExceptions:
      return EXCEPTION_KEYS;
    default:
      return null;
  }
}

/**
 * The document-change trigger's pure half (audit-hardening WS-3, RU-40):
 * where each governed collection lives, which fields a write changed, its
 * verb, and the ONE row it plans — a users write through
 * `AuditSystem.planProfileChange` (unchanged behaviour), every other
 * collection as a `GOVERNED_DOC_*` row. Names only, never a value (R36).
 * Imports `AuditSystem` one way; `audit.system.ts` never imports this file.
 */
export const GovernedChangeSystem = {
  UNKNOWN_FIELD,

  /** The Firestore collection path of each governed tag — exhaustive. */
  pathOf(governedCollection: GovernedCollection): string {
    switch (governedCollection) {
      case GovernedCollection.Users:
        return Collections.Users;
      case GovernedCollection.Settings:
        return Collections.Settings;
      case GovernedCollection.Services:
        return Collections.Services;
      case GovernedCollection.Barbers:
        return Collections.Barbers;
      case GovernedCollection.Locations:
        return Collections.Locations;
      case GovernedCollection.BarberSchedules:
        return Collections.BarberSchedules;
      case GovernedCollection.ScheduleExceptions:
        return Collections.ScheduleExceptions;
      case GovernedCollection.Coupons:
        return Collections.Coupons;
      case GovernedCollection.Positions:
        return Collections.Positions;
      case GovernedCollection.Courses:
        return Collections.Courses;
      case GovernedCollection.Events:
        return Collections.Events;
      case GovernedCollection.Customers:
        return Collections.Customers;
      case GovernedCollection.AppointmentNotes:
        return Collections.AppointmentNotes;
      case GovernedCollection.AppointmentPhotos:
        return Collections.AppointmentPhotos;
    }
  },

  /**
   * The changed top-level field NAMES, ascending and each once: a create
   * lists the after-image's keys, a delete the before-image's, an update
   * every key whose value differs — compared as key-sorted JSON, so a map
   * whose keys merely reordered is no change and an emptied list is one; a
   * key present on one side only is a change.
   */
  changedFields(
    before: StoredFields | null,
    after: StoredFields | null,
  ): readonly string[] {
    if (before === null) return after === null ? [] : keysOf(after);
    if (after === null) return keysOf(before);
    const canonical = CanonicalJsonSystem.of;
    const keys = new Set<string>([
      ...Object.keys(before),
      ...Object.keys(after),
    ]);
    const changed: string[] = [];
    for (const key of keys) {
      const was = Object.prototype.hasOwnProperty.call(before, key);
      const is = Object.prototype.hasOwnProperty.call(after, key);
      if (was !== is || canonical(before[key]) !== canonical(after[key])) {
        changed.push(key);
      }
    }
    return changed.sort(byCodeUnit);
  },

  /**
   * The field names a row may keep (R36 / T5 — review round 1): on a
   * collection the browser writes with no key-set rule, a name the entity
   * declares is kept and every other one becomes the ONE
   * {@link UNKNOWN_FIELD} marker — a caller-chosen key is caller text (a
   * name, a phone) and never reaches the permanent audit row; the write is
   * still audited. Any other collection's names pass as they are.
   * Ascending, each once.
   */
  namedFields(
    collection: GovernedDocCollection,
    fields: readonly string[],
  ): readonly string[] {
    const known = knownKeysOf(collection);
    if (known === null) return fields;
    const kept = new Set<string>();
    for (let i = 0; i < fields.length; i++) {
      const name = fields[i] as string;
      kept.add(Object.hasOwn(known, name) ? name : UNKNOWN_FIELD);
    }
    return [...kept].sort(byCodeUnit);
  },

  /** Creation, update and deletion, named apart. */
  action(beforeExists: boolean, afterExists: boolean): GovernedAction {
    if (!beforeExists) return AuditAction.GovernedDocCreated;
    return afterExists
      ? AuditAction.GovernedDocUpdated
      : AuditAction.GovernedDocDeleted;
  },

  /**
   * The ONE row a document write plans — the single planner entry of the
   * document-change trigger. A users write is
   * `AuditSystem.planProfileChange`'s, unchanged. Any other: a write that
   * changed no field plans nothing; an event with no id is refused rather
   * than minted one; otherwise one `GOVERNED_DOC_*` row credited to the
   * writer, stamped with the event's instant, naming the resource, targeted
   * at the client record for a CUSTOMERS write and at nobody otherwise,
   * listing the changed names {@link GovernedChangeSystem.namedFields}
   * keeps, its id basis keyed by the event id (a redelivery derives the
   * same row). A trigger row names no operation (`auditOperationId: null`).
   */
  plan(
    change: DocumentChange,
    nowUtcMs: UtcEpochMs,
  ): Result<AuditRowPlan | null, GovernanceError.AuditEntryEmptyAction> {
    if (change.governedCollection === GovernedCollection.Users) {
      return AuditSystem.planProfileChange(change, nowUtcMs);
    }
    if (change.fields.length === 0) return Result.ok(null);
    if (change.eventId.trim().length === 0) {
      return Result.err(GovernanceError.auditEntryEmptyAction());
    }
    const action = GovernedChangeSystem.action(
      change.beforeExists,
      change.afterExists,
    );
    return Result.ok({
      row: {
        recordedAtUtcMs: change.eventAtUtcMs ?? nowUtcMs,
        resourceId: change.resourceId,
        auditOperationId: null,
        ...change.writer,
        ...AuditContext.governed(
          action,
          change.governedCollection,
          GovernedChangeSystem.namedFields(
            change.governedCollection,
            change.fields,
          ),
        ),
        ...(change.targetCustomerId === null
          ? AuditTargetRef.none()
          : AuditTargetRef.customer(change.targetCustomerId)),
      },
      idBasis: AuditSystem.rowBasis(
        action,
        change.resourceId,
        change.targetCustomerId,
        AuditSystem.changeKey.profile(change.eventId),
      ),
    });
  },
} as const;
