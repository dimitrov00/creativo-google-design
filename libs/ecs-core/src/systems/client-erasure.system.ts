import {
  type Actor,
  AccountLifecycle,
  AccountStatus,
  AuditAction,
  AuditContext,
  AuditTargetRef,
  BookingContact,
  type DocBody,
  type ErasureAction,
  ErasureCensus,
  ErasureLifecycle,
  ErasureStatus,
  PhotoOrigin,
  PrivacyMarker,
  type Role,
  Roles,
  type Seat,
  type SeatOccupant,
  SeatSubject,
  WriteOp,
} from '@core/components';
import { PrivacyError } from '@core/errors';
import {
  type AppointmentId,
  AuditResourceId,
  type CustomerId,
  type OperationId,
  type UtcEpochMs,
} from '@core/primitives';
import {
  type Appointment,
  type AppointmentNote,
  type AppointmentPhoto,
  Collections,
  type Customer,
  type ImpersonationSession,
  type InboxNotification,
  type Invitation,
  type Otp,
  Subcollections,
  type User,
  type WaitlistRequest,
} from '@core/entities';
import { type AuditRowPlan, AuditSystem } from './audit.system';
import {
  type ClientPerson,
  ClientPrivacySystem,
} from './client-privacy.system';
import { SearchFieldsSystem } from './search-fields.system';

/** Visits per unit commit — at most two writes each (the visit's patch, its note's removal), far below 500. */
export const ERASURE_CHUNK_SIZE = 25;

/**
 * The most documents one footprint list may hold (P3-L-21): every list read
 * stops at this + 1, and past it the preview and the erasure REFUSE
 * (`PRIVACY_ERASURE_TOO_LARGE`) before any write — never a silent
 * truncation that could certify an erasure with residue past the cap.
 */
export const ERASURE_MAX_DOCUMENTS = 5_000;

/**
 * The account-keyed documents an erasure removes or marks (P3-RU-24) — the
 * slice of {@link ErasureFootprint} {@link ClientErasureSystem.looseWrites}
 * reads: the inbox and the waitlist requests (deleted — they exist only for
 * the account), the invitations the account sent (`inviterName` marked) and
 * the impersonation sessions that targeted it (`reason` marked).
 */
export type ErasureLooseDocuments = {
  readonly person: ClientPerson;
  readonly notifications: readonly InboxNotification[];
  readonly waitlistRequests: readonly WaitlistRequest[];
  readonly invitations: readonly Invitation[];
  readonly sessions: readonly ImpersonationSession[];
};

/**
 * What the erasure READ about one person (audit-hardening Phase 3 WS-D,
 * §0.4) — every document as stored, zero mapping (Law 5): the record and
 * its linked account, the visits that seat the record and — while the
 * record still holds its contact values — the visits whose contact carries
 * one of them (P3-DEP-28: a staff edit may have removed the person's seat
 * and kept their contact), the notes of the visits that seat the record
 * (party visits' too, P3-RU-33), the photos that may be the person's (every
 * origin naming the record, and those of the person's sole-subject
 * visits), the account's loose documents and how many journal rows the
 * record has (retained, only counted). In no promised order; a document
 * met by two reads is counted once.
 */
export type ErasureFootprint = ErasureLooseDocuments & {
  readonly visits: readonly Appointment[];
  readonly notes: readonly AppointmentNote[];
  readonly photos: readonly AppointmentPhoto[];
  readonly journalCount: number;
};

/** The person's photos to delete — the Storage objects first (P3-L-10), then the documents. */
export type ErasurePhotoPlan = {
  /**
   * The `SHOT` photos' OWN object paths (`appointmentPhotos/{visit}/{photo}`,
   * P3-DEP-30) — deleted BEFORE their documents, so a resume still knows
   * them; a path the photo does not own is never deleted.
   */
  readonly objectPaths: readonly string[];
  /**
   * The `LIBRARY` photos' object paths — KEPT objects whose `clientLabel`
   * metadata is cleared BEFORE their documents go (P3-DEP-31).
   */
  readonly labelPaths: readonly string[];
  readonly writes: readonly WriteOp[];
};

