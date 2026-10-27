import {
  Actor,
  AuditAction,
  BlockKind,
  BookingPolicy,
  CustomerOrigin,
  type DocBody,
  type DocPath,
  E164,
  Email,
  LocationStatus,
  MinuteBlock,
  SeatSubject,
  WriteAction,
  type WriteOp,
  type BookingCall,
  RequestedSubjectRole,
  WriteProvenance,
} from '@core/components';
import {
  AppointmentId,
  BarberBusyDayId,
  BusyKey,
  CustomerId,
  LogEvent,
  OperationId,
  Result,
  UserId,
} from '@core/primitives';
import {
  BookingError,
  BookingErrorCode,
  type RepositoryError,
  RepositoryError as RepoError,
  RepositoryErrorCode,
  TimeErrorCode,
} from '@core/errors';
import {
  type AccountContact,
  type AuditEntry,
  type BarberBusyDay,
  Collections,
  type Customer,
  Profile,
} from '@core/entities';
import type { CommitPlan } from '@core/ports';
import {
  AuditSystem,
  DecisionInputSystem,
  SearchFieldsSystem,
  ZonedTimeSystem,
} from '@core/systems';
import {
  at,
  auditRowsOf,
  barberBusyDayFixture,
  barberScheduleFixture,
  contendedCommit,
  deepFreeze,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  fixtureHash,
  fixtureWalkInHash,
  localDate,
  locationFixture,
  memoryCommitPlan,
  memoryStore,
  memoryTxPorts,
  minute,
  recordingCommit,
  recordingTelemetry,
  serviceFixture,
  until,
  utcMs,
} from '@core/testing';
import {
  type BookAppointmentCommand,
  bookAppointment,
  frameWallClock,
} from './book-appointment.pipeline';

const TOMORROW = localDate('2026-09-29');
const TEN = utcMs('2026-09-29T10:00:00.000+03:00');
const ATTEMPT = AppointmentId.of('attempt-0123456789abcdef');
const BUSY_KEY = BusyKey.of(FIXTURE_IDS.barber, TOMORROW);

const MARIA: AccountContact = {
  firstName: 'Maria',
  lastName: 'Ivanova',
  phone: null,
  email: null,
};

function bodyOf<E extends { readonly id: string }>(entity: E): DocBody {
  const { id: _id, ...body } = entity;
  return body;
}

function catalogue(locationStatus: LocationStatus = LocationStatus.Active) {
  return [
    {
      path: [Collections.Locations, FIXTURE_IDS.location],
      body: bodyOf(locationFixture({ locationStatus })),
    },
    {
      path: [Collections.Services, FIXTURE_IDS.service],
      body: bodyOf(serviceFixture()),
    },
    {
      path: [Collections.BarberSchedules, FIXTURE_IDS.barber],
      body: bodyOf(barberScheduleFixture()),
    },
  ];
}

/** One seat at 10:00 on tomorrow's wall clock — the call carries the minute, never an instant. */
const SEAT: BookingCall.SeatInput = {
  lineId: 'line-1',
  serviceId: FIXTURE_IDS.service,
  variantId: null,
  barberId: FIXTURE_IDS.barber,
  barberPreference: null,
  startMinutes: 600,
  subject: { requestedSubjectRole: RequestedSubjectRole.Self },
};

function command(
  extra: Partial<BookAppointmentCommand> = {},
): BookAppointmentCommand {
  return {
    locationId: FIXTURE_IDS.location,
    localDate: TOMORROW,
    seats: [SEAT],
    attemptId: ATTEMPT,
    operationId: OperationId.of(ATTEMPT),
    bookedFromAppointmentId: null,
    contact: null,
    ownerUserId: FIXTURE_IDS.client,
    staffPlacement: false,
    actor: Actor.user(FIXTURE_IDS.client),
    ...extra,
  };
}

function rig(
  documents: readonly { readonly path: DocPath; readonly body: DocBody }[],
  options: {
    readonly commit?: (base: CommitPlan) => CommitPlan;
    readonly policy?: Result<BookingPolicy, RepositoryError>;
  } = {},
) {
  const store = memoryStore(documents);
  const tx = memoryTxPorts(store);
  // The rows the LANDED plans created (WS-1: inside the act's commit).
  const rows: AuditEntry[] = [];
  const contactsAsked: (readonly UserId[])[] = [];
  const telemetry = recordingTelemetry();
  const recorded = recordingCommit(
    options.commit === undefined ? tx.commit : options.commit(tx.commit),
  );
  const pipeline = bookAppointment({
    ...tx,
    commit: recorded.commit,
    walkInHash: fixtureWalkInHash,
    ...telemetry,
    loadPolicy: async () => options.policy ?? Result.ok(BookingPolicy.DEFAULT),
    loadAccountContacts: async (userIds) => {
      contactsAsked.push(userIds);
      return Result.ok(new Map([[FIXTURE_IDS.client, MARIA]]));
    },
  });
  const run: typeof pipeline = async (cmd) => {
    const answer = await pipeline(cmd);
    rows.splice(0, rows.length, ...auditRowsOf(recorded.applied));
    return answer;
  };
  return { store, tx, rows, telemetry, contactsAsked, run };
}

