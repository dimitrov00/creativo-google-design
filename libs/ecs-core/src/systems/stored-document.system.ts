import {
  BookingContact,
  BookingLifecycle,
  CustomerOrigin,
  ErasureLifecycle,
  MinuteBlock,
  Seat,
  StoodSeatPairs,
  TimeCoordinate,
  WriteProvenance,
} from '@core/components';
import { RepositoryError } from '@core/errors';
import {
  type Appointment,
  type AppointmentNote,
  type BarberBusyDay,
  Collections,
  type Customer,
} from '@core/entities';
import {
  AppointmentId,
  BarberId,
  BusyKey,
  CustomerId,
  LocalDate,
  LocationId,
  Result,
  StoredFields,
  Tag,
  UserId,
  UtcEpochMs,
} from '@core/primitives';

/** A stored document as read: its id beside its body, nothing checked yet. */
export type StoredDocument = StoredFields & { readonly id: string };

/**
 * One stored archetype's guard — the document itself (THE SAME OBJECT, typed
 * as its entity), or the refusal naming its path and its first offending
 * field.
 */
export type StoredGuard = (
  doc: StoredDocument,
) => Result<StoredDocument, RepositoryError>;

/** Which guard a collection's documents pass — `null`: read as stored. */
export type StoredGuardOf = (collection: string) => StoredGuard | null;

/**
 * What a trigger may still read off an appointment side ({@link
 * StoredDocumentSystem.salvage}) — the document's own arrays, or the shared
 * empty one; never a copy.
 */
export type StoredSalvage = {
  readonly busyKeys: readonly BusyKey[];
  readonly subjectCustomerIds: readonly CustomerId[];
  readonly locationId: LocationId | null;
};

/**
 * One side of an appointment write as a trigger reads it (edge hardening
 * D-3), through the guard: as stored, as the entity when admitted, and the
 * refusal when refused — an absent side is all three `null`.
 */
export type AppointmentSide = {
  /** The side as stored — `null` when the document is absent there. */
  readonly stored: StoredDocument | null;
  /** The side as the entity — `null` when absent or refused. */
  readonly appointment: Appointment | null;
  /** The guard's refusal — `null` when absent or admitted. */
  readonly refusal: RepositoryError | null;
};

/**
 * What the REFUSED sides of one write leave a trigger ({@link
 * StoredDocumentSystem.salvageSides}): the first refusal, and what the
 * refused sides still name — their busy keys (before's, then after's) and
 * the first location among them.
 */
export type SidesSalvage = {
  /** The first side's refusal (before, else after) — `null` when both were admitted or absent. */
  readonly refusal: RepositoryError | null;
  /** The refused sides' busy keys — the shared empty array when none names one. */
  readonly busyKeys: readonly BusyKey[];
  /** The first refused side's location — `null` when none names one. */
  readonly locationId: LocationId | null;
};

/** The one empty answer every salvage shares — read-only, never mutated. */
const NONE: readonly never[] = [];

/** The side of a write the document is absent on — shared, never mutated. */
const ABSENT_SIDE: AppointmentSide = {
  stored: null,
  appointment: null,
  refusal: null,
};

/**
 * A subject mirror in its REPAIRABLE form: absent (`undefined`), `null`, or
 * an array of ids — see the system's JSDoc on why absent and `null` pass.
 */
function isMirror<T>(
  raw: unknown,
  is: (element: unknown) => element is T,
): boolean {
  return raw === undefined || raw === null || StoredFields.isArrayOf(raw, is);
}

function isUtcOrNull(raw: unknown): boolean {
  return raw === null || UtcEpochMs.is(raw);
}

/**
 * One character `String.prototype.trim` keeps: `\s` is exactly the
 * WhiteSpace and LineTerminator set `trim()` strips, so a text this matches
 * is non-empty after trim — tested in place, no trimmed copy built. No `g`
 * flag: `test` keeps no `lastIndex` state between calls.
 */
const KEPT_BY_TRIM = /\S/;

/**
 * The first refused element of a stored struct array, as `<field>[i]` or
 * `<field>[i].<inner>` — the ONLY place a reason string is built, and only
 * on a refusal.
 */
function structArrayFault(
  field: string,
  raw: unknown,
  fault: (element: StoredFields) => string | null,
): string | null {
  if (!Array.isArray(raw)) return field;
  for (let i = 0; i < raw.length; i++) {
    const element: unknown = raw[i];
    if (!StoredFields.isRecord(element)) return `${field}[${i}]`;
    const inner = fault(element);
    if (inner !== null) return `${field}[${i}].${inner}`;
  }
  return null;
}

