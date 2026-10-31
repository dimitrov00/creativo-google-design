import {
  Actor,
  type ClientPrivacyCall,
  type ErasureCensus,
  ErasureStatus,
  FlagName,
  type Role,
  Roles,
  type WriteOp,
} from '@core/components';
import {
  type PipelineError,
  PrivacyError,
  type RepositoryError,
} from '@core/errors';
import {
  type AppointmentId,
  AuditEntryId,
  type CustomerId,
  LogEvent,
  type OperationId,
  Result,
  type UserId,
  type UtcEpochMs,
} from '@core/primitives';
import {
  type Appointment,
  type AppointmentNote,
  Collections,
  type Customer,
  type ImpersonationSession,
  type Invitation,
  type Otp,
  type User,
} from '@core/entities';
import type {
  AuthEraserPorts,
  AuthRolesPorts,
  CallerRolesPorts,
  ClientFootprintPorts,
  ClockPorts,
  CommitPorts,
  FlagsPorts,
  HashPorts,
  ObjectEraserPorts,
  ReadTx,
  TelemetryPorts,
  WalkInKeyPorts,
} from '@core/ports';
import {
  ClientErasureSystem,
  type ClientPerson,
  ClientPrivacySystem,
  ERASURE_CHUNK_SIZE,
  ERASURE_MAX_DOCUMENTS,
  type ErasureFootprint,
  type ErasureLooseDocuments,
  WorkBudgetSystem,
} from '@core/systems';
import type { StepBudget } from './continue-policy-recompute.pipeline';
import type { ClientPrivacyCommand } from './export-client-data.pipeline';

/**
 * The admin's data-subject ERASURE of one client (audit-hardening Phase 3
 * WS-D; GDPR Art. 17, "pseudonymize, keep records"): `previewClientErasure`
 * (read-only — the census and the sibling records for the card's ONE alert)
 * and `eraseClient` (one resumable, budgeted call). Every step is a pure
 * function of the stored state (`ClientErasureSystem`), so a call resumes
 * whatever an earlier call — or a spent budget — left: one call
 *
 * 1. **Gate** — the `client.privacy` flag off → `PRIVACY_UNAVAILABLE`; the
 *    token's roles, then the caller's STORED roles, not the admin's
 *    (`Roles.PRIVACY`) → `PRIVACY_FORBIDDEN`; no record →
 *    `PRIVACY_CLIENT_NOT_FOUND`; a `userId` the record does not provably
 *    link → `PRIVACY_ACCOUNT_LINK_MISMATCH` before any read keyed by it
 *    (`ClientPrivacySystem.linkOf`); a staff role in the linked account's
 *    stored roles or Auth claims → `PRIVACY_ERASURE_STAFF_ACCOUNT`.
 * 2. **Footprint**, outside any transaction, every list at the cap + 1 —
 *    past it `PRIVACY_ERASURE_TOO_LARGE`, before any write; the census
 *    BEFORE. While the record is `NONE`, the visits whose contact carries
 *    one of the person's contact values (P3-DEP-28) and the sign-in
 *    challenges stored under them are listed too.
 * 3. **Sweeps** (record `NONE` only), before the stamp clears the values
 *    they are found by: the challenges removed (no row — a sign-in artefact
 *    with a TTL, P3-RU-21); then every contact that carries one of the
 *    person's contact values, whether or not its visit still seats them
 *    (`ClientErasureSystem.contactSweepWrites`, P3-DEP-28, P3-DEP-34 — after
 *    the stamp a desk `REMOVE_SEAT` would take it out of every read), in
 *    chunks of `ERASURE_CHUNK_SIZE`, each re-read and re-decided in its
 *    transaction, which also probes this act's
 *    `AuditAction.PrivacyClientErasureSwept` row and creates it in the first
 *    chunk that lands (the census BEFORE, P3-DEP-33 — so the clears are
 *    audited even if the stamp never lands), the budget looked at between
 *    them (always the first) — a spent budget answers "not done" BEFORE the
 *    stamp, so the next call finds the rest.
 * 4. **Stamp** — ONE commit, the record and the account read in it:
 *    `ClientErasureSystem.stampWrites` (empty unless `NONE`). From here every
 *    writer refuses the person. The STARTED row counts what is left at the
 *    stamp: a contact an EARLIER call swept is not in it — that act's SWEPT
 *    row holds it (plan §7 item 28).
 * 5. **Units**, each its own commit, the budget looked at between them
 *    (and the sweep's chunks): the visits whose patch is non-empty on the
 *    outside read, in chunks of `ERASURE_CHUNK_SIZE`, each re-read and
 *    re-decided in its transaction; the photos (the `SHOT` objects deleted
 *    and the `LIBRARY` objects' `clientLabel` cleared FIRST, the documents
 *    only once every object of the chunk is done); the account's loose
 *    documents. A spent budget answers "not done" with the residue.
 * 6. **Account and avatar** (linked only, idempotent): the `avatars/<uid>/`
 *    prefix deleted, then the Auth user (a failure answers its error).
 * 7. **Residue** — the footprint read again, the census AFTER. `ERASING`
 *    and complete → ONE completion commit (`ERASED` + the
 *    `AuditAction.PrivacyClientErased` row). Already `ERASED` with residue
 *    BEFORE → ONE commit probing this act's
 *    `AuditAction.PrivacyClientErasureReswept` row id
 *    and creating it when absent (P3-L-19).
 * 8. **Log** — one `info` line per answered call (ids, tags, counts), one
 *    more on completion; never a value, never an Auth or Storage message.
 */