/** The row a commit of {@link ATTEMPT} files for the client's record (`attempt:<attemptId>`). */
const BOOK_ROW = fixtureHash(
  AuditSystem.rowBasis(
    AuditAction.BookingCommitted,
    ATTEMPT,
    FIXTURE_IDS.customer,
    `attempt:${ATTEMPT}`,
  ),
);

const CUSTOMER_PATH = `${Collections.Customers}/${FIXTURE_IDS.customer}`;

function writeKeys(
  plan: readonly WriteOp[],
  collection: string,
): readonly string[] {
  return plan
    .filter((op) => op.path[0] === collection)
    .map((op) => op.path.join('/'));
}

describe('bookAppointment', () => {
  it('commits ONE plan — the appointment Create, the busy Set, the FIRST_BOOKING customer Create and, last, the act’s row (WS-1)', async () => {
    const { store, tx, rows, contactsAsked, run } = rig(catalogue());
    const answer = await run(command());
    expect(answer).toEqual({
      ok: true,
      value: { appointmentId: ATTEMPT, replayed: false },
    });
    expect(tx.plans).toHaveLength(1);
    const plan = tx.plans[0] ?? [];
    expect(plan.map((op) => [op.writeAction, op.path.join('/')])).toEqual([
      [WriteAction.Create, `${Collections.Appointments}/${ATTEMPT}`],
      [WriteAction.Set, `${Collections.BarberBusy}/${BUSY_KEY}`],
      [WriteAction.Create, CUSTOMER_PATH],
      [WriteAction.Create, `${Collections.AuditLog}/${BOOK_ROW}`],
    ]);
    expect(plan.at(-1)).toEqual({
      writeAction: WriteAction.Create,
      path: [Collections.AuditLog, BOOK_ROW],
      body: {
        recordedAtUtcMs: FIXTURE_NOW_UTC_MS,
        resourceId: ATTEMPT,
        auditOperationId: ATTEMPT,
        ...Actor.user(FIXTURE_IDS.client),
        auditAction: AuditAction.BookingCommitted,
        placementLocationId: FIXTURE_IDS.location,
        auditTarget: 'CUSTOMER',
        targetCustomerId: FIXTURE_IDS.customer,
      },
    });
    const appointment = store.get(`${Collections.Appointments}/${ATTEMPT}`);
    expect(appointment).toMatchObject({
      locationId: FIXTURE_IDS.location,
      localDate: TOMORROW,
      startMinutes: at(10),
      utcEpochMs: TEN,
      bookingStatus: 'CONFIRMED',
      confirmedAtUtcMs: FIXTURE_NOW_UTC_MS,
      bookedAtUtcMs: FIXTURE_NOW_UTC_MS,
      ownerUserId: FIXTURE_IDS.client,
      ownerCustomerId: FIXTURE_IDS.customer,
      subjectCustomerIds: [FIXTURE_IDS.customer],
      placement: 'SELF',
      // WS-4.3: the call that wrote it — its operation id.
      writeOperationId: OperationId.of(ATTEMPT),
    });
    expect(appointment).not.toHaveProperty('id');
    expect(store.get(`${Collections.BarberBusy}/${BUSY_KEY}`)).toEqual({
      barberId: FIXTURE_IDS.barber,
      localDate: TOMORROW,
      utcEpochMs: ZonedTimeSystem.startOfLocalDay(TOMORROW, FIXTURE_TIME_ZONE),
      blocks: [MinuteBlock.of(at(10), until(10, 30), BlockKind.Busy)],
    });
    const expected: Omit<Customer, 'id'> = {
      userId: FIXTURE_IDS.client,
      displayName: Profile.fullName(MARIA),
      phone: null,
      email: null,
      ...SearchFieldsSystem.searchFields('Maria', 'Ivanova', null, null),
      createdAtUtcMs: FIXTURE_NOW_UTC_MS,
      customerOrigin: CustomerOrigin.FirstBooking,
      writeOperationId: OperationId.of(ATTEMPT),
    };
    expect(store.get(CUSTOMER_PATH)).toEqual(expected);
    // The contact snapshot is read OUTSIDE the transaction, for the cart's accounts.
    expect(contactsAsked).toEqual([[FIXTURE_IDS.client]]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      auditAction: AuditAction.BookingCommitted,
      placementLocationId: FIXTURE_IDS.location,
      targetCustomerId: FIXTURE_IDS.customer,
    });
    expect(rows[0]?.id).toBe(
      fixtureHash(
        AuditSystem.rowBasis(
          AuditAction.BookingCommitted,
          ATTEMPT,
          FIXTURE_IDS.customer,
          AuditSystem.changeKey.attempt(ATTEMPT),
        ),
      ),
    );
  });

  it('keys the row `attempt:<attemptId>` — byte for byte today’s key, the id now required (WS-4.1, DEP-4)', async () => {
    const { rows, run } = rig(catalogue());
    expect((await run(command())).ok).toBe(true);
    expect(rows.map((row) => row.id)).toEqual([
      fixtureHash(
        AuditSystem.rowBasis(
          AuditAction.BookingCommitted,
          ATTEMPT,
          FIXTURE_IDS.customer,
          'attempt:attempt-0123456789abcdef',
        ),
      ),
    ]);
  });

  it('reads the attempt FIRST, then the customer record inside the phase-one getAll — never users/{uid}', async () => {
    const { tx, run } = rig(catalogue());
    await run(command());
    const reads = tx.transactions[0]?.reads.map((path) => path.join('/')) ?? [];
    expect(reads[0]).toBe(`${Collections.Appointments}/${ATTEMPT}`);
    expect(reads.slice(1, 5)).toEqual([
      `${Collections.Locations}/${FIXTURE_IDS.location}`,
      `${Collections.Services}/${FIXTURE_IDS.service}`,
      `${Collections.BarberSchedules}/${FIXTURE_IDS.barber}`,
      CUSTOMER_PATH,
    ]);
    expect(reads.slice(5)).toEqual([
      `${Collections.BarberBusy}/${BUSY_KEY}`,
      `${Collections.ScheduleExceptions}/${BUSY_KEY}`,
    ]);
    expect(reads.some((path) => path.startsWith(`${Collections.Users}/`))).toBe(
      false,
    );
  });

  it('merges the busy Set onto the EXACT busy body it read, and writes only keys it read', async () => {
    const stored = barberBusyDayFixture({
      id: BarberBusyDayId.of(BUSY_KEY),
      localDate: TOMORROW,
      blocks: [MinuteBlock.of(at(12), until(12, 30), BlockKind.Busy)],
    });
    const { store, tx, run } = rig([
      ...catalogue(),
      { path: [Collections.BarberBusy, BUSY_KEY], body: bodyOf(stored) },
    ]);
    await run(command());
    expect(
      store.get(`${Collections.BarberBusy}/${BUSY_KEY}`)?.['blocks'],
    ).toEqual([
      MinuteBlock.of(at(10), until(10, 30), BlockKind.Busy),
      MinuteBlock.of(at(12), until(12, 30), BlockKind.Busy),
    ]);
    const read = new Set(
      tx.transactions[0]?.reads.map((path) => path.join('/')),
    );
    for (const key of writeKeys(tx.plans[0] ?? [], Collections.BarberBusy)) {
      expect(read.has(key)).toBe(true);
    }
  });

  it('creates no customer record when the transaction read one', async () => {
    const existing: Omit<Customer, 'id'> = {
      userId: FIXTURE_IDS.client,
      displayName: 'Maria I.',
      phone: null,
      email: null,
      searchName: 'maria i.',
      searchPrefixes: [],
      createdAtUtcMs: FIXTURE_NOW_UTC_MS,
      customerOrigin: CustomerOrigin.Seed,
      ...WriteProvenance.NONE,
    };
    const { store, tx, run } = rig([
      ...catalogue(),
      { path: [Collections.Customers, FIXTURE_IDS.customer], body: existing },
    ]);
    await run(command());
    expect(writeKeys(tx.plans[0] ?? [], Collections.Customers)).toEqual([]);
    expect(store.get(CUSTOMER_PATH)).toEqual(existing);
  });

  it('answers a replayed attempt with its original booking — nothing written, ZERO audit ops planned (WS-1)', async () => {
    const first = rig(catalogue());
    await first.run(command());
    const replay = rig(
      [...first.store].map(([key, body]) => ({ path: key.split('/'), body })),
    );
    const answer = await replay.run(command());
    expect(answer).toEqual({
      ok: true,
      value: { appointmentId: ATTEMPT, replayed: true },
    });
    expect(replay.tx.plans).toEqual([[]]);
    expect(replay.tx.transactions[0]?.reads).toEqual([
      [Collections.Appointments, ATTEMPT],
    ]);
    expect(first.rows.map((row) => row.id)).toEqual([BOOK_ROW]);
    expect(replay.rows).toEqual([]);
    // The first commit's row is still the one row on the store.
    expect(replay.store.has(`${Collections.AuditLog}/${BOOK_ROW}`)).toBe(true);
  });

  it('the same command twice on one store: the second is the replay — the same answer’s id, ZERO audit ops', async () => {
    const { tx, rows, run } = rig(catalogue());
    const first = await run(command());
    const second = await run(command());
    expect(first).toEqual({
      ok: true,
      value: { appointmentId: ATTEMPT, replayed: false },
    });
    expect(second).toEqual({
      ok: true,
      value: { appointmentId: ATTEMPT, replayed: true },
    });
    expect(tx.plans[1]).toEqual([]);
    expect(rows.map((row) => row.id)).toEqual([BOOK_ROW]);
  });

  it('commits the booking without a row when no verified actor is known, and logs it loudly', async () => {
    const { store, tx, rows, telemetry, run } = rig(catalogue());
    const answer = await run(command({ actor: null }));
    expect(answer.ok).toBe(true);
    expect(store.has(`${Collections.Appointments}/${ATTEMPT}`)).toBe(true);
    expect(
      (tx.plans[0] ?? []).some((op) => op.path[0] === Collections.AuditLog),
    ).toBe(false);
    expect(rows).toEqual([]);
    expect(telemetry.lines).toEqual([
      {
        level: 'error',
        msg: LogEvent.AuditActorMissing,
        fields: {
          action: AuditAction.BookingCommitted,
          resourceId: ATTEMPT,
        },
      },
    ]);
  });

  it('a Create of a row already there refuses the WHOLE booking as REPOSITORY_ALREADY_EXISTS — nothing applied, never retried', async () => {
    const { store, tx, run } = rig([
      ...catalogue(),
      { path: [Collections.AuditLog, BOOK_ROW], body: { seeded: true } },
    ]);
    const answer = await run(command());
    expect(!answer.ok && answer.error.errorCode).toBe(
      RepositoryErrorCode.AlreadyExists,
    );
    expect(store.has(`${Collections.Appointments}/${ATTEMPT}`)).toBe(false);
    expect(store.has(CUSTOMER_PATH)).toBe(false);
    expect(store.has(`${Collections.BarberBusy}/${BUSY_KEY}`)).toBe(false);
    expect(tx.plans).toEqual([]);
    // Only a customer-record collision re-runs the transaction.
    expect(tx.transactions).toHaveLength(1);
  });

  it('a contention re-run of the decision derives the identical rows — the ids from the attempt, never a mint', async () => {
    const seen: { decisions: readonly (readonly WriteOp[])[] } = {
      decisions: [],
    };
    const { run } = rig(catalogue(), {
      commit: (base) => {
        const contended = contendedCommit(base);
        seen.decisions = contended.decisions;
        return contended.commit;
      },
    });
    expect((await run(command())).ok).toBe(true);
    const decisions = seen.decisions;
    expect(decisions).toHaveLength(2);
    // The seat ids are minted (`nextId`) per decision; the rows are not.
    const auditOf = (plan: readonly WriteOp[] | undefined) =>
      (plan ?? []).filter((op) => op.path[0] === Collections.AuditLog);
    expect(auditOf(decisions[0])).toHaveLength(1);
    expect(auditOf(decisions[1])).toEqual(auditOf(decisions[0]));
  });

  it('a customer Create that meets a record created meanwhile re-runs the transaction ONCE — it re-reads and books', async () => {
    let attempts = 0;
    const docs = catalogue();
    const store = memoryStore(docs);
    const { commit } = memoryCommitPlan(store);
    const racing: CommitPlan = (read, decide) => {
      attempts += 1;
      return commit(async (tx) => {
        const snapshot = await read(tx);
        if (attempts === 1) {
          // A concurrent first booking of the same account lands here.
          store.set(CUSTOMER_PATH, { userId: FIXTURE_IDS.client });
        }
        return snapshot;
      }, decide);
    };
    const { rows, run } = rig(docs, { commit: () => racing });
    const answer = await run(command());
    expect(attempts).toBe(2);
    expect(answer).toEqual({
      ok: true,
      value: { appointmentId: ATTEMPT, replayed: false },
    });
    expect(rows).toHaveLength(1);
  });

  it('a second ALREADY_EXISTS on the customer path is the answer — neither booked nor replayed, and no row', async () => {
    let attempts = 0;
    const conflicted: CommitPlan = async () => {
      attempts += 1;
      return Result.err(RepoError.alreadyExists(CUSTOMER_PATH));
    };
    const { rows, run } = rig(catalogue(), { commit: () => conflicted });
    const answer = await run(command());
    expect(attempts).toBe(2);
    expect(answer.ok).toBe(false);
    expect(!answer.ok && answer.error.errorCode).toBe(
      RepositoryErrorCode.AlreadyExists,
    );
    expect(rows).toEqual([]);
  });

  it('refuses a client booking with no verified owner before reading anything (UNAUTHENTICATED)', async () => {
    const { tx, run } = rig(catalogue());
    const answer = await run(command({ ownerUserId: null }));
    expect(!answer.ok && answer.error.errorCode).toBe(
      BookingErrorCode.Unauthenticated,
    );
    expect(tx.transactions).toEqual([]);
  });

  it('a client’s booking arrives only at a listed shop; the shop’s own placement at any, CONFIRMED and owner-less for a walk-in', async () => {
    const client = rig(catalogue(LocationStatus.Hidden));
    const refused = await client.run(command());
    expect(!refused.ok && refused.error).toMatchObject({
      errorCode: BookingErrorCode.InvalidInput,
      field: 'locationId',
      reason: 'unlisted',
    });
    const staff = rig(catalogue(LocationStatus.Hidden));
    const placed = await staff.run(
      command({
        staffPlacement: true,
        ownerUserId: null,
        seats: [
          {
            ...SEAT,
            subject: {
              requestedSubjectRole: RequestedSubjectRole.Guest,
              label: 'Walk-in',
              guestKey: null,
              contact: null,
            },
          },
        ],
        actor: Actor.staff(UserId.of('u-staff'), []),
      }),
    );
    expect(placed.ok).toBe(true);
    const id = placed.ok ? placed.value.appointmentId : '';
    expect(staff.store.get(`${Collections.Appointments}/${id}`)).toMatchObject({
      ownerUserId: null,
      ownerCustomerId: null,
      placement: 'STAFF',
      bookingStatus: 'CONFIRMED',
    });
    expect(staff.rows[0]?.auditAction).toBe(AuditAction.BookingStaffCreated);
    expect(staff.rows[0]?.auditTarget).toBe('NONE');
  });

  it('refuses a shop that is not there — and, as an invalid request, one whose id no document could bear, unread (DEP-F31)', async () => {
    const { tx, run } = rig([]);
    const missing = await run(command());
    expect(!missing.ok && missing.error).toMatchObject({
      field: 'locationId',
      reason: 'not_found',
    });
    const unreadable = await run(command({ locationId: 'a/b' }));
    expect(!unreadable.ok && unreadable.error).toEqual({
      errorCode: 'BOOKING_INVALID_INPUT',
      field: 'locationId',
      detail: null,
      reason: null,
    });
    expect(tx.transactions[1]?.reads).toEqual([
      [Collections.Appointments, ATTEMPT],
    ]);
    // A reserved name is the parse's refusal too (OR-44): never read.
    for (const [i, locationId] of ['.', '..', '__x__'].entries()) {
      const reserved = await run(command({ locationId }));
      expect(!reserved.ok && reserved.error, locationId).toMatchObject({
        field: 'locationId',
        reason: null,
      });
      expect(tx.transactions[2 + i]?.reads, locationId).toEqual([
        [Collections.Appointments, ATTEMPT],
      ]);
    }
  });

  it('refuses a time somebody else holds (SLOT_UNAVAILABLE), writing nothing', async () => {
    const taken = barberBusyDayFixture({
      id: BarberBusyDayId.of(BUSY_KEY),
      localDate: TOMORROW,
      blocks: [MinuteBlock.of(at(10), until(11), BlockKind.Busy)],
    });
    const { tx, run } = rig([
      ...catalogue(),
      { path: [Collections.BarberBusy, BUSY_KEY], body: bodyOf(taken) },
    ]);
    const answer = await run(command());
    expect(!answer.ok && answer.error.errorCode).toBe(
      BookingErrorCode.SlotUnavailable,
    );
    expect(tx.plans).toEqual([]);
  });

  it('logs what the refused decision read — the LAST snapshot, handed to `decide` frozen and refused alike (WS-4.2, DEP-18)', async () => {
    const taken = barberBusyDayFixture({
      id: BarberBusyDayId.of(BUSY_KEY),
      localDate: TOMORROW,
      blocks: [MinuteBlock.of(at(10), until(11), BlockKind.Busy)],
    });
    // Every snapshot the read hands `decide` is frozen all the way down: a
    // decision that wrote into its input would throw instead of refusing.
    let lastSeen: unknown = null;
    const { tx, telemetry, run } = rig(
      [
        ...catalogue(),
        { path: [Collections.BarberBusy, BUSY_KEY], body: bodyOf(taken) },
      ],
      {
        commit: (base) => (read, decide) =>
          base(async (readTx) => {
            const snapshot = deepFreeze(await read(readTx));
            lastSeen = snapshot;
            return snapshot;
          }, decide),
      },
    );
    const answer = await run(command());
    expect(answer).toEqual(
      Result.err(
        BookingError.slotUnavailable(
          FIXTURE_IDS.barber,
          TOMORROW,
          minute(600),
          0,
        ),
      ),
    );
    expect(tx.plans).toEqual([]);
    const read = lastSeen as {
      readonly placement: { readonly busy: readonly BarberBusyDay[] };
    };
    expect(telemetry.lines).toEqual([
      {
        level: 'warn',
        msg: LogEvent.BookingRejected,
        fields: {
          errorCode: BookingErrorCode.SlotUnavailable,
          ...DecisionInputSystem.slotFacts(
            read.placement.busy,
            {
              barberId: FIXTURE_IDS.barber,
              localDate: TOMORROW,
              startMinutes: minute(600),
            },
            null,
            [],
          ),
        },
      },
    ]);
    // Flat scalars of the public busy geometry — no client, no service.
    expect(telemetry.lines[0]?.fields).toEqual({
      errorCode: BookingErrorCode.SlotUnavailable,
      readBusyKeys: [BUSY_KEY],
      collidingStartMinutes: 600,
      collidingEndMinutes: 660,
      readRevision: null,
    });
  });

  it('a read re-run on contention logs the facts of the LAST read — the one the refusing `decide` saw', async () => {
    const taken = barberBusyDayFixture({
      id: BarberBusyDayId.of(BUSY_KEY),
      localDate: TOMORROW,
      blocks: [MinuteBlock.of(at(10), until(11), BlockKind.Busy)],
    });
    // The first read sees a free day; a rival books it before the re-read.
    const { tx, telemetry, run, store } = rig(catalogue(), {
      commit: (base) => (read, decide) =>
        base(async (readTx) => {
          await read(readTx);
          store.set(`${Collections.BarberBusy}/${BUSY_KEY}`, bodyOf(taken));
          return read(readTx);
        }, decide),
    });
    const answer = await run(command());
    expect(!answer.ok && answer.error.errorCode).toBe(
      BookingErrorCode.SlotUnavailable,
    );
    expect(tx.plans).toEqual([]);
    expect(telemetry.lines).toEqual([
      {
        level: 'warn',
        msg: LogEvent.BookingRejected,
        fields: {
          errorCode: BookingErrorCode.SlotUnavailable,
          readBusyKeys: [BUSY_KEY],
          collidingStartMinutes: 600,
          collidingEndMinutes: 660,
          readRevision: null,
        },
      },
    ]);
  });

  it('a refusal before any busy day was read logs empty facts — never a stale read', async () => {
    const { telemetry, run } = rig(catalogue());
    const answer = await run(command({ locationId: 'loc-nowhere' }));
    expect(answer.ok).toBe(false);
    expect(telemetry.lines).toEqual([
      {
        level: 'warn',
        msg: LogEvent.BookingRejected,
        fields: {
          errorCode: !answer.ok && answer.error.errorCode,
          readBusyKeys: [],
          collidingStartMinutes: null,
          collidingEndMinutes: null,
          readRevision: null,
        },
      },
    ]);
  });

  it('refuses a start that did not parse (the seat’s startMinutes)', async () => {
    const { run } = rig(catalogue());
    const answer = await run(
      command({ seats: [{ ...SEAT, startMinutes: null }] }),
    );
    expect(!answer.ok && answer.error).toMatchObject({
      errorCode: BookingErrorCode.InvalidInput,
      field: 'startMinutes',
    });
  });

  it('refuses a start inside the spring-forward gap DST_GAP_INVALID_TIME, never shifted, writing nothing (4A-2 (a))', async () => {
    const { tx, run } = rig(catalogue());
    // 2027-03-28 03:30 is never on Sofia's clock: 03:00 jumps to 04:00.
    const answer = await run(
      command({
        localDate: localDate('2027-03-28'),
        seats: [{ ...SEAT, startMinutes: 210 }],
      }),
    );
    expect(!answer.ok && answer.error).toMatchObject({
      errorCode: TimeErrorCode.DstGap,
      localDate: '2027-03-28',
      minute: 210,
    });
    expect(tx.plans).toEqual([]);
  });

  it('answers an unreadable policy as the store’s failure, before the transaction', async () => {
    const { tx, run } = rig(catalogue(), {
      policy: Result.err(
        RepoError.readFailed('settings/bookingPolicy', 'down'),
      ),
    });
    const answer = await run(command());
    expect(!answer.ok && answer.error.errorCode).toBe(
      RepositoryErrorCode.ReadFailed,
    );
    expect(tx.transactions).toEqual([]);
  });

  describe('placement (R33)', () => {
    const placementOf = (store: ReturnType<typeof rig>['store'], id: string) =>
      store.get(`${Collections.Appointments}/${id}`)?.['placement'];

    it('stamps a client’s own booking as self-placed', async () => {
      const { store, run } = rig(catalogue());
      const answer = await run(command());
      expect(answer.ok).toBe(true);
      expect(placementOf(store, ATTEMPT)).toBe('SELF');
    });

    it('stamps the shop placing its own book as staff-placed, owner or not', async () => {
      const desk = Actor.staff(UserId.of('u-staff'), []);
      const named = rig(catalogue());
      const forClient = await named.run(
        command({ staffPlacement: true, actor: desk }),
      );
      expect(forClient.ok).toBe(true);
      expect(placementOf(named.store, ATTEMPT)).toBe('STAFF');

      const walkIn = rig(catalogue());
      const owned = await walkIn.run(
        command({
          staffPlacement: true,
          ownerUserId: null,
          seats: [
            {
              ...SEAT,
              subject: {
                requestedSubjectRole: RequestedSubjectRole.Guest,
                label: 'Walk-in',
                guestKey: null,
                contact: null,
              },
            },
          ],
          actor: desk,
        }),
      );
      expect(owned.ok).toBe(true);
      expect(placementOf(walkIn.store, ATTEMPT)).toBe('STAFF');
    });
  });

  it('answers a retry of an attempt that committed before the shop was hidden with its own booking', async () => {
    const first = rig(catalogue());
    expect((await first.run(command())).ok).toBe(true);
    // The shop is hidden after the booking landed; the lost answer's retry
    // finds its own document before anything about the shop is judged.
    const documents = [...first.store].map(([key, body]) => ({
      path: key.split('/'),
      body,
    }));
    const hidden = documents.map((doc) =>
      doc.path[0] === Collections.Locations
        ? {
            ...doc,
            body: bodyOf(
              locationFixture({ locationStatus: LocationStatus.Hidden }),
            ),
          }
        : doc,
    );
    const retry = rig(hidden);
    const answer = await retry.run(command());
    expect(answer).toEqual({
      ok: true,
      value: { appointmentId: ATTEMPT, replayed: true },
    });
    // Answered from the attempt read first: an empty plan, nothing written.
    expect(retry.tx.plans).toEqual([[]]);
  });

  it('derives the customer id from the account, never from its text', () => {
    expect(CustomerId.forUser(FIXTURE_IDS.client, fixtureHash)).toBe(
      FIXTURE_IDS.customer,
    );
    expect(FIXTURE_IDS.customer).not.toBe(FIXTURE_IDS.client as string);
  });
});