/** `<collection>/<id>` — the refused document's path. */
function pathOf(collection: string, doc: StoredDocument): string {
  return `${collection}/${doc.id}`;
}

function appointmentFault(doc: StoredDocument): string | null {
  if (!AppointmentId.is(doc.id)) return 'id';
  if (!LocationId.is(doc['locationId'])) return 'locationId';
  const time = TimeCoordinate.fieldFault(doc);
  if (time !== null) return time;
  const lifecycle = BookingLifecycle.fieldFault(doc);
  if (lifecycle !== null) return lifecycle;
  if (!StoredFields.isArrayOf(doc['busyKeys'], BusyKey.is)) return 'busyKeys';
  if (!StoredFields.isArrayOf(doc['barberIds'], BarberId.is)) {
    return 'barberIds';
  }
  if (!isMirror(doc['subjectUserIds'], UserId.is)) return 'subjectUserIds';
  if (!isMirror(doc['subjectCustomerIds'], CustomerId.is)) {
    return 'subjectCustomerIds';
  }
  const seats = structArrayFault('seats', doc['seats'], Seat.fieldFault);
  if (seats !== null) return seats;
  if (!StoredFields.isRecordArray(doc['discounts'])) return 'discounts';
  if (!StoredFields.isRecordArray(doc['voucherRedemptions'])) {
    return 'voucherRedemptions';
  }
  if (!StoredFields.isRecordArray(doc['appliedOperations'])) {
    return 'appliedOperations';
  }
  const stood = StoodSeatPairs.fieldFault(doc);
  if (stood !== null) return stood;
  if (!StoredFields.isCount(doc['revision'])) return 'revision';
  const rebooked = doc['bookedFromAppointmentId'];
  if (rebooked !== null && !AppointmentId.is(rebooked)) {
    return 'bookedFromAppointmentId';
  }
  if (!isUtcOrNull(doc['bookedAtUtcMs'])) return 'bookedAtUtcMs';
  if (!isUtcOrNull(doc['arrivedAtUtcMs'])) return 'arrivedAtUtcMs';
  const provenance = WriteProvenance.fieldFault(doc);
  if (provenance !== null) return provenance;
  return BookingContact.fieldFault(doc);
}

function customerFault(doc: StoredDocument): string | null {
  if (!CustomerId.is(doc.id)) return 'id';
  const account = doc['userId'];
  if (account !== null && !UserId.is(account)) return 'userId';
  if (typeof doc['displayName'] !== 'string') return 'displayName';
  if (!StoredFields.isTextOrNull(doc['phone'])) return 'phone';
  if (!StoredFields.isTextOrNull(doc['email'])) return 'email';
  if (!UtcEpochMs.is(doc['createdAtUtcMs'])) return 'createdAtUtcMs';
  if (!Tag.has(CustomerOrigin, doc['customerOrigin'])) return 'customerOrigin';
  const erasure = ErasureLifecycle.fieldFault(doc);
  if (erasure !== null) return erasure;
  return WriteProvenance.fieldFault(doc);
}

function busyDayFault(doc: StoredDocument): string | null {
  if (!BusyKey.is(doc.id)) return 'id';
  if (!BarberId.is(doc['barberId'])) return 'barberId';
  if (!LocalDate.is(doc['localDate'])) return 'localDate';
  if (!UtcEpochMs.is(doc['utcEpochMs'])) return 'utcEpochMs';
  return structArrayFault('blocks', doc['blocks'], MinuteBlock.fieldFault);
}

function appointmentNoteFault(doc: StoredDocument): string | null {
  if (!AppointmentId.is(doc.id)) return 'id';
  const text = doc['text'];
  if (typeof text !== 'string' || !KEPT_BY_TRIM.test(text)) return 'text';
  const author = doc['authorUserId'];
  if (author !== null && !UserId.is(author)) return 'authorUserId';
  return UtcEpochMs.is(doc['writtenAtUtcMs']) ? null : 'writtenAtUtcMs';
}

function salvage(doc: StoredDocument): StoredSalvage {
  const keys = doc['busyKeys'];
  const subjects = doc['subjectCustomerIds'];
  const location = doc['locationId'];
  return {
    busyKeys: StoredFields.isArrayOf(keys, BusyKey.is) ? keys : NONE,
    subjectCustomerIds: StoredFields.isArrayOf(subjects, CustomerId.is)
      ? subjects
      : NONE,
    locationId: LocationId.is(location) ? location : null,
  };
}