export type PreviewClientErasurePorts = ClockPorts &
  HashPorts &
  WalkInKeyPorts &
  CallerRolesPorts &
  FlagsPorts &
  ClientFootprintPorts &
  AuthRolesPorts &
  TelemetryPorts;

export type EraseClientPorts = CommitPorts &
  ClockPorts &
  HashPorts &
  WalkInKeyPorts &
  CallerRolesPorts &
  FlagsPorts &
  ClientFootprintPorts &
  AuthRolesPorts &
  AuthEraserPorts &
  ObjectEraserPorts &
  TelemetryPorts;

/** The most documents any one list read returns — the cap and one, so a person past it is refused. */
const LIST_LIMIT = ERASURE_MAX_DOCUMENTS + 1;

/** The person admitted by the gate: the record, the uid it provably links, its account and the caller's stored roles. */
type Admitted = {
  readonly person: ClientPerson;
  /** The uid the record provably links (`linkOf`) — the uid-keyed steps run on it even when its account is gone. */
  readonly userId: UserId | null;
  readonly callerRoles: readonly Role[];
};

/** What one erasure read: the footprint, the challenges under the person's contact, the census BEFORE. */
type Read = {
  readonly footprint: ErasureFootprint;
  readonly soleSubjectVisitIds: ReadonlySet<AppointmentId>;
  readonly census: ErasureCensus;
};

type Refusal = PrivacyError | RepositoryError | PipelineError;

/** `ok([])` without a read — an account-keyed list of a record that links no account. */
async function none<E>(): Promise<Result<readonly E[], never>> {
  return Result.ok([]);
}

/** A list past the erasure's cap is refused whole, never truncated (P3-L-21). */
function capped<E>(
  listed: Result<readonly E[], RepositoryError>,
): Result<readonly E[], RepositoryError | PrivacyError> {
  if (!listed.ok) return listed;
  return listed.value.length > ERASURE_MAX_DOCUMENTS
    ? Result.err(PrivacyError.erasureTooLarge(listed.value.length))
    : listed;
}

/** `items` in slices of `size`, in order. */
function chunksOf<T>(items: readonly T[], size: number): readonly T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    out.push(items.slice(start, start + size));
  }
  return out;
}

/**
 * Steps 1 (the gate) — every refusal before any read of the person's
 * footprint, the link before any read keyed by its uid.
 */