describe('bookAppointment — a walk-in the desk took a contact for (OR-26)', () => {
  const MARIA_PHONE = E164.of('+359888123456');
  const MARIA_RECORD = CustomerId.forWalkIn(MARIA_PHONE, fixtureWalkInHash);
  const MARIA_PATH = `${Collections.Customers}/${MARIA_RECORD}`;
  const STAFF = Actor.staff(UserId.of('u-staff'), []);

  /** A guest seat on `lineId` at `startMinutes`, with what the desk took. */
  const guest = (
    lineId: string,
    label: string,
    contact: BookingCall.GuestContact | null,
    startMinutes = 600,
  ): BookingCall.SeatInput => ({
    ...SEAT,
    lineId,
    startMinutes,
    subject: {
      requestedSubjectRole: RequestedSubjectRole.Guest,
      label,
      guestKey: null,
      contact,
    },
  });
  const walkIn = (
    seats: readonly BookingCall.SeatInput[],
    extra: Partial<BookAppointmentCommand> = {},
  ) =>
    command({
      staffPlacement: true,
      ownerUserId: null,
      attemptId: ATTEMPT,
      seats,
      actor: STAFF,
      ...extra,
    });

  it('creates the walk-in’s record at its deterministic id, reads it in phase one, and seats them WALK_IN', async () => {
    const { store, tx, run, rows } = rig(catalogue());
    const answer = await run(
      walkIn([
        guest('line-1', 'Мария', {
          phone: MARIA_PHONE,
          email: Email.of('maria@example.com'),
        }),
      ]),
    );
    expect(answer.ok).toBe(true);
    const plan = tx.plans[0] ?? [];
    expect(plan.map((op) => [op.writeAction, op.path.join('/')])).toEqual([
      [WriteAction.Create, `${Collections.Appointments}/${ATTEMPT}`],
      [WriteAction.Set, `${Collections.BarberBusy}/${BUSY_KEY}`],
      [WriteAction.Create, MARIA_PATH],
      [WriteAction.Create, `${Collections.AuditLog}/${rows[0]?.id}`],
    ]);
    const expected: Omit<Customer, 'id'> = {
      userId: null,
      displayName: 'Мария',
      phone: MARIA_PHONE,
      email: Email.of('maria@example.com'),
      ...SearchFieldsSystem.searchFields(
        'Мария',
        null,
        MARIA_PHONE,
        Email.of('maria@example.com'),
      ),
      createdAtUtcMs: FIXTURE_NOW_UTC_MS,
      customerOrigin: CustomerOrigin.StaffWalkIn,
      writeOperationId: OperationId.of(ATTEMPT),
    };
    expect(store.get(MARIA_PATH)).toEqual(expected);
    // The record rides the phase-one getAll — no extra round trip.
    const reads = tx.transactions[0]?.reads.map((path) => path.join('/')) ?? [];
    expect(reads.slice(1, 5)).toEqual([
      `${Collections.Locations}/${FIXTURE_IDS.location}`,
      `${Collections.Services}/${FIXTURE_IDS.service}`,
      `${Collections.BarberSchedules}/${FIXTURE_IDS.barber}`,
      MARIA_PATH,
    ]);
    const appointment = store.get(`${Collections.Appointments}/${ATTEMPT}`);
    expect(appointment).toMatchObject({
      ownerUserId: null,
      ownerCustomerId: null,
      subjectCustomerIds: [MARIA_RECORD],
      writeOperationId: OperationId.of(ATTEMPT),
      seats: [
        {
          seatSubject: SeatSubject.WalkIn,
          subjectCustomerId: MARIA_RECORD,
          guestLabel: 'Мария',
        },
      ],
    });
    // The act is done to the walk-in's record.
    expect(rows[0]).toMatchObject({
      auditTarget: 'CUSTOMER',
      targetCustomerId: MARIA_RECORD,
    });
  });

  it('derives the walk-in’s id under the KEYED digest — never the plain hash a phone number could be brute-forced back out of', async () => {
    const { store, run } = rig(catalogue());
    const answer = await run(
      walkIn([guest('line-1', 'Мария', { phone: MARIA_PHONE, email: null })]),
    );
    expect(answer.ok).toBe(true);
    const unkeyed = CustomerId.forWalkIn(MARIA_PHONE, fixtureHash);
    expect(MARIA_RECORD).not.toBe(unkeyed);
    expect(store.get(MARIA_PATH)).toBeDefined();
    expect(store.get(`${Collections.Customers}/${unkeyed}`)).toBeUndefined();
    expect(store.get(`${Collections.Appointments}/${ATTEMPT}`)).toMatchObject({
      subjectCustomerIds: [MARIA_RECORD],
    });
  });

  it('the same phone twice is ONE record — two seats of one walk-in, one Create', async () => {
    const { store, tx, run } = rig(catalogue());
    const answer = await run(
      walkIn([
        guest('line-1', 'Мария', { phone: MARIA_PHONE, email: null }),
        guest('line-2', 'Мария', { phone: MARIA_PHONE, email: null }, 630),
      ]),
    );
    expect(answer.ok).toBe(true);
    expect(writeKeys(tx.plans[0] ?? [], Collections.Customers)).toEqual([
      MARIA_PATH,
    ]);
    const appointment = store.get(`${Collections.Appointments}/${ATTEMPT}`) as {
      readonly seats: readonly { readonly subjectCustomerId: string }[];
    };
    expect(appointment.seats.map((seat) => seat.subjectCustomerId)).toEqual([
      MARIA_RECORD,
      MARIA_RECORD,
    ]);
  });

  it('meets the record a visit before created: the same id, nothing written over it', async () => {
    const stored = {
      path: [Collections.Customers, MARIA_RECORD],
      body: { displayName: 'Мария Иванова' },
    };
    const { store, tx, run } = rig([...catalogue(), stored]);
    const answer = await run(
      walkIn([guest('line-1', 'Мими', { phone: MARIA_PHONE, email: null })]),
    );
    expect(answer.ok).toBe(true);
    expect(writeKeys(tx.plans[0] ?? [], Collections.Customers)).toEqual([]);
    expect(store.get(MARIA_PATH)).toEqual({ displayName: 'Мария Иванова' });
    expect(store.get(`${Collections.Appointments}/${ATTEMPT}`)).toMatchObject({
      seats: [{ seatSubject: SeatSubject.WalkIn, guestLabel: 'Мими' }],
    });
  });

  it('a retried attemptId creates no duplicate — answered with its booking before anything is planned', async () => {
    const { tx, run } = rig(catalogue());
    const seats = [
      guest('line-1', 'Мария', { phone: MARIA_PHONE, email: null }),
    ];
    expect((await run(walkIn(seats))).ok).toBe(true);
    const again = await run(walkIn(seats));
    expect(again).toEqual({
      ok: true,
      value: { appointmentId: ATTEMPT, replayed: true },
    });
    expect(tx.plans.slice(1).flat()).toEqual([]);
  });

  it('a name alone keys nothing — that guest stays ANONYMOUS, and no record is made', async () => {
    const { store, tx, run } = rig(catalogue());
    expect((await run(walkIn([guest('line-1', 'Петър', null)]))).ok).toBe(true);
    expect(writeKeys(tx.plans[0] ?? [], Collections.Customers)).toEqual([]);
    expect(store.get(`${Collections.Appointments}/${ATTEMPT}`)).toMatchObject({
      subjectCustomerIds: [],
      seats: [{ seatSubject: SeatSubject.Anonymous, guestLabel: 'Петър' }],
    });
  });

  it('a client’s cart keeps no record for a guest it names — whatever contact it sends (OR-25)', async () => {
    const { store, tx, run } = rig(catalogue());
    const answer = await run(
      command({
        seats: [
          SEAT,
          guest('line-2', 'Мария', { phone: MARIA_PHONE, email: null }, 630),
        ],
      }),
    );
    expect(answer.ok).toBe(true);
    expect(writeKeys(tx.plans[0] ?? [], Collections.Customers)).toEqual([
      CUSTOMER_PATH,
    ]);
    expect(store.get(MARIA_PATH)).toBeUndefined();
    expect(store.get(`${Collections.Appointments}/${ATTEMPT}`)).toMatchObject({
      seats: [
        { seatSubject: SeatSubject.Account },
        { seatSubject: SeatSubject.Anonymous, guestLabel: 'Мария' },
      ],
    });
  });

  it('a walk-in Create that meets a record created meanwhile re-runs the transaction ONCE — it re-reads, finds it and books', async () => {
    let calls = 0;
    const { store, tx, run } = rig(catalogue(), {
      commit: (base) => async (read, decide) => {
        calls += 1;
        if (calls === 1) {
          store.set(MARIA_PATH, { displayName: 'Мария' });
          return Result.err(RepoError.alreadyExists(MARIA_PATH));
        }
        return base(read, decide);
      },
    });
    const answer = await run(
      walkIn([guest('line-1', 'Мария', { phone: MARIA_PHONE, email: null })]),
    );
    expect(answer).toEqual({
      ok: true,
      value: { appointmentId: ATTEMPT, replayed: false },
    });
    expect(calls).toBe(2);
    expect(writeKeys(tx.plans.at(-1) ?? [], Collections.Customers)).toEqual([]);
  });
});

