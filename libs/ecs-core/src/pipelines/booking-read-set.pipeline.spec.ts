import {
  Actor,
  AuditAction,
  AuditContext,
  BlockKind,
  type DocBody,
  MinuteBlock,
  ServiceStatus,
  VoucherCode,
  VoucherLifecycle,
  VoucherRedemption,
  WriteAction,
  WriteOp,
} from '@core/components';
import {
  AuditResourceId,
  BarberBusyDayId,
  BusyKey,
  Currency,
  GiftVoucherId,
  ServiceId,
  UserId,
} from '@core/primitives';
import { type AuditEntry, type GiftVoucher, Collections } from '@core/entities';
import { AuditSystem, ZonedTimeSystem } from '@core/systems';
import {
  appointmentFixture,
  at,
  barberBusyDayFixture,
  barberScheduleFixture,
  cents,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  FIXTURE_TODAY,
  fixtureHash,
  localDate,
  locationFixture,
  memoryReadTx,
  memoryStore,
  minute,
  recordingTelemetry,
  sequentialIds,
  serviceFixture,
  until,
  utcMs,
} from '@core/testing';
import {
  appendAuditFacts,
  bookingSnapshotOf,
  busyMergeWrites,
  frameShopDay,
  isReadableId,
  placementFields,
  placementKeysOf,
  readBookingSet,
  readPlacementSet,
  voucherRestoreWrites,
  withMoreFields,
} from './booking-read-set.pipeline';

const KEY = BusyKey.of(FIXTURE_IDS.barber, FIXTURE_TODAY);

function bodyOf<E extends { readonly id: string }>(entity: E): DocBody {
  const { id: _id, ...body } = entity;
  return body;
}