async function admit(
  ports: PreviewClientErasurePorts,
  cmd: ClientPrivacyCommand,
): Promise<Result<Admitted, Refusal>> {
  if (!ports.flagOn(FlagName.ClientPrivacy)) {
    return Result.err(PrivacyError.unavailable());
  }
  if (!Roles.handlesClientPrivacy(cmd.callerRoles)) {
    return Result.err(PrivacyError.forbidden());
  }
  const stored = await ports.loadCallerRoles(cmd.callerUserId);
  if (!stored.ok) return stored;
  if (!Roles.handlesClientPrivacy(stored.value)) {
    return Result.err(PrivacyError.forbidden());
  }
  const loaded = await ports.loadClientRecord(cmd.customerId);
  if (!loaded.ok) return loaded;
  const record = loaded.value;
  if (record === null) return Result.err(PrivacyError.clientNotFound());
  const link = ClientPrivacySystem.linkOf(record, ports.hash);
  if (!link.ok) return link;
  const userId = link.value;
  if (userId === null) {
    return Result.ok({
      person: { record, account: null },
      userId,
      callerRoles: stored.value,
    });
  }
  const [account, authRoles] = await Promise.all([
    ports.loadProfile(userId),
    ports.loadAuthRoles(userId),
  ]);
  if (!account.ok) return account;
  if (!authRoles.ok) return authRoles;
  const person: ClientPerson = { record, account: account.value };
  const refusal = ClientErasureSystem.refusalOf(
    person,
    authRoles.value,
    ports.hash,
  );
  if (refusal !== null) return Result.err(refusal);
  return Result.ok({ person, userId, callerRoles: stored.value });
}

/**
 * Step 2 (and step 7's re-read) — the person's footprint, outside any
 * transaction, every list at the cap + 1: the visits that seat the record
 * and, while it is `NONE`, those whose contact carries one of its contact
 * values (P3-DEP-28; the union refused past the cap too), then the notes of
 * every visit that seats it and the photos (naming the record, and those of
 * the visits only the person sat), the account's loose documents (linked
 * only) and the journal's size. Then the census.
 */
async function readFootprint(
  ports: PreviewClientErasurePorts,
  person: ClientPerson,
  userId: UserId | null,
): Promise<Result<Read, RepositoryError | PrivacyError>> {
  const customerId = person.record.id;
  const seated = capped(await ports.listClientVisits(customerId, LIST_LIMIT));
  if (!seated.ok) return seated;
  const byContact: Appointment[] = [];
  if (person.record.erasureStatus === ErasureStatus.None) {
    const listed = await Promise.all(
      ClientPrivacySystem.contactValuesOf(person).map((value) =>
        ports.listVisitsByContact(value, LIST_LIMIT),
      ),
    );
    for (const list of listed) {
      const checked = capped(list);
      if (!checked.ok) return checked;
      byContact.push(...checked.value);
    }
  }
  const visits = capped(
    Result.ok(ClientPrivacySystem.distinct([...seated.value, ...byContact])),
  );
  if (!visits.ok) return visits;
  const visitIds: AppointmentId[] = [];
  const soleSubjectVisitIds = new Set<AppointmentId>();
  for (const visit of seated.value) {
    visitIds.push(visit.id);
    if (ClientPrivacySystem.isSoleSubject(visit, customerId)) {
      soleSubjectVisitIds.add(visit.id);
    }
  }
  const [
    notes,
    photosOfClient,
    visitPhotos,
    journal,
    notifications,
    waitlistRequests,
    invitations,
    sessions,
  ] = await Promise.all([
    visitIds.length === 0 ? none<never>() : ports.loadVisitNotes(visitIds),
    ports.listPhotosOfClient(customerId, LIST_LIMIT),
    soleSubjectVisitIds.size === 0
      ? none<never>()
      : ports.listVisitPhotos([...soleSubjectVisitIds], LIST_LIMIT),
    ports.listClientJournal(customerId, LIST_LIMIT),
    userId === null
      ? none<never>()
      : ports.listAccountNotifications(userId, LIST_LIMIT),
    userId === null
      ? none<never>()
      : ports.listAccountWaitlist(userId, LIST_LIMIT),
    userId === null
      ? none<never>()
      : ports.listAccountInvitations(userId, LIST_LIMIT),
    userId === null
      ? none<never>()
      : ports.listAccountSessions(userId, LIST_LIMIT),
  ]);
  if (!notes.ok) return notes;
  const ofClient = capped(photosOfClient);
  if (!ofClient.ok) return ofClient;
  const ofVisits = capped(visitPhotos);
  if (!ofVisits.ok) return ofVisits;
  const journalRows = capped(journal);
  if (!journalRows.ok) return journalRows;
  const inbox = capped(notifications);
  if (!inbox.ok) return inbox;
  const requests = capped(waitlistRequests);
  if (!requests.ok) return requests;
  const sent = capped(invitations);
  if (!sent.ok) return sent;
  const targeted = capped(sessions);
  if (!targeted.ok) return targeted;
  const footprint: ErasureFootprint = {
    person,
    visits: visits.value,
    notes: notes.value,
    photos: [...ofClient.value, ...ofVisits.value],
    notifications: inbox.value,
    waitlistRequests: requests.value,
    invitations: sent.value,
    sessions: targeted.value,
    journalCount: journalRows.value.length,
  };
  return Result.ok({
    footprint,
    soleSubjectVisitIds,
    census: ClientErasureSystem.census(footprint, ports.walkInHash),
  });
}