/** The answer of a write neither side of which was refused — shared, never mutated. */
const NOTHING_REFUSED: SidesSalvage = {
  refusal: null,
  busyKeys: NONE,
  locationId: null,
};

/** A REFUSED side's salvage — `null` for an admitted or absent side. */
function refusedSalvage(side: AppointmentSide): StoredSalvage | null {
  return side.refusal === null || side.stored === null
    ? null
    : salvage(side.stored);
}

function appointment(
  doc: StoredDocument,
): Result<Appointment, RepositoryError> {
  const fault = appointmentFault(doc);
  return fault === null
    ? // Validated field by field above — the document IS the entity (Law 5).
      Result.ok(doc as unknown as Appointment)
    : Result.err(
        RepositoryError.malformed(pathOf(Collections.Appointments, doc), fault),
      );
}

function customer(doc: StoredDocument): Result<Customer, RepositoryError> {
  const fault = customerFault(doc);
  return fault === null
    ? Result.ok(doc as unknown as Customer)
    : Result.err(
        RepositoryError.malformed(pathOf(Collections.Customers, doc), fault),
      );
}

function busyDay(doc: StoredDocument): Result<BarberBusyDay, RepositoryError> {
  const fault = busyDayFault(doc);
  return fault === null
    ? Result.ok(doc as unknown as BarberBusyDay)
    : Result.err(
        RepositoryError.malformed(pathOf(Collections.BarberBusy, doc), fault),
      );
}

function appointmentNote(
  doc: StoredDocument,
): Result<AppointmentNote, RepositoryError> {
  const fault = appointmentNoteFault(doc);
  return fault === null
    ? Result.ok(doc as unknown as AppointmentNote)
    : Result.err(
        RepositoryError.malformed(
          pathOf(Collections.AppointmentNotes, doc),
          fault,
        ),
      );
}

