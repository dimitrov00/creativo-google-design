import {
  type AppliedDiscount,
  AuditAction,
  AuditContext,
  BlockKind,
  Combinability,
  CouponValue,
  DiscountProvenance,
  type DocBody,
  GrantCapacityTerms,
  GrantExpiryTerms,
  GrantLifecycle,
  MinuteBlock,
  ServiceStatus,
  VoucherCode,
  VoucherLifecycle,
  VoucherRedemption,
  WriteAction,
  WriteOp,
} from '@core/components';
import {
  AppliedDiscountId,
  AuditResourceId,
  BarberBusyDayId,
  BarberId,
  BusyKey,
  CouponGrantId,
  CouponId,
  Currency,
  CustomerId,
  GiftVoucherId,
  LogEvent,
  ServiceId,
} from '@core/primitives';
import {
  type CouponGrant,
  type GiftVoucher,
  Collections,
} from '@core/entities';
import { CouponGrantSystem, ZonedTimeSystem } from '@core/systems';
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
  localDate,
  locationFixture,
  memoryReadTx,
  memoryStore,
  recordingTelemetry,
  serviceFixture,
  until,
  unwrapOk,
} from '@core/testing';
import {
  bookingSnapshotOf,
  busyMergeWrites,
  grantReleaseWrites,
  logUnaudited,
  placementFields,
  placementKeysOf,
  readBookingSet,
  readDiscountGrants,
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

  it('names a document only by an id that could be one — the brand’s own door (OR-44)', async () => {
    const tx = memoryReadTx(memoryStore());
    const unreadable = ['', '   ', 'a/b', '.', '..', '__x__'];
    await readBookingSet(tx, {
      locationId: FIXTURE_IDS.location,
      serviceIds: [...unreadable.map(ServiceId.of), FIXTURE_IDS.service],
      barberIds: unreadable.map(BarberId.of),
      customerIds: [...unreadable.map(CustomerId.of), FIXTURE_IDS.customer],
    });
    expect(tx.reads).toEqual([
      [Collections.Locations, FIXTURE_IDS.location],
      [Collections.Services, FIXTURE_IDS.service],
      [Collections.Customers, FIXTURE_IDS.customer],
    ]);
    const placement = memoryReadTx(memoryStore());
    await readPlacementSet(placement, [], unreadable.map(CustomerId.of));
    expect(placement.reads).toEqual([]);
    expect(
      placementKeysOf(
        [
          { barberId: '..', startMinutes: at(10) },
          { barberId: '__x__', startMinutes: at(10) },
          { barberId: FIXTURE_IDS.barber, startMinutes: at(10) },
        ],
        FIXTURE_TODAY,
      ),
    ).toEqual([KEY]);
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
    expect(snapshot.schedules[0]?.id).toBe(FIXTURE_IDS.barber);
    expect(snapshot.busy).toEqual([
      {
        ...barberBusyDayFixture(),
        blocks: [MinuteBlock.of(at(10), until(10, 30), BlockKind.Busy)],
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

  describe('the coupon grants a bill names (OR-13)', () => {
    const GRANT = CouponGrantId.of('grant-1');
    const OTHER = CouponGrantId.of('grant-2');

    /** A grant line on the bill, honouring `grantId`. */
    function grantLine(grantId: CouponGrantId): AppliedDiscount {
      return {
        discountId: AppliedDiscountId.of(`grant:${grantId}`),
        label: 'Autumn',
        appliedAtUtcMs: FIXTURE_NOW_UTC_MS,
        combinability: Combinability.Stackable,
        ...DiscountProvenance.grant(grantId),
        ...unwrapOk(CouponValue.percentOff(10)),
      };
    }

    const MANUAL: AppliedDiscount = {
      discountId: AppliedDiscountId.of('manual'),
      label: 'Desk',
      appliedAtUtcMs: FIXTURE_NOW_UTC_MS,
      combinability: Combinability.Stackable,
      ...DiscountProvenance.manual(),
      ...unwrapOk(CouponValue.percentOff(5)),
    };

    /** `id`, single-use, burned by the visit's save. */
    function burnt(id: CouponGrantId): CouponGrant {
      const active: CouponGrant = {
        id,
        customerId: FIXTURE_IDS.customer,
        holderUserId: FIXTURE_IDS.client,
        couponId: CouponId.of('coupon-1'),
        grantedAtUtcMs: FIXTURE_NOW_UTC_MS,
        ...unwrapOk(CouponValue.percentOff(10)),
        ...GrantLifecycle.active(
          GrantCapacityTerms.singleUse(),
          GrantExpiryTerms.none(),
        ),
      };
      return unwrapOk(
        CouponGrantSystem.burn(active, FIXTURE_NOW_UTC_MS, 'appointment:a1'),
      );
    }

    it('reads the bill’s grants in ONE getAll — each once, an absent one too, an unreadable id never — and nothing for a bill with no grant line', async () => {
      const tx = memoryReadTx(
        memoryStore([
          {
            path: [Collections.CouponGrants, GRANT],
            body: bodyOf(burnt(GRANT)),
          },
        ]),
      );
      const grants = await readDiscountGrants(tx, [
        grantLine(GRANT),
        MANUAL,
        grantLine(OTHER),
        grantLine(GRANT),
        grantLine(CouponGrantId.of('a/b')),
      ]);
      expect(tx.reads).toEqual([
        [Collections.CouponGrants, GRANT],
        [Collections.CouponGrants, OTHER],
      ]);
      expect(grants.map((grant) => grant.id)).toEqual([GRANT]);

      const none = memoryReadTx(memoryStore());
      expect(await readDiscountGrants(none, [MANUAL])).toEqual([]);
      expect(await readDiscountGrants(none, [])).toEqual([]);
      expect(none.reads).toEqual([]);
    });

    it('a release drops the grant lines from the appointment write and restores each grant read — one not read skipped, the move still lands', () => {
      const base = WriteOp.transition(
        ['appointments', 'a1'],
        { bookingStatus: 'CANCELLED' },
        ['confirmedAtUtcMs'],
      );
      const spent = burnt(GRANT);
      const writes = grantReleaseWrites(
        [base, WriteOp.set(['x', '1'], { a: 1 })],
        [grantLine(GRANT), MANUAL, grantLine(OTHER)],
        [spent],
      );
      expect(writes).toEqual([
        WriteOp.transition(
          ['appointments', 'a1'],
          { bookingStatus: 'CANCELLED', discounts: [MANUAL] },
          ['confirmedAtUtcMs'],
        ),
        WriteOp.set(['x', '1'], { a: 1 }),
        CouponGrantSystem.transitionWrite(
          spent,
          unwrapOk(CouponGrantSystem.restore(spent)),
        ),
      ]);
      expect(writes[2]?.path).toEqual([Collections.CouponGrants, GRANT]);
    });

    it('leaves the plan as it is for a bill with no grant line', () => {
      const base = WriteOp.update(['appointments', 'a1'], {
        bookingStatus: 'NO_SHOW',
      });
      const plan = [base];
      expect(grantReleaseWrites(plan, [MANUAL], [burnt(GRANT)])).toBe(plan);
      expect(grantReleaseWrites(plan, [], [])).toBe(plan);
    });
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

  describe('logUnaudited — the facts a commit landed without rows (WS-1)', () => {
    const fact = {
      resourceId: AuditResourceId.forAppointment(FIXTURE_IDS.appointment),
      subjects: [{ seatSubject: 'ANONYMOUS' as const }],
      changeKey: 'attempt:x',
      operationId: null,
      context: AuditContext.placement(
        AuditAction.BookingCommitted,
        FIXTURE_IDS.location,
      ),
    };

    it('logs one AuditActorMissing error line per fact — the verb and the resource, never a row', () => {
      const telemetry = recordingTelemetry();
      logUnaudited(telemetry, [fact, { ...fact, changeKey: 'attempt:y' }]);
      expect(
        telemetry.lines.map((line) => [line.level, line.msg, line.fields]),
      ).toEqual([
        [
          'error',
          LogEvent.AuditActorMissing,
          {
            action: AuditAction.BookingCommitted,
            resourceId: FIXTURE_IDS.appointment,
          },
        ],
        [
          'error',
          LogEvent.AuditActorMissing,
          {
            action: AuditAction.BookingCommitted,
            resourceId: FIXTURE_IDS.appointment,
          },
        ],
      ]);
      // The message text is today's, byte for byte (the metric filters read it).
      expect(LogEvent.AuditActorMissing).toBe(
        'audit row has no verified actor',
      );
    });

    it('logs nothing when every fact was audited', () => {
      const telemetry = recordingTelemetry();
      logUnaudited(telemetry, []);
      expect(telemetry.lines).toEqual([]);
    });
  });

  it('keeps one shop day per busy key', () => {
    expect(BarberBusyDayId.of(KEY)).toBe(KEY);
  });
});