/** Whether a text holds a personal value — present, not blank, not a pseudonym mark. */
function holdsText(text: string | null): boolean {
  return text !== null && text.length > 0 && !PrivacyMarker.isMarker(text);
}

/** Whether a record still holds a personal value — its name, contact or search keys. */
function recordHoldsPersonal(record: Customer): boolean {
  return (
    holdsText(record.displayName) ||
    record.phone !== null ||
    record.email !== null ||
    record.searchName.length > 0 ||
    record.searchPrefixes.length > 0
  );
}

/** Whether an account still holds a personal value — a marker name is none (P3-L-22). */
function accountHoldsPersonal(account: User): boolean {
  return (
    holdsText(account.firstName) ||
    holdsText(account.lastName) ||
    account.phone !== null ||
    account.email !== null ||
    account.birthDate !== null ||
    (account.searchName !== null && account.searchName.length > 0) ||
    account.searchPrefixes.length > 0
  );
}

/** Whether the visit carries any contact field at all. */
function hasContact(visit: Appointment): boolean {
  return !BookingContact.equals(visit, BookingContact.NONE);
}

/** Whether the person's walk-in seat still shows a label that is no mark. */
function isNamedOwnWalkIn(
  seat: Seat,
  customerId: CustomerId,
): seat is Seat & SeatOccupant.WalkIn {
  return (
    ClientPrivacySystem.isOwnWalkInSeat(seat, customerId) &&
    !PrivacyMarker.isMarker(seat.guestLabel)
  );
}

/**
 * The object a `SHOT` photo OWNS — `appointmentPhotos/{appointmentId}/{id}`,
 * the one path its upload writes (`uploadPhotoBytes`). The document is
 * staff-written and its `path` unchecked by the rules (P3-DEP-30): the
 * erasure deletes only this object, never another one a document names.
 */
function ownObjectPath(photo: AppointmentPhoto): string {
  return `${Collections.AppointmentPhotos}/${photo.appointmentId}/${photo.id}`;
}

/** How many of the person's walk-in seats on the visit still show a name. */
function namedOwnWalkIns(visit: Appointment, customerId: CustomerId): number {
  let count = 0;
  const seats = visit.seats;
  for (let i = 0; i < seats.length; i++) {
    if (isNamedOwnWalkIn(seats[i] as Seat, customerId)) count++;
  }
  return count;
}

/**
 * The visit's seats with the person's named walk-in seats marked
 * `— <n>` — `n` the smallest ordinal no label on the visit already shows,
 * so two seats never share a label (`walkInsByLabel`) — or `null` when no
 * seat needs it (idempotent). Every other seat as stored.
 */
function markedSeats(
  seats: readonly Seat[],
  customerId: CustomerId,
): readonly Seat[] | null {
  let out: Seat[] | null = null;
  let used: Set<string> | null = null;
  let ordinal = 1;
  for (let i = 0; i < seats.length; i++) {
    const seat = seats[i] as Seat;
    if (!isNamedOwnWalkIn(seat, customerId)) continue;
    if (out === null || used === null) {
      out = [...seats];
      used = new Set<string>();
      for (let k = 0; k < seats.length; k++) {
        const other = seats[k] as Seat;
        if (other.seatSubject !== SeatSubject.Account) {
          used.add(other.guestLabel);
        }
      }
    }
    while (used.has(PrivacyMarker.seatLabel(ordinal))) ordinal++;
    const label = PrivacyMarker.seatLabel(ordinal);
    used.add(label);
    out[i] = { ...seat, guestLabel: label };
  }
  return out;
}

/** The record's erasure slice as stored — what a transition from it must delete. */
function erasureSliceOf(record: Customer): ErasureLifecycle {
  switch (record.erasureStatus) {
    case ErasureStatus.None:
      return ErasureLifecycle.none();
    case ErasureStatus.Erasing:
      return ErasureLifecycle.begin(record.erasureStartedAtUtcMs);
    case ErasureStatus.Erased:
      return {
        erasureStatus: ErasureStatus.Erased,
        erasureStartedAtUtcMs: record.erasureStartedAtUtcMs,
        erasedAtUtcMs: record.erasedAtUtcMs,
      };
  }
}