/** The person as stored NOW — the record and the account it links (re-read for step 7). */
async function rereadPerson(
  ports: PreviewClientErasurePorts,
  customerId: CustomerId,
  userId: UserId | null,
): Promise<Result<ClientPerson, RepositoryError | PrivacyError>> {
  const [record, account] = await Promise.all([
    ports.loadClientRecord(customerId),
    userId === null
      ? Promise.resolve(Result.ok(null))
      : ports.loadProfile(userId),
  ]);
  if (!record.ok) return record;
  if (!account.ok) return account;
  return record.value === null
    ? Result.err(PrivacyError.clientNotFound())
    : Result.ok({ record: record.value, account: account.value });
}

/**
 * `previewClientErasure` — read-only (P3-L-17): steps 1–2, their refusals
 * included, answering the record's tag, the census BEFORE and the sibling
 * walk-in records that exist (ids only — derivable only while the record
 * still holds its contact values, so `[]` after the stamp). No commit, no
 * row, no log line.
 */
export const previewClientErasure =
  (ports: PreviewClientErasurePorts) =>
  async (
    cmd: ClientPrivacyCommand,
  ): Promise<Result<ClientPrivacyCall.ErasurePreview, Refusal>> => {
    const admitted = await admit(ports, cmd);
    if (!admitted.ok) return admitted;
    const { person, userId } = admitted.value;
    const read = await readFootprint(ports, person, userId);
    if (!read.ok) return read;
    const siblings: CustomerId[] = [];
    if (person.record.erasureStatus === ErasureStatus.None) {
      const candidates = ClientPrivacySystem.siblingIdsOf(
        person,
        ports.walkInHash,
      );
      const found = await Promise.all(
        candidates.map((id) => ports.loadClientRecord(id)),
      );
      for (const sibling of found) {
        if (!sibling.ok) return sibling;
        if (sibling.value !== null) siblings.push(sibling.value.id);
      }
    }
    return Result.ok({
      erasureStatus: person.record.erasureStatus,
      erasureSiblingCustomerIds: siblings,
      ...read.value.census,
    });
  };

/** One unit of step 5 — a commit (or, for photos, the objects and then a commit); `false` when it left work behind. */
type Unit = () => Promise<Result<boolean, RepositoryError | PrivacyError>>;

/**
 * `eraseClient` — ONE resumable call of the erasure (see the module's
 * comment for its eight steps). `budget` is the call's allowance of new
 * work, started by the edge; the instant is read once, before the first
 * commit, and stamps every row and lifecycle field of the call.
 */