describe('the booking read set', () => {
  it('phase one is ONE getAll — the location, the services, the schedules and the client records, duplicates read once', async () => {
    const tx = memoryReadTx(
      memoryStore([
        {
          path: [Collections.Locations, FIXTURE_IDS.location],
          body: bodyOf(locationFixture()),
        },
        {
          path: [Collections.Services, FIXTURE_IDS.service],
          body: bodyOf(serviceFixture()),
        },
        {
          path: [Collections.BarberSchedules, FIXTURE_IDS.barber],
          body: bodyOf(barberScheduleFixture()),
        },
      ]),
    );
    const set = await readBookingSet(tx, {
      locationId: FIXTURE_IDS.location,
      serviceIds: [
        FIXTURE_IDS.service,
        FIXTURE_IDS.service,
        ServiceId.of('a/b'),
      ],
      barberIds: [FIXTURE_IDS.barber],
      customerIds: [FIXTURE_IDS.customer],
    });
    expect(tx.reads).toEqual([
      [Collections.Locations, FIXTURE_IDS.location],
      [Collections.Services, FIXTURE_IDS.service],
      [Collections.BarberSchedules, FIXTURE_IDS.barber],
      [Collections.Customers, FIXTURE_IDS.customer],
    ]);
    expect(set.location?.id).toBe(FIXTURE_IDS.location);
    expect(set.services.map((service) => service.id)).toEqual([
      FIXTURE_IDS.service,
    ]);
    expect(set.schedules.map((schedule) => schedule.id)).toEqual([
      FIXTURE_IDS.barber,
    ]);
    expect(set.customers.get(FIXTURE_IDS.customer)).toBeNull();
  });

  it('phase two reads busy AND exceptions of every key — absent ones too — plus the records asked for', async () => {
    const tx = memoryReadTx(
      memoryStore([
        {
          path: [Collections.BarberBusy, KEY],
          body: bodyOf(barberBusyDayFixture()),
        },
      ]),
    );
    const placement = await readPlacementSet(
      tx,
      [KEY, KEY],
      [FIXTURE_IDS.customer],
    );
    expect(tx.reads).toEqual([
      [Collections.BarberBusy, KEY],
      [Collections.ScheduleExceptions, KEY],
      [Collections.Customers, FIXTURE_IDS.customer],
    ]);
    expect(placement.keys).toEqual([KEY]);
    expect(placement.busy).toHaveLength(1);
    expect(placement.exceptions).toEqual([]);
    expect(placement.customers.get(FIXTURE_IDS.customer)).toBeNull();
    expect(
      await readPlacementSet(memoryReadTx(memoryStore()), []),
    ).toMatchObject({ keys: [] });
  });

  it('names a document only by an id that could be one', () => {
    expect(isReadableId('loc-center')).toBe(true);
    // A blank id is still a name — read, and refused as the shop that is not there.
    expect(isReadableId('   ')).toBe(true);
    for (const id of ['', 'a/b', '.', '..', '__x__'])
      expect(isReadableId(id)).toBe(false);
  });

  it('the snapshot keeps the bookable services, each schedule under its barber, each busy day’s blocks as spans', async () => {
    const archived = serviceFixture({
      id: ServiceId.of('svc-old'),
      serviceStatus: ServiceStatus.Archived,
    });
    const snapshot = bookingSnapshotOf(
      {
        location: locationFixture(),
        services: [serviceFixture(), archived],
        schedules: [barberScheduleFixture()],
        customers: new Map(),
      },
      {
        keys: [KEY],
        busy: [barberBusyDayFixture()],
        exceptions: [],
        customers: new Map(),
      },
    );
    expect(snapshot.services.map((service) => service.id)).toEqual([
      FIXTURE_IDS.service,
    ]);
    expect(snapshot.schedules[0]?.barberId).toBe(FIXTURE_IDS.barber);
    expect(snapshot.busy).toEqual([
      {
        id: KEY,
        spans: [MinuteBlock.of(at(10), until(10, 30), BlockKind.Busy)],
      },
    ]);
    expect(snapshot.shopHours).toEqual(locationFixture().openingHours);
  });

  it('busy writes merge onto the body READ, one Set per document, the day’s first instant stamped', () => {
    const placement = {
      keys: [KEY],
      busy: [barberBusyDayFixture()],
      exceptions: [],
      customers: new Map(),
    };
    const writes = busyMergeWrites(
      placement,
      [
        {
          barberId: FIXTURE_IDS.barber,
          localDate: FIXTURE_TODAY,
          startMinutes: at(10, 30),
          endMinutes: until(11),
        },
        {
          barberId: FIXTURE_IDS.barber,
          localDate: FIXTURE_TODAY,
          startMinutes: at(12),
          endMinutes: until(12, 30),
        },
      ],
      FIXTURE_TIME_ZONE,
    );
    expect(writes).toEqual([
      WriteOp.set([Collections.BarberBusy, KEY], {
        barberId: FIXTURE_IDS.barber,
        localDate: FIXTURE_TODAY,
        utcEpochMs: ZonedTimeSystem.startOfLocalDay(
          FIXTURE_TODAY,
          FIXTURE_TIME_ZONE,
        ),
        blocks: [
          MinuteBlock.of(at(10), until(11), BlockKind.Busy),
          MinuteBlock.of(at(12), until(12, 30), BlockKind.Busy),
        ],
      }),
    ]);
  });

  it('frames wire instants on the shop’s ONE day — a start on another day, or none, places nothing', () => {
    const frame = frameShopDay(
      [
        utcMs('2026-09-28T11:00:00.000+03:00'),
        utcMs('2026-09-28T10:30:00.000+03:00'),
        utcMs('2026-09-29T10:00:00.000+03:00'),
        null,
      ],
      FIXTURE_TIME_ZONE,
    );
    expect(frame).toEqual({
      localDate: FIXTURE_TODAY,
      startMinutes: [minute(660), minute(630), null, null],
      startUtcMs: utcMs('2026-09-28T10:30:00.000+03:00'),
    });
    expect(frameShopDay([null], FIXTURE_TIME_ZONE).localDate).toBeNull();
  });

  it('keys a placement by each barber that parses on its day', () => {
    expect(
      placementKeysOf(
        [
          { barberId: FIXTURE_IDS.barber, startMinutes: at(10) },
          { barberId: FIXTURE_IDS.barber, startMinutes: at(11) },
          { barberId: '', startMinutes: at(11) },
          { barberId: 'b-other', startMinutes: null },
        ],
        localDate('2026-09-29'),
      ),
    ).toEqual([BusyKey.of(FIXTURE_IDS.barber, localDate('2026-09-29'))]);
    expect(placementKeysOf([], null)).toEqual([]);
  });

  it('folds more fields into an Update (same deletions) or a Set; a Create or Delete is left as is', () => {
    const update = WriteOp.transition(['appointments', 'a1'], { a: 1 }, ['b']);
    expect(withMoreFields(update, { c: 2 })).toEqual(
      WriteOp.transition(['appointments', 'a1'], { a: 1, c: 2 }, ['b']),
    );
    expect(withMoreFields(WriteOp.set(['x', '1'], { a: 1 }), { b: 2 })).toEqual(
      WriteOp.set(['x', '1'], { a: 1, b: 2 }),
    );
    const remove = WriteOp.remove(['x', '1']);
    expect(withMoreFields(remove, { b: 2 })).toBe(remove);
  });

  it('a restore reverses the live lines on the appointment write and restores each voucher', () => {
    const voucherId = GiftVoucherId.of('v-1');
    const voucher: GiftVoucher = {
      id: voucherId,
      code: VoucherCode.of('GIFT'),
      initialValueCents: cents(2000),
      balanceCents: cents(500),
      currency: Currency.EUR,
      issuedAtUtcMs: FIXTURE_NOW_UTC_MS,
      expiresAtUtcMs: null,
      expiresLocalDate: null,
      issuedToCustomerId: null,
      holderUserId: null,
      ...VoucherLifecycle.active(),
    };
    const line: VoucherRedemption = {
      voucherId,
      code: VoucherCode.of('GIFT'),
      amountCents: cents(1000),
      balanceAfterCents: cents(500),
      currency: Currency.EUR,
      appliedAtUtcMs: FIXTURE_NOW_UTC_MS,
      reversedAtUtcMs: null,
    };
    const base = WriteOp.update(['appointments', 'a1'], {
      bookingStatus: 'CANCELLED',
    });
    const writes = voucherRestoreWrites(
      [base],
      [line],
      [voucher],
      FIXTURE_NOW_UTC_MS,
    );
    expect(writes).toHaveLength(2);
    expect(writes[0]?.writeAction).toBe(WriteAction.Update);
    expect(writes[1]).toEqual(
      WriteOp.transition(
        [Collections.GiftVouchers, voucherId],
        { balanceCents: cents(1500), voucherStatus: 'ACTIVE' },
        [],
      ),
    );
    expect(voucherRestoreWrites([base], [], [], FIXTURE_NOW_UTC_MS)).toEqual([
      base,
    ]);
  });

  it('placement fields are the geometry, the mirrors and the ledger — nothing of the lifecycle', () => {
    const fields = placementFields(appointmentFixture());
    expect(Object.keys(fields)).toEqual([
      'locationId',
      'seats',
      'localDate',
      'startMinutes',
      'endMinutes',
      'utcEpochMs',
      'ownerUserId',
      'subjectUserIds',
      'ownerCustomerId',
      'subjectCustomerIds',
      'barberIds',
      'busyKeys',
      'revision',
      'appliedOperations',
    ]);
  });

  describe('appendAuditFacts — after the commit, never fatal', () => {
    const fact = {
      resourceId: AuditResourceId.forAppointment(FIXTURE_IDS.appointment),
      subjects: [{ seatSubject: 'ANONYMOUS' as const }],
      changeKey: 'attempt:x',
      context: AuditContext.placement(
        AuditAction.BookingCommitted,
        FIXTURE_IDS.location,
      ),
    };

    it('ids each row hash(rowBasis) — a fact without a change key mints one', async () => {
      const rows: AuditEntry[] = [];
      const ports = {
        appendAudit: async (written: readonly AuditEntry[]) => {
          rows.push(...written);
        },
        hash: fixtureHash,
        nextId: sequentialIds('row'),
        nowUtcMs: () => FIXTURE_NOW_UTC_MS,
        ...recordingTelemetry(),
      };
      await appendAuditFacts(
        ports,
        [fact, { ...fact, changeKey: null }],
        Actor.user(UserId.of('u1')),
      );
      expect(rows.map((row) => row.id)).toEqual([
        fixtureHash(
          AuditSystem.rowBasis(
            AuditAction.BookingCommitted,
            FIXTURE_IDS.appointment,
            null,
            'attempt:x',
          ),
        ),
        'row-1',
      ]);
      expect(rows[0]?.recordedAtUtcMs).toBe(FIXTURE_NOW_UTC_MS);
    });

    it('logs and writes nothing without a verified actor, or for nothing to log', async () => {
      const rows: AuditEntry[] = [];
      const telemetry = recordingTelemetry();
      const ports = {
        appendAudit: async (written: readonly AuditEntry[]) => {
          rows.push(...written);
        },
        hash: fixtureHash,
        nextId: sequentialIds(),
        nowUtcMs: () => FIXTURE_NOW_UTC_MS,
        ...telemetry,
      };
      await appendAuditFacts(ports, [fact], null);
      await appendAuditFacts(ports, [], Actor.user(UserId.of('u1')));
      expect(rows).toEqual([]);
      expect(telemetry.lines.map((line) => [line.level, line.msg])).toEqual([
        ['error', 'audit row has no verified actor'],
      ]);
    });
  });

  it('keeps one shop day per busy key', () => {
    expect(BarberBusyDayId.of(KEY)).toBe(KEY);
  });
});