/** The account's lifecycle slice as stored — what its move to `ERASED` must delete (a block's fields). */
function accountSliceOf(account: User): AccountLifecycle {
  switch (account.accountStatus) {
    case AccountStatus.Active:
      return AccountLifecycle.active();
    case AccountStatus.Blocked:
      return AccountLifecycle.block(
        account.blockReason,
        account.blockedUntilUtcMs,
      );
    case AccountStatus.Erased:
      return AccountLifecycle.erase(account.accountErasedAtUtcMs);
  }
}

/**
 * One erasure row (P3-RU-22): the verb and the census only (never a value),
 * credited to `actor` (the admin), naming the record as resource and
 * target, with the act's operation id — its id basis keyed by `changeKey`.
 */
function erasureRow(
  auditAction: ErasureAction,
  customerId: CustomerId,
  census: ErasureCensus,
  actor: Actor,
  operationId: OperationId,
  nowUtcMs: UtcEpochMs,
  changeKey: string,
): AuditRowPlan {
  const resourceId = AuditResourceId.forCustomer(customerId);
  return {
    row: {
      recordedAtUtcMs: nowUtcMs,
      resourceId,
      auditOperationId: operationId,
      ...actor,
      ...AuditContext.clientErasure(auditAction, census),
      ...AuditTargetRef.customer(customerId),
    },
    idBasis: AuditSystem.rowBasis(
      auditAction,
      resourceId,
      customerId,
      changeKey,
    ),
  };
}

/**
 * The client erasure's pure half (audit-hardening Phase 3 WS-D, GDPR
 * Art. 17, "pseudonymize, keep records"): who may not be erased, what of a
 * person's footprint still holds a personal value (the census), and every
 * write plan of the erasure's commits — the contact sweep and its row, the
 * stamp, one visit's patch, the photos, the loose documents, the completion
 * and the re-sweep — each
 * idempotent: a document already clean plans nothing, so any call resumes
 * from the stored state alone. Visits, money, statistics, loyalty, the
 * journal and audit rows are never touched; every write that clears a
 * client record or a visit stamps the erasure's own `writeOperationId`
 * (WS-4.3's join key). No clock, no I/O, no crypto: the instant, the
 * digests and the operation id are parameters (Law 3).
 */
