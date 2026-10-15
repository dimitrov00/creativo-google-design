import {
  Actor,
  AuditAction,
  BlockKind,
  BookingPolicy,
  CustomerOrigin,
  type DocBody,
  type DocPath,
  LocationStatus,
  MinuteBlock,
  WriteAction,
  type WriteOp,
} from '@core/components';
import {
  AppointmentId,
  BarberBusyDayId,
  BookingErrorCode,
  BusyKey,
  CustomerId,
  type RepositoryError,
  RepositoryError as RepoError,
  RepositoryErrorCode,
  Result,
  UserId,
} from '@core/primitives';
import {
  type AuditEntry,
  type Customer,
  Collections,
  Profile,
} from '@core/entities';
import type { AccountContact, CommitPlan } from '@core/ports';
import {
  AuditSystem,
  RequestedSubjectRole,
  SearchFieldsSystem,
  ZonedTimeSystem,
} from '@core/systems';
import {
  at,
  barberBusyDayFixture,
  barberScheduleFixture,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  fixtureHash,
  localDate,
  locationFixture,
  memoryCommitPlan,
  memoryStore,
  memoryTxPorts,
  recordingTelemetry,
  serviceFixture,
  until,
  utcMs,
} from '@core/testing';
import {
  type BookAppointmentCommand,
  type BookSeatRequest,
  bookAppointment,
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

const SEAT: BookSeatRequest = {
  lineId: 'line-1',
  serviceId: FIXTURE_IDS.service,
  variantId: null,
  barberId: FIXTURE_IDS.barber,
  barberPreference: null,
  startUtcMs: TEN,
  subject: { requestedSubjectRole: RequestedSubjectRole.Self },
};

function command(
  extra: Partial<BookAppointmentCommand> = {},
): BookAppointmentCommand {
  return {
    locationId: FIXTURE_IDS.location,
    seats: [SEAT],
    attemptId: ATTEMPT,
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
  const rows: AuditEntry[] = [];
  const contactsAsked: (readonly UserId[])[] = [];
  const run = bookAppointment({
    ...tx,
    commit:
      options.commit === undefined ? tx.commit : options.commit(tx.commit),
    ...recordingTelemetry(),
    loadPolicy: async () => options.policy ?? Result.ok(BookingPolicy.DEFAULT),
    loadAccountContacts: async (userIds) => {
      contactsAsked.push(userIds);
      return Result.ok(new Map([[FIXTURE_IDS.client, MARIA]]));
    },
    appendAudit: async (written) => {
      rows.push(...written);
    },
  });
  return { store, tx, rows, contactsAsked, run };
}

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
  it('commits ONE plan — the appointment Create, the busy Set, the FIRST_BOOKING customer Create — and audits after', async () => {
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
    ]);
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
          AuditSystem.changeKey.attempt(ATTEMPT, ATTEMPT),
        ),
      ),
    );
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
    };
    const { store, tx, run } = rig([
      ...catalogue(),
      { path: [Collections.Customers, FIXTURE_IDS.customer], body: existing },
    ]);
    await run(command());
    expect(writeKeys(tx.plans[0] ?? [], Collections.Customers)).toEqual([]);
    expect(store.get(CUSTOMER_PATH)).toEqual(existing);
  });

  it('answers a replayed attempt with its original booking — nothing written, the row appended again under the same id', async () => {
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
    expect(replay.rows.map((row) => row.id)).toEqual(
      first.rows.map((row) => row.id),
    );
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
        attemptId: null,
        seats: [
          {
            ...SEAT,
            subject: {
              requestedSubjectRole: RequestedSubjectRole.Guest,
              label: 'Walk-in',
              guestKey: null,
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

  it('refuses a shop that is not there — and one whose id names no document, unread', async () => {
    const { tx, run } = rig([]);
    const missing = await run(command());
    expect(!missing.ok && missing.error).toMatchObject({
      field: 'locationId',
      reason: 'not_found',
    });
    const unreadable = await run(command({ locationId: 'a/b' }));
    expect(!unreadable.ok && unreadable.error).toMatchObject({
      field: 'locationId',
      reason: 'not_found',
    });
    expect(tx.transactions[1]?.reads).toEqual([
      [Collections.Appointments, ATTEMPT],
    ]);
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

  it('refuses a start that did not parse as startIso', async () => {
    const { run } = rig(catalogue());
    const answer = await run(
      command({ seats: [{ ...SEAT, startUtcMs: null }] }),
    );
    expect(!answer.ok && answer.error).toMatchObject({
      errorCode: BookingErrorCode.InvalidInput,
      field: 'startIso',
    });
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