export const eraseClient =
  (ports: EraseClientPorts) =>
  async (
    cmd: ClientPrivacyCommand,
    budget: StepBudget,
  ): Promise<Result<ClientPrivacyCall.Erasure, Refusal>> => {
    // 1. The gate.
    const admitted = await admit(ports, cmd);
    if (!admitted.ok) return admitted;
    const { person, userId, callerRoles } = admitted.value;
    const record = person.record;
    const operationId: OperationId = cmd.operationId;
    const actor = Actor.forCaller(cmd.callerUserId, callerRoles);

    // 2. The footprint and the census BEFORE (and, while NONE, the challenges).
    const read = await readFootprint(ports, person, userId);
    if (!read.ok) return read;
    const before = read.value.census;
    let otps: readonly Otp[] = [];
    if (record.erasureStatus === ErasureStatus.None) {
      const listed = await Promise.all(
        ClientPrivacySystem.contactValuesOf(person).map((destination) =>
          ports.listOtpsByDestination(destination, LIST_LIMIT),
        ),
      );
      const found: Otp[] = [];
      for (const list of listed) {
        const checked = capped(list);
        if (!checked.ok) return checked;
        found.push(...checked.value);
      }
      otps = found;
    }
    const nowUtcMs: UtcEpochMs = ports.nowUtcMs();

    // 3. The sweeps, before the stamp clears the values they are found by:
    //    the challenges, then every contact carrying one of those values, the
    //    act's SWEPT row in the first chunk that lands (the budget looked at
    //    between chunks — spent, nothing stamped).
    for (const chunk of chunksOf(
      ClientErasureSystem.otpWrites(otps),
      ERASURE_CHUNK_SIZE,
    )) {
      const swept = await ports.commit(
        async () => null,
        (): Result<{ readonly writes: readonly WriteOp[] }, never> =>
          Result.ok({ writes: chunk }),
      );
      if (!swept.ok) return swept;
    }
    let handled = 0;
    let spent = false;
    if (record.erasureStatus === ErasureStatus.None) {
      const contacts: Appointment[] = [];
      for (const visit of read.value.footprint.visits) {
        if (
          ClientErasureSystem.contactSweepWrites(visit, person, operationId)
            .length > 0
        ) {
          contacts.push(visit);
        }
      }
      for (const chunk of chunksOf(contacts, ERASURE_CHUNK_SIZE)) {
        if (!WorkBudgetSystem.takesChunk(handled, () => budget.spent())) {
          spent = true;
          break;
        }
        const swept = await commitContactSweep(ports, chunk, {
          person,
          before,
          actor,
          operationId,
          nowUtcMs,
        });
        if (!swept.ok) return swept;
        handled++;
      }
    }

    // 4. The stamp: the record and the account cleared, the STARTED row —
    //    the census this call read: a contact an earlier call swept is not
    //    in it, that act's SWEPT row is (§7 item 28).
    let erasureStatus: ErasureStatus = record.erasureStatus;
    if (!spent && record.erasureStatus === ErasureStatus.None) {
      const stamped = await ports.commit(
        (tx) => readPerson(tx, record.id, userId),
        (
          fresh,
        ): Result<
          {
            readonly erasureStatus: ErasureStatus;
            readonly writes: readonly WriteOp[];
          },
          PrivacyError
        > => {
          if (fresh === null) return Result.err(PrivacyError.clientNotFound());
          const writes = ClientErasureSystem.stampWrites(
            fresh,
            before,
            actor,
            operationId,
            nowUtcMs,
            ports.hash,
          );
          return Result.ok({
            erasureStatus:
              writes.length > 0
                ? ErasureStatus.Erasing
                : fresh.record.erasureStatus,
            writes,
          });
        },
      );
      if (!stamped.ok) return stamped;
      erasureStatus = stamped.value.erasureStatus;
    }

    // 5. The units — only what is dirty on the outside read, the budget
    //    looked at between them and the sweep's chunks (always the first).
    const units = spent ? [] : unitsOf(ports, read.value, operationId);
    let leftWork = false;
    for (const unit of units) {
      if (!WorkBudgetSystem.takesChunk(handled, () => budget.spent())) {
        spent = true;
        break;
      }
      const done = await unit();
      if (!done.ok) return done;
      if (!done.value) leftWork = true;
      handled++;
    }

    // An ERASED record's sweep that found residue: ONE RESWEPT row per act.
    if (
      erasureStatus === ErasureStatus.Erased &&
      ClientErasureSystem.hasResidue(before)
    ) {
      const rowId = AuditEntryId.of(
        ports.hash(
          ClientErasureSystem.resweepRowIdBasis(record.id, operationId),
        ),
      );
      const reswept = await ports.commit(
        async (tx) => ({
          fresh: await tx.get<Customer>([Collections.Customers, record.id]),
          present: (await tx.get([Collections.AuditLog, rowId])) !== null,
        }),
        ({
          fresh,
          present,
        }): Result<{ readonly writes: readonly WriteOp[] }, never> =>
          Result.ok({
            writes:
              fresh === null
                ? []
                : ClientErasureSystem.resweepWrites(
                    fresh,
                    before,
                    present,
                    actor,
                    operationId,
                    nowUtcMs,
                    ports.hash,
                  ),
          }),
      );
      if (!reswept.ok) return reswept;
    }

    // 6. The avatar and the Auth user — only once the units are through.
    if (!spent && userId !== null) {
      const avatar = await ports.deleteStoredPrefix(`avatars/${userId}/`);
      if (!avatar.ok) leftWork = true;
      const auth = await ports.deleteAuthUser(userId);
      if (!auth.ok) return auth;
    }

    // 7. The residue: the footprint read again, the census AFTER.
    const now = await rereadPerson(ports, record.id, userId);
    if (!now.ok) return now;
    const after = await readFootprint(ports, now.value, userId);
    if (!after.ok) return after;
    const residue = after.value.census;
    erasureStatus = now.value.record.erasureStatus;
    let completed = false;
    if (
      !spent &&
      !leftWork &&
      erasureStatus === ErasureStatus.Erasing &&
      ClientErasureSystem.isComplete(residue)
    ) {
      const finished = await ports.commit(
        (tx) => tx.get<Customer>([Collections.Customers, record.id]),
        (
          fresh,
        ): Result<
          {
            readonly erasureStatus: ErasureStatus;
            readonly completed: boolean;
            readonly writes: readonly WriteOp[];
          },
          PrivacyError
        > => {
          if (fresh === null) return Result.err(PrivacyError.clientNotFound());
          const writes = ClientErasureSystem.completionWrites(
            fresh,
            residue,
            actor,
            operationId,
            nowUtcMs,
            ports.hash,
          );
          // An act that completed concurrently leaves this one nothing to plan.
          return Result.ok({
            erasureStatus:
              writes.length > 0 ? ErasureStatus.Erased : fresh.erasureStatus,
            completed: writes.length > 0,
            writes,
          });
        },
      );
      if (!finished.ok) return finished;
      completed = finished.value.completed;
      erasureStatus = finished.value.erasureStatus;
    }
    const erasureDone =
      erasureStatus === ErasureStatus.Erased &&
      !spent &&
      !leftWork &&
      ClientErasureSystem.isComplete(residue);

    // 8. The log — ids, tags and counts only.
    ports.log('info', LogEvent.PrivacyErasureStep, {
      customerId: record.id,
      erasureStatus,
      erasureDone,
      ...residue,
    });
    if (completed) {
      ports.log('info', LogEvent.PrivacyClientErased, {
        customerId: record.id,
        ...residue,
      });
    }
    return Result.ok({ erasureStatus, erasureDone, ...residue });
  };