export const ClientErasureSystem = {
  /**
   * THE GUARD of every writer that would seat or re-create a client record
   * (`bookAppointment`, `editAppointment` — P3-RU-20): the ids among `ids`
   * whose record the read set holds under erasure (`ERASING` or `ERASED`,
   * `ErasureLifecycle.isUnderErasure`), each once, in the order given. An
   * id the read set holds no record for (a record to create) is none.
   */
  underErasureAmong(
    ids: Iterable<CustomerId>,
    stored: ReadonlyMap<CustomerId, Customer | null>,
  ): readonly CustomerId[] {
    const out: CustomerId[] = [];
    for (const id of ids) {
      if (out.includes(id)) continue;
      const record = stored.get(id) ?? null;
      if (record !== null && ErasureLifecycle.isUnderErasure(record)) {
        out.push(id);
      }
    }
    return out;
  },

  /**
   * Why the person may not be erased, or `null` (P3-L-9, P3-L-16): a
   * `userId` the record does not provably link
   * (`PRIVACY_ACCOUNT_LINK_MISMATCH`, through
   * {@link ClientPrivacySystem.linkOf}, the one check); a linked account
   * holding any staff role in its STORED roles, which would remove an
   * operator (`PRIVACY_ERASURE_STAFF_ACCOUNT`); and — fail-closed
   * (P3-DEP-29) — a linked uid whose `users` document is absent while its
   * Auth user exists (`authRoles` not `null`): roles reach a session only
   * as claims minted onto the custom token from the stored `users.roles`
   * (Phase 4a 4A-14 — no production path sets Auth custom claims, so
   * `getUser().customClaims` never shows them), so without the document
   * nothing proves the account is no operator's. The Auth claim roles stay
   * a second check (defence in depth, a future `setRoles`). No account and
   * no Auth user leaves nothing to delete: the erasure proceeds. A walk-in
   * (no link) has no account to refuse.
   */
  refusalOf(
    person: ClientPerson,
    authRoles: readonly Role[] | null,
    hash: (input: string) => string,
  ):
    PrivacyError.ErasureStaffAccount | PrivacyError.AccountLinkMismatch | null {
    const link = ClientPrivacySystem.linkOf(person.record, hash);
    if (!link.ok) return link.error;
    if (link.value === null) return null;
    const account = person.account;
    if (account !== null && Roles.isStaff(account.roles)) {
      return PrivacyError.erasureStaffAccount();
    }
    if (authRoles !== null && Roles.isStaff(authRoles)) {
      return PrivacyError.erasureStaffAccount();
    }
    if (account === null && authRoles !== null) {
      return PrivacyError.erasureStaffAccount();
    }
    return null;
  },

  /** The challenges stored under the person's contact, removed — each once (a sign-in artefact, P3-RU-21). */
  otpWrites(otps: readonly Otp[]): readonly WriteOp[] {
    const writes: WriteOp[] = [];
    const listed = ClientPrivacySystem.distinct(otps);
    for (let i = 0; i < listed.length; i++) {
      writes.push(WriteOp.remove([Collections.Otps, (listed[i] as Otp).id]));
    }
    return writes;
  },

  /**
   * THE CENSUS of a person's footprint (P3-RU-22): the eight personal
   * counts — what still holds a personal value — and the three retained
   * ones, over the footprint as read (each document once; the visits that
   * seat the record and only their notes, and the contact of a visit that
   * no longer seats the record but carries the person's contact,
   * P3-DEP-28). A visit's contact is the person's when it is theirs
   * ({@link ClientPrivacySystem.contactIsPersons}) or the visit is
   * sole-subject (the erasure errs to clearing, P3-L-12); any other contact
   * of a visit that seats the record is retained and counted. Stateless, so
   * it is recomputed on every resume.
   */
  census(
    footprint: ErasureFootprint,
    walkInHash: (input: string) => string,
  ): ErasureCensus {
    const person = footprint.person;
    const record = person.record;
    const customerId = record.id;
    const userId = record.userId;
    const visitIds = new Set<AppointmentId>();
    const soleSubjectVisitIds = new Set<AppointmentId>();
    let erasureContactCount = 0;
    let erasureContactKeptCount = 0;
    let erasureLabelCount = 0;
    const visits = ClientPrivacySystem.distinct(footprint.visits);
    for (let i = 0; i < visits.length; i++) {
      const visit = visits[i] as Appointment;
      if (!visit.subjectCustomerIds.includes(customerId)) {
        // Found by the person's contact value only: its contact, nothing else.
        if (
          hasContact(visit) &&
          ClientPrivacySystem.contactIsPersons(visit, person, walkInHash)
        ) {
          erasureContactCount++;
        }
        continue;
      }
      visitIds.add(visit.id);
      const sole = ClientPrivacySystem.isSoleSubject(visit, customerId);
      if (sole) soleSubjectVisitIds.add(visit.id);
      if (hasContact(visit)) {
        if (
          sole ||
          ClientPrivacySystem.contactIsPersons(visit, person, walkInHash)
        ) {
          erasureContactCount++;
        } else {
          erasureContactKeptCount++;
        }
      }
      erasureLabelCount += namedOwnWalkIns(visit, customerId);
    }
    let erasureNoteCount = 0;
    const notes = ClientPrivacySystem.distinct(footprint.notes);
    for (let i = 0; i < notes.length; i++) {
      if (visitIds.has((notes[i] as AppointmentNote).id)) erasureNoteCount++;
    }
    let erasurePhotoCount = 0;
    const photos = ClientPrivacySystem.distinct(footprint.photos);
    for (let i = 0; i < photos.length; i++) {
      if (
        ClientPrivacySystem.photoIsPersons(
          photos[i] as AppointmentPhoto,
          soleSubjectVisitIds,
          customerId,
        )
      ) {
        erasurePhotoCount++;
      }
    }
    return {
      erasureRecordCount: recordHoldsPersonal(record) ? 1 : 0,
      erasureAccountCount:
        person.account !== null && accountHoldsPersonal(person.account) ? 1 : 0,
      erasureContactCount,
      erasureLabelCount,
      erasureNoteCount,
      erasurePhotoCount,
      erasureDocumentCount: ClientErasureSystem.looseWrites({
        ...footprint,
        invitations: [],
        sessions: [],
      }).length,
      erasurePseudonymCount:
        userId === null
          ? 0
          : ClientErasureSystem.looseWrites({
              ...footprint,
              notifications: [],
              waitlistRequests: [],
            }).length,
      erasureVisitCount: visitIds.size,
      erasureContactKeptCount,
      erasureJournalCount: footprint.journalCount,
    };
  },

  /** Every PERSONAL count of the census is 0 — the residue of a complete erasure (P3-RU-22). */
  isComplete(residue: ErasureCensus): boolean {
    for (const field of ErasureCensus.PERSONAL_FIELDS) {
      if (residue[field] !== 0) return false;
    }
    return true;
  },

  /** Some personal value is left — the trigger of an `ERASED` record's RESWEPT row (P3-L-19). */
  hasResidue(census: ErasureCensus): boolean {
    return !ClientErasureSystem.isComplete(census);
  },

  /**
   * THE STAMP COMMIT (P3-RU-21) — `[]` unless the record is `NONE`: the
   * record moves `NONE → ERASING` (+ `erasureStartedAtUtcMs`) with its
   * personal values cleared — the name the marker, the contact `null`, the
   * search keys of no name and no contact (`SearchFieldsSystem`, never a
   * second derivation) — and the erasure's `writeOperationId`; the linked
   * account, when its document exists, moves to `ERASED`
   * (+ `accountErasedAtUtcMs`, a block's fields deleted) with its names the
   * marker (P3-L-22), contact, birth date and search keys cleared and its
   * edit stamp reset (its roles stay — a staff account is refused before);
   * and the `AuditAction.PrivacyClientErasureStarted` row carries the census BEFORE.
   * Atomically, so the guard every writer reads and the stripping land
   * together; keyed by STATE (`AuditSystem.changeKey.erasureStarted`), so a replay plans none.
   * The census is the one the stamping call read: what is left at the stamp.
   * A contact an EARLIER call's sweep cleared (a budget spent mid-sweep, or a
   * commit failed between the sweep and the stamp) is not in it — that act's
   * `PRIVACY_CLIENT_ERASURE_SWEPT` row holds its census ({@link
   * ClientErasureSystem.sweepRowWrites}; plan §7 item 28).
   */
  stampWrites(
    person: ClientPerson,
    census: ErasureCensus,
    actor: Actor,
    operationId: OperationId,
    nowUtcMs: UtcEpochMs,
    hash: (input: string) => string,
  ): readonly WriteOp[] {
    const record = person.record;
    if (record.erasureStatus !== ErasureStatus.None) return [];
    const begun = ErasureLifecycle.begin(nowUtcMs);
    const cleared: DocBody = {
      displayName: PrivacyMarker.TEXT,
      phone: null,
      email: null,
      ...SearchFieldsSystem.searchFields(null, null, null, null),
      writeOperationId: operationId,
      ...begun,
    };
    const writes: WriteOp[] = [
      WriteOp.transition(
        [Collections.Customers, record.id],
        cleared,
        WriteOp.variantFieldsToDelete(erasureSliceOf(record), begun),
      ),
    ];
    const account = person.account;
    if (account !== null) {
      const erased = AccountLifecycle.erase(nowUtcMs);
      writes.push(
        WriteOp.transition(
          [Collections.Users, account.id],
          {
            firstName: PrivacyMarker.TEXT,
            lastName: PrivacyMarker.TEXT,
            phone: null,
            email: null,
            birthDate: null,
            searchName: null,
            searchPrefixes: [],
            profileEditedAtUtcMs: null,
            ...erased,
          },
          WriteOp.variantFieldsToDelete(accountSliceOf(account), erased),
        ),
      );
    }
    writes.push(
      ...AuditSystem.createsOf(
        [
          erasureRow(
            AuditAction.PrivacyClientErasureStarted,
            record.id,
            census,
            actor,
            operationId,
            nowUtcMs,
            AuditSystem.changeKey.erasureStarted(record.id),
          ),
        ],
        hash,
      ),
    );
    return writes;
  },

  /**
   * THE CONTACT SWEEP (P3-DEP-28, P3-DEP-34) — run BEFORE the stamp clears
   * the values it matches on, one visit at a time: the visit's contact
   * cleared to {@link BookingContact.NONE} under the erasure's
   * `writeOperationId` whenever it carries one of the person's contact
   * values ({@link ClientPrivacySystem.contactCarriesValueOf}) — whether or
   * not the visit seats the person, and whatever its ids prove. After the
   * stamp the values are gone and a staff `REMOVE_SEAT` takes a visit out of
   * every footprint read, so a contact holding the person's values must be
   * cleared while those values still find it (P3-DEP-34). `[]` for a visit
   * whose contact carries none of them (its contact is
   * {@link ClientErasureSystem.visitWrites}' after the stamp, or not the
   * person's), with no contact, and once the values are gone.
   */
  contactSweepWrites(
    visit: Appointment,
    person: ClientPerson,
    operationId: OperationId,
  ): readonly WriteOp[] {
    if (!hasContact(visit)) return [];
    if (!ClientPrivacySystem.contactCarriesValueOf(visit, person)) return [];
    return [
      WriteOp.update([Collections.Appointments, visit.id], {
        ...BookingContact.NONE,
        writeOperationId: operationId,
      }),
    ];
  },

  /**
   * The id basis of the SWEPT row one act plans for a record — known before
   * the commit, so the pipeline probe-reads it in each sweep commit (the
   * re-sweep's idiom): an operation key, `AuditSystem.changeKey.erasureSweep`.
   */
  sweepRowIdBasis(customerId: CustomerId, operationId: OperationId): string {
    return AuditSystem.rowBasis(
      AuditAction.PrivacyClientErasureSwept,
      AuditResourceId.forCustomer(customerId),
      customerId,
      AuditSystem.changeKey.erasureSweep(operationId),
    );
  },

  /**
   * The pre-stamp sweep's audit row (P3-DEP-33) — planned INSIDE a sweep
   * commit, so the contacts it clears land with a row naming the act or not
   * at all (WS-1), even when the stamp never follows: ONE
   * `AuditAction.PrivacyClientErasureSwept` row holding the act's census
   * BEFORE (counts only), credited to the admin, the record its target. `[]`
   * for a record that is not `NONE` (no sweep runs after the stamp), when
   * the commit clears nothing (`sweepWriteCount`), or when the probe read
   * found this act's row (`rowPresent` — a later chunk, or a resumed call of
   * the same act, plans none).
   */
  sweepRowWrites(
    record: Customer,
    before: ErasureCensus,
    rowPresent: boolean,
    sweepWriteCount: number,
    actor: Actor,
    operationId: OperationId,
    nowUtcMs: UtcEpochMs,
    hash: (input: string) => string,
  ): readonly WriteOp[] {
    if (record.erasureStatus !== ErasureStatus.None) return [];
    if (rowPresent || sweepWriteCount === 0) return [];
    return AuditSystem.createsOf(
      [
        erasureRow(
          AuditAction.PrivacyClientErasureSwept,
          record.id,
          before,
          actor,
          operationId,
          nowUtcMs,
          AuditSystem.changeKey.erasureSweep(operationId),
        ),
      ],
      hash,
    );
  },

  /**
   * ONE visit's patch (P3-L-12, P3-RU-33) — `[]` when nothing of the
   * person is left on it (idempotent), and for a visit that does not seat
   * the person (its contact is the sweep's, before the stamp): the visit
   * contact cleared to {@link BookingContact.NONE}
   * when it is the person's or the visit is sole-subject (a contact that
   * carries the person's values is already the sweep's, P3-DEP-34 — this
   * clears the rest: a sole-subject visit's other contact, one the ids
   * prove whose values are not the person's stored ones); the
   * person's named walk-in seats marked `— <n>`; the patched visit stamped
   * with the erasure's `writeOperationId` (ids, times, money, statuses and
   * every other seat kept); and the visit's note removed when present —
   * any visit's, a party visit's too.
   */
  visitWrites(
    visit: Appointment,
    note: AppointmentNote | null,
    person: ClientPerson,
    operationId: OperationId,
    walkInHash: (input: string) => string,
  ): readonly WriteOp[] {
    const customerId = person.record.id;
    if (!visit.subjectCustomerIds.includes(customerId)) return [];
    const clearContact =
      hasContact(visit) &&
      (ClientPrivacySystem.isSoleSubject(visit, customerId) ||
        ClientPrivacySystem.contactIsPersons(visit, person, walkInHash));
    const seats = markedSeats(visit.seats, customerId);
    const writes: WriteOp[] = [];
    if (clearContact || seats !== null) {
      writes.push(
        WriteOp.update([Collections.Appointments, visit.id], {
          ...(clearContact ? BookingContact.NONE : {}),
          ...(seats === null ? {} : { seats }),
          writeOperationId: operationId,
        }),
      );
    }
    if (note !== null && note.id === visit.id) {
      writes.push(WriteOp.remove([Collections.AppointmentNotes, visit.id]));
    }
    return writes;
  },

  /**
   * The person's photos to delete (P3-L-10, P3-L-11): every photo naming
   * the record (any origin) and every photo naming nobody on a visit only
   * the person sat — each document removed once. FIRST, a `SHOT` photo's
   * object is listed for deletion — only when the document's `path` is the
   * object the photo owns, `appointmentPhotos/{appointmentId}/{id}` (the
   * document is staff-written: any other path, an empty one included, is
   * never handed to Storage, and its document still goes — P3-DEP-30); a
   * `LIBRARY` picture's object is the shop's and stays, its `clientLabel`
   * metadata listed to be cleared (a non-empty path; P3-DEP-31). Any other
   * photo is kept.
   */
  photoPlan(
    photos: readonly AppointmentPhoto[],
    soleSubjectVisitIds: ReadonlySet<AppointmentId>,
    person: ClientPerson,
  ): ErasurePhotoPlan {
    const customerId = person.record.id;
    const objectPaths: string[] = [];
    const labelPaths: string[] = [];
    const writes: WriteOp[] = [];
    const listed = ClientPrivacySystem.distinct(photos);
    for (let i = 0; i < listed.length; i++) {
      const photo = listed[i] as AppointmentPhoto;
      if (
        !ClientPrivacySystem.photoIsPersons(
          photo,
          soleSubjectVisitIds,
          customerId,
        )
      ) {
        continue;
      }
      if (PhotoOrigin.ownsBytes(photo.photoOrigin)) {
        if (photo.path === ownObjectPath(photo)) objectPaths.push(photo.path);
      } else if (typeof photo.path === 'string' && photo.path.length > 0) {
        // Read unguarded and staff-written: a missing or empty path names no object.
        labelPaths.push(photo.path);
      }
      writes.push(WriteOp.remove([Collections.AppointmentPhotos, photo.id]));
    }
    return { objectPaths, labelPaths, writes };
  },

  /**
   * The account's loose documents (P3-RU-24): its notifications and
   * waitlist requests removed; the invitations it sent with
   * `inviterName` → {@link PrivacyMarker.TEXT}; the impersonation sessions
   * that targeted it with `reason` → the marker — each once, only what is
   * the account's and still holds a value (idempotent). `[]` for a record
   * that links no account.
   */
  looseWrites(loose: ErasureLooseDocuments): readonly WriteOp[] {
    const userId = loose.person.record.userId;
    if (userId === null) return [];
    const writes: WriteOp[] = [];
    const notifications = ClientPrivacySystem.distinct(loose.notifications);
    for (let i = 0; i < notifications.length; i++) {
      writes.push(
        WriteOp.remove([
          Collections.Users,
          userId,
          Subcollections.Notifications,
          (notifications[i] as InboxNotification).id,
        ]),
      );
    }
    const requests = ClientPrivacySystem.distinct(loose.waitlistRequests);
    for (let i = 0; i < requests.length; i++) {
      const request = requests[i] as WaitlistRequest;
      if (request.ownerUserId !== userId) continue;
      writes.push(WriteOp.remove([Collections.WaitlistRequests, request.id]));
    }
    const invitations = ClientPrivacySystem.distinct(loose.invitations);
    for (let i = 0; i < invitations.length; i++) {
      const invitation = invitations[i] as Invitation;
      if (invitation.inviterUserId !== userId) continue;
      if (!holdsText(invitation.inviterName)) continue;
      writes.push(
        WriteOp.update([Collections.Invitations, invitation.id], {
          inviterName: PrivacyMarker.TEXT,
        }),
      );
    }
    const sessions = ClientPrivacySystem.distinct(loose.sessions);
    for (let i = 0; i < sessions.length; i++) {
      const session = sessions[i] as ImpersonationSession;
      if (session.targetUserId !== userId) continue;
      if (!holdsText(session.reason)) continue;
      writes.push(
        WriteOp.update([Collections.ImpersonationSessions, session.id], {
          reason: PrivacyMarker.TEXT,
        }),
      );
    }
    return writes;
  },

  /**
   * THE COMPLETION COMMIT (P3-RU-21) — `[]` unless the record is `ERASING`
   * and the residue census is complete: the record moves `ERASING →
   * ERASED` (+ `erasedAtUtcMs`, its start kept) under the erasure's
   * `writeOperationId`, and the `AuditAction.PrivacyClientErased` row carries the
   * residue (every personal count 0, beside what was retained). Keyed by
   * STATE (`AuditSystem.changeKey.erased`): one per record, ever.
   */
  completionWrites(
    record: Customer,
    residue: ErasureCensus,
    actor: Actor,
    operationId: OperationId,
    nowUtcMs: UtcEpochMs,
    hash: (input: string) => string,
  ): readonly WriteOp[] {
    if (record.erasureStatus !== ErasureStatus.Erasing) return [];
    if (!ClientErasureSystem.isComplete(residue)) return [];
    const erased = ErasureLifecycle.complete(record, nowUtcMs);
    return [
      WriteOp.transition(
        [Collections.Customers, record.id],
        { ...erased, writeOperationId: operationId },
        WriteOp.variantFieldsToDelete(erasureSliceOf(record), erased),
      ),
      ...AuditSystem.createsOf(
        [
          erasureRow(
            AuditAction.PrivacyClientErased,
            record.id,
            residue,
            actor,
            operationId,
            nowUtcMs,
            AuditSystem.changeKey.erased(record.id),
          ),
        ],
        hash,
      ),
    ];
  },

  /**
   * The id basis of the RESWEPT row one act plans for a record — known
   * before the commit, so the pipeline probe-reads it (the export row's
   * idiom): an operation key, `AuditSystem.changeKey.erasureResweep`.
   */
  resweepRowIdBasis(customerId: CustomerId, operationId: OperationId): string {
    return AuditSystem.rowBasis(
      AuditAction.PrivacyClientErasureReswept,
      AuditResourceId.forCustomer(customerId),
      customerId,
      AuditSystem.changeKey.erasureResweep(operationId),
    );
  },

  /**
   * An `ERASED` record's sweep found residue (P3-L-19): ONE
   * `AuditAction.PrivacyClientErasureReswept` row holding the census BEFORE the
   * sweep — `[]` for a record that is not `ERASED`, when the census holds
   * no personal value, or when the probe read found this act's row
   * (`rowPresent` — a replay plans none).
   */
  resweepWrites(
    record: Customer,
    before: ErasureCensus,
    rowPresent: boolean,
    actor: Actor,
    operationId: OperationId,
    nowUtcMs: UtcEpochMs,
    hash: (input: string) => string,
  ): readonly WriteOp[] {
    if (record.erasureStatus !== ErasureStatus.Erased) return [];
    if (rowPresent || !ClientErasureSystem.hasResidue(before)) return [];
    return AuditSystem.createsOf(
      [
        erasureRow(
          AuditAction.PrivacyClientErasureReswept,
          record.id,
          before,
          actor,
          operationId,
          nowUtcMs,
          AuditSystem.changeKey.erasureResweep(operationId),
        ),
      ],
      hash,
    );
  },
} as const;