/**
 * StoredDocumentSystem — the READ-TIME GUARDS of the four main stored
 * archetypes (edge hardening D-1; the team note since pass E, E-2), the
 * successor of the `reconstitute()` mappers' `MalformedField` refusals
 * without their mapping: each guard
 * checks a document AS READ and answers `Result.ok` with THE SAME OBJECT,
 * typed as its entity (zero mapping, Law 5 — no field copied, renamed,
 * defaulted or dropped), or `Result.err(RepositoryError.malformed(path,
 * field))` naming the document's path and its FIRST offending field
 * (`seats[1].startMinutes` for an element). Pure: no I/O, no clock, no
 * mutation; the field checks are the companions' own `fieldFault` members
 * and the primitives' non-allocating `is` doors, composed here because an
 * entity holds no logic (Laws 1 and 2). The `*Fault` halves allocate
 * nothing on a well-formed document; the only allocations are the `Result`
 * wrapper and, on a refusal, the path and reason strings. Staff-day
 * listeners read a few dozen documents per snapshot: linear, constant per
 * field.
 *
 * **Which fields are checked — one rule for every archetype.** A field is
 * checked when a system ITERATES it, NARROWS on it or COMPUTES on it; a
 * field only a query or a display reads is not. The appointment entity's
 * own principle applies: the seats are the truth, the query mirrors are
 * recomputed by every write plan, so a corrupt mirror changes which
 * queries find a visit, never what it says.
 *
 * - `appointments/{id}`: `id`; `locationId` (the zone's source, Law 7.2);
 *   the time slice (`TimeCoordinate.fieldFault`); the lifecycle
 *   (`BookingLifecycle.fieldFault`); `busyKeys` and `barberIds` (arrays of
 *   keys / ids — `BusySystem.affectedKeys` and lane membership iterate
 *   them); `subjectUserIds` and `subjectCustomerIds` (see below); `seats`
 *   (each a record and `Seat.fieldFault` clean — a cancelled seat's
 *   `cancellationWindowHours` an `HourCount` or `null`, OR-45, since the
 *   statistics judge lateness by it; a `WALK_IN` seat's
 *   `subjectCustomerId` a client-record id, OR-26, since the walk-in's
 *   history and statistics key on it); `discounts`,
 *   `voucherRedemptions`, `appliedOperations` (arrays of records — the
 *   bill and the ledger replay iterate them); the stood-pair memory
 *   (`StoodSeatPairs.fieldFault`); `revision` (a non-negative safe
 *   integer); `bookedFromAppointmentId` (an id or `null`);
 *   `bookedAtUtcMs`, `arrivedAtUtcMs` (an instant or `null`);
 *   `writeOperationId` (`WriteProvenance.fieldFault`, see below); the
 *   contact (`BookingContact.fieldFault`).
 * - `customers/{id}`: `id`; `userId` (an account id or `null` — D29's
 *   explicit link); `displayName` (a string); `phone`, `email` (a string or
 *   `null`); `createdAtUtcMs`; `customerOrigin` (a `CustomerOrigin`
 *   member); the erasure tag (`ErasureLifecycle.fieldFault`, STRICT — see
 *   below); `writeOperationId` (`WriteProvenance.fieldFault`).
 *   An erased record (its name the marker, its contact `null`, the
 *   `ERASING` / `ERASED` stamps) is admitted like any other, as the same
 *   object.
 * - `barberBusy/{id}`: `id` (a `BusyKey` — the id IS the key); `barberId`;
 *   `localDate`; `utcEpochMs`; `blocks` (each a record and
 *   `MinuteBlock.fieldFault` clean) — a busy day feeds the collision math
 *   directly, so its blocks are checked whole.
 * - `appointmentNotes/{id}`: `id` (an `AppointmentId` — the note's id IS
 *   the visit's); `text` (a string with something left after trim — the
 *   entity's stored invariant, "trimmed and non-empty"; the team note's
 *   append joins its line below it, `VisitSidesSystem.appendedNote`);
 *   `authorUserId` (an account id or `null` — D29); `writtenAtUtcMs` (an
 *   instant). Four fields, checked whole like a busy day's blocks: the
 *   note is one small record the append re-decides in full, so none of
 *   it is handed on as the entity unchecked.
 *
 * **The one admitted field that may differ from its type.** The subject
 * mirrors (`subjectUserIds`, `subjectCustomerIds`) are iterated — the
 * projection dispatch reads `subjectCustomerIds` — so garbage there (a
 * string, an element that is no id) refuses the document. But they are
 * checked in their REPAIRABLE form: absent or `null` is ADMITTED, because
 * the subject-mirror backfill (`BackfillPlanSystem.mirrorRowOf`) reads a
 * missing list as `null` and restores it — a guard refusing those rows
 * would make the repair impossible. So an admitted appointment may carry an
 * absent or `null` mirror although its type says `readonly CustomerId[]`;
 * no reader trusts the type there: every trigger reads the subjects through
 * {@link StoredDocumentSystem.salvage}, which reads absent / `null` as `[]`.
 *
 * **Write provenance (WS-4.3) — absent is admitted too.** An appointment's
 * or a customer's `writeOperationId` is the join key from the document to
 * the call that last wrote it (the trigger attempt lines carry it). It is
 * checked so a stored value is always `null` or an `OperationId`
 * (`REPOSITORY_MALFORMED` naming `writeOperationId` otherwise), but a
 * document written before the field carries none, and no backfill invents
 * one (Law 5): an admitted document may lack the key although its type
 * says `OperationId | null`. No system reads it; a writer only stamps it.
 * A busy day carries no provenance (L5) and its guard ignores the key.
 *
 * **The erasure tag (Phase 3 WS-D, P3-L-18) — absent is REFUSED.** A
 * customer's `erasureStatus` is the tag every writer that would seat or
 * re-create the record reads (P3-RU-20), so the guard requires it on every
 * body — a member of `ErasureStatus`, with its variant's stamps instants.
 * Every writer creates `NONE`, so an admitted record never lies about its
 * tag. The erased record itself (the marker name, the `null` contact, the
 * stamps) passes like any other: a REFUSED record reads as ABSENT inside a
 * transaction, and an absent record is one a writer would re-create.
 *
 * **Deliberately NOT checked** (each a query key, a repair target or a
 * display field no decision reads): `ownerUserId`, `ownerCustomerId`,
 * `placement`, `inferredPlacement`; a seat's `barberPreference`,
 * `catalogPriceCents`, `catalogDurationMinutes`, `guestLabel`,
 * `subjectRelationship`, `cancelledBy`; the contact's E.164 / e-mail SHAPE;
 * the elements of `discounts`, `voucherRedemptions`, `appliedOperations`,
 * `stoodSeatPairs` beyond "a record"; a customer's `searchName` /
 * `searchPrefixes` (search mirrors only index #8 reads). A field joins the
 * list the day a system starts to rely on it.
 */