describe('frameWallClock — the call’s wall clock on the shop’s zone (Law 7.3)', () => {
  it('places each start on the day and the envelope at the EARLIEST start, computed once', () => {
    expect(
      frameWallClock(TOMORROW, [630, 600, null], FIXTURE_TIME_ZONE),
    ).toEqual(
      Result.ok({
        localDate: TOMORROW,
        startMinutes: [at(10, 30), at(10), null],
        startUtcMs: TEN,
      }),
    );
  });

  it('reads a fall-back repeat on the EARLIER offset — no departure', () => {
    const framed = frameWallClock('2026-10-25', [210], FIXTURE_TIME_ZONE);
    expect(framed.ok && framed.value.startUtcMs).toBe(
      utcMs('2026-10-25T03:30:00.000+03:00'),
    );
  });

  it('refuses a gap start, and frames nothing for a day that is no day', () => {
    expect(
      frameWallClock('2027-03-28', [210], FIXTURE_TIME_ZONE),
    ).toMatchObject({ ok: false, error: { errorCode: TimeErrorCode.DstGap } });
    expect(frameWallClock('2026-02-30', [600], FIXTURE_TIME_ZONE)).toEqual(
      Result.ok({ localDate: null, startMinutes: [null], startUtcMs: null }),
    );
  });
});