/** The stamp's read: the record and the account it links, in ONE `getAll` — `null` when the record is gone. */
async function readPerson(
  tx: ReadTx,
  customerId: CustomerId,
  userId: UserId | null,
): Promise<ClientPerson | null> {
  if (userId === null) {
    const record = await tx.get<Customer>([Collections.Customers, customerId]);
    return record === null ? null : { record, account: null };
  }
  const [record, account] = await tx.getAll<Customer | User>([
    [Collections.Customers, customerId],
    [Collections.Users, userId],
  ]);
  return record === null || record === undefined
    ? null
    : {
        record: record as Customer,
        account: (account ?? null) as User | null,
      };
}

/** The unit list of step 5, in order: the dirty visits, the person's photos, the loose documents. */
function unitsOf(
  ports: EraseClientPorts,
  read: Read,
  operationId: OperationId,
): readonly Unit[] {
  const { footprint, soleSubjectVisitIds } = read;
  const person = footprint.person;
  const units: Unit[] = [];

  // The visits whose patch is non-empty on the outside read — re-read and
  // re-decided in their own transaction (a visit cleaned meanwhile plans []).
  const notes = new Map<AppointmentId, AppointmentNote>();
  for (const note of footprint.notes) notes.set(note.id, note);
  const dirty: Appointment[] = [];
  for (const visit of footprint.visits) {
    if (
      ClientErasureSystem.visitWrites(
        visit,
        notes.get(visit.id) ?? null,
        person,
        operationId,
        ports.walkInHash,
      ).length > 0
    ) {
      dirty.push(visit);
    }
  }
  for (const chunk of chunksOf(dirty, ERASURE_CHUNK_SIZE)) {
    units.push(async () => {
      const paths: string[][] = [];
      for (const visit of chunk) {
        paths.push([Collections.Appointments, visit.id]);
        paths.push([Collections.AppointmentNotes, visit.id]);
      }
      const committed = await ports.commit(
        (tx) => tx.getAll<Appointment | AppointmentNote>(paths),
        (docs): Result<{ readonly writes: readonly WriteOp[] }, never> => {
          const writes: WriteOp[] = [];
          for (let i = 0; i < chunk.length; i++) {
            const fresh = (docs[2 * i] ?? null) as Appointment | null;
            const note = (docs[2 * i + 1] ?? null) as AppointmentNote | null;
            // No writer deletes a visit; one gone meanwhile leaves nothing to patch.
            if (fresh === null) continue;
            writes.push(
              ...ClientErasureSystem.visitWrites(
                fresh,
                note,
                person,
                operationId,
                ports.walkInHash,
              ),
            );
          }
          return Result.ok({ writes });
        },
      );
      return committed.ok ? Result.ok(true) : committed;
    });
  }

  // The photos: every SHOT object of a chunk deleted and every LIBRARY
  // object's label cleared FIRST; the documents only once all of them are
  // done (a failure keeps the paths for a resume).
  const photos = ClientErasureSystem.photoPlan(
    footprint.photos,
    soleSubjectVisitIds,
    person,
  );
  if (photos.writes.length > 0) {
    const listed = ClientPrivacySystem.distinct(footprint.photos);
    for (const chunk of chunksOf(listed, ERASURE_CHUNK_SIZE)) {
      const plan = ClientErasureSystem.photoPlan(
        chunk,
        soleSubjectVisitIds,
        person,
      );
      if (plan.writes.length === 0) continue;
      units.push(async () => {
        let objectsDone = true;
        for (const path of plan.objectPaths) {
          const deleted = await ports.deleteStoredObject(path);
          if (!deleted.ok) objectsDone = false;
        }
        for (const path of plan.labelPaths) {
          const cleared = await ports.clearStoredLabel(path);
          if (!cleared.ok) objectsDone = false;
        }
        if (!objectsDone) return Result.ok(false);
        const committed = await ports.commit(
          async () => null,
          (): Result<{ readonly writes: readonly WriteOp[] }, never> =>
            Result.ok({ writes: plan.writes }),
        );
        return committed.ok ? Result.ok(true) : committed;
      });
    }
  }

  // The loose documents: removals as they are; the marks re-decided on the
  // documents read in the transaction (an Update of a document gone would fail).
  const empty: ErasureLooseDocuments = {
    person,
    notifications: [],
    waitlistRequests: [],
    invitations: [],
    sessions: [],
  };
  const removals = ClientErasureSystem.looseWrites({
    ...empty,
    notifications: footprint.notifications,
    waitlistRequests: footprint.waitlistRequests,
  });
  for (const chunk of chunksOf(removals, ERASURE_CHUNK_SIZE)) {
    units.push(async () => {
      const committed = await ports.commit(
        async () => null,
        (): Result<{ readonly writes: readonly WriteOp[] }, never> =>
          Result.ok({ writes: chunk }),
      );
      return committed.ok ? Result.ok(true) : committed;
    });
  }
  const invitations: Invitation[] = [];
  for (const invitation of footprint.invitations) {
    if (
      ClientErasureSystem.looseWrites({ ...empty, invitations: [invitation] })
        .length > 0
    ) {
      invitations.push(invitation);
    }
  }
  const sessions: ImpersonationSession[] = [];
  for (const session of footprint.sessions) {
    if (
      ClientErasureSystem.looseWrites({ ...empty, sessions: [session] })
        .length > 0
    ) {
      sessions.push(session);
    }
  }
  for (const chunk of chunksOf(invitations, ERASURE_CHUNK_SIZE)) {
    units.push(() =>
      commitMarks(ports, chunk, Collections.Invitations, (fresh) => ({
        ...empty,
        invitations: fresh,
      })),
    );
  }
  for (const chunk of chunksOf(sessions, ERASURE_CHUNK_SIZE)) {
    units.push(() =>
      commitMarks(ports, chunk, Collections.ImpersonationSessions, (fresh) => ({
        ...empty,
        sessions: fresh,
      })),
    );
  }
  return units;
}