export const StoredDocumentSystem = {
  /** An `appointments/{id}` document — the same object as the entity, or its refusal. */
  appointment,

  /** A `customers/{id}` document — the same object as the entity, or its refusal. */
  customer,

  /** A `barberBusy/{id}` document — the same object as the entity, or its refusal. */
  busyDay,

  /** An `appointmentNotes/{id}` document — the same object as the entity, or its refusal (pass E, E-2). */
  appointmentNote,

  /** The first offending field of an appointment, or `null` — allocation-free on a clean document. */
  appointmentFault,

  /** The first offending field of a customer, or `null`. */
  customerFault,

  /** The first offending field of a busy day, or `null`. */
  busyDayFault,

  /** The first offending field of a team note, or `null` — allocation-free on a clean document. */
  appointmentNoteFault,

  /**
   * The registry an adapter dispatches on: the guard of `appointments`,
   * `customers`, `barberBusy` and `appointmentNotes`, `null` for every
   * other collection (read as stored, as before). A subcollection path is
   * never a registered name, so it is never guarded. The ONE registry this
   * tier exports (OR-33): every guarded adapter takes it as a required
   * parameter, and the registry that guards nothing is test support
   * (`unguarded`, `@core/testing`).
   */
  guardOf(collection: string): StoredGuard | null {
    switch (collection) {
      case Collections.Appointments:
        return appointment;
      case Collections.Customers:
        return customer;
      case Collections.BarberBusy:
        return busyDay;
      case Collections.AppointmentNotes:
        return appointmentNote;
      default:
        return null;
    }
  },

  /**
   * What a trigger may still read off an appointment side — admitted or
   * refused (edge hardening D-3): `busyKeys` when it is an array of keys,
   * `subjectCustomerIds` when it is an array of client-record ids,
   * `locationId` when it is an id; otherwise the shared empty array /
   * `null`. Answers the document's OWN arrays (no copy, nothing beyond the
   * answer record), and reads an absent or `null` subject mirror as `[]`.
   * A side is only ever used to PICK which projections to recompute —
   * the recompute re-reads the store, guarded.
   */
  salvage,

  /**
   * THE dispatch every read site shares (web and functions): `doc` through
   * the guard `guardOf` registers for `collection` — `Result.ok` with THE
   * SAME OBJECT when the collection is unguarded (a `null` collection is a
   * subcollection, never guarded) or the document admitted, the guard's
   * refusal otherwise. Reporting a refusal is the caller's (an adapter's
   * log); this decides only admit or refuse.
   */
  admit(
    guardOf: StoredGuardOf,
    collection: string | null,
    doc: StoredDocument,
  ): Result<StoredDocument, RepositoryError> {
    const guard = collection === null ? null : guardOf(collection);
    return guard === null ? Result.ok(doc) : guard(doc);
  },

  /**
   * One side of an appointment write through the appointment guard (D-3):
   * absent (`stored === null`), admitted (the entity, the same object) or
   * refused (the refusal; the side as stored is kept for its salvage).
   */
  appointmentSide(stored: StoredDocument | null): AppointmentSide {
    if (stored === null) return ABSENT_SIDE;
    const admitted = appointment(stored);
    return admitted.ok
      ? { stored, appointment: admitted.value, refusal: null }
      : { stored, appointment: null, refusal: admitted.error };
  },

  /**
   * What the refused sides of one write leave (D-3) — the first refusal
   * (before's, else after's), the refused sides' salvaged busy keys
   * (before's, then after's; the side's own array when only one names any)
   * and the first location among them. Admitted and absent sides add
   * nothing: an admitted side is its entity. Which work this picks — and
   * whether a refusal is the answer — is the pipeline's.
   */
  salvageSides(before: AppointmentSide, after: AppointmentSide): SidesSalvage {
    const first = refusedSalvage(before);
    const second = refusedSalvage(after);
    if (first === null && second === null) return NOTHING_REFUSED;
    const keys =
      first === null || first.busyKeys.length === 0
        ? (second?.busyKeys ?? NONE)
        : second === null || second.busyKeys.length === 0
          ? first.busyKeys
          : [...first.busyKeys, ...second.busyKeys];
    return {
      refusal: before.refusal ?? after.refusal,
      busyKeys: keys,
      locationId: first?.locationId ?? second?.locationId ?? null,
    };
  },
} as const;