/** What one act's contact sweep decides with — the person as read BEFORE the stamp, the census BEFORE, the act. */
type SweepAct = {
  readonly person: ClientPerson;
  readonly before: ErasureCensus;
  readonly actor: Actor;
  readonly operationId: OperationId;
  readonly nowUtcMs: UtcEpochMs;
};

/**
 * One chunk of the contact sweep (step 3): its visits read in the
 * transaction, each one's contact re-decided on what is stored NOW against
 * the person read before the stamp (a visit edited meanwhile plans what it
 * holds; one gone plans nothing), beside a probe of this act's SWEPT row —
 * created with the first chunk that clears anything, so the clears land
 * with their row or not at all (P3-DEP-33).
 */
async function commitContactSweep(
  ports: EraseClientPorts,
  chunk: readonly Appointment[],
  act: SweepAct,
): Promise<Result<true, RepositoryError>> {
  const { person, before, actor, operationId, nowUtcMs } = act;
  const record = person.record;
  const rowPath = [
    Collections.AuditLog,
    AuditEntryId.of(
      ports.hash(ClientErasureSystem.sweepRowIdBasis(record.id, operationId)),
    ),
  ];
  const paths: string[][] = [];
  for (const visit of chunk) paths.push([Collections.Appointments, visit.id]);
  const committed = await ports.commit(
    async (tx) => ({
      visits: await tx.getAll<Appointment>(paths),
      present: (await tx.get(rowPath)) !== null,
    }),
    ({
      visits,
      present,
    }): Result<{ readonly writes: readonly WriteOp[] }, never> => {
      const writes: WriteOp[] = [];
      for (const fresh of visits) {
        if (fresh === null) continue;
        writes.push(
          ...ClientErasureSystem.contactSweepWrites(fresh, person, operationId),
        );
      }
      writes.push(
        ...ClientErasureSystem.sweepRowWrites(
          record,
          before,
          present,
          writes.length,
          actor,
          operationId,
          nowUtcMs,
          ports.hash,
        ),
      );
      return Result.ok({ writes });
    },
  );
  return committed.ok ? Result.ok(true) : committed;
}

/** One chunk of marks: its documents read in the transaction, the marks decided on what is still there. */
async function commitMarks<E extends { readonly id: string }>(
  ports: EraseClientPorts,
  chunk: readonly E[],
  collection: string,
  looseOf: (fresh: readonly E[]) => ErasureLooseDocuments,
): Promise<Result<boolean, RepositoryError>> {
  const paths: string[][] = [];
  for (const document of chunk) paths.push([collection, document.id]);
  const committed = await ports.commit(
    (tx) => tx.getAll<E>(paths),
    (docs): Result<{ readonly writes: readonly WriteOp[] }, never> => {
      const present: E[] = [];
      for (const doc of docs) if (doc !== null) present.push(doc);
      return Result.ok({
        writes: ClientErasureSystem.looseWrites(looseOf(present)),
      });
    },
  );
  return committed.ok ? Result.ok(true) : committed;
}
