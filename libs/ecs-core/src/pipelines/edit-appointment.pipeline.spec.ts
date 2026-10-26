import {
  Actor,
  type AppliedDiscount,
  AuditAction,
  BlockKind,
  BookingLifecycle,
  BookingPolicy,
  CancellationReason,
  CancellationReasonSet,
  Combinability,
  CouponExpiryRule,
  CouponStatus,
  CouponValue,
  CustomerOrigin,
  DiscountMethod,
  DiscountProvenance,
  DiscountSource,
  type DocBody,
  type DocPath,
  E164,
  GrantCapacity,
  GrantCapacityTerms,
  GrantExpiryTerms,
  GrantLifecycle,
  MinuteBlock,
  Placement,
  Role,
  SeatLabel,
  SeatOccupant,
  SeatSubject,
  VoucherCode,
  VoucherLifecycle,
  WriteAction,
  type WriteOp,
  type BookingCall,
  EditCommand,
  RequestedSubjectRole,
  ResizeEdge,
  StaffEditDelta,
} from '@core/components';
import {
  AppliedDiscountId,
  AppointmentId,
  BarberBusyDayId,
  BarberId,
  BusyKey,
  CouponGrantId,
  CouponId,
  Currency,
  CustomerId,
  GiftVoucherId,
  GrantStatus,
  LocationId,
  LogEvent,
  OperationId,
  Result,
  SeatId,
  UserId,
} from '@core/primitives';
import {
  BookingErrorCode,
  RepositoryErrorCode,
  StaffEditErrorCode,
  TimeErrorCode,
} from '@core/errors';
import {
  type AccountContact,
  type Appointment,
  type AuditEntry,
  Collections,
  type Coupon,
  type CouponGrant,
  type GiftVoucher,
} from '@core/entities';

import {
  AppointmentEditSystem,
  AuditSystem,
  CouponGrantSystem,
  ZonedTimeSystem,
} from '@core/systems';
import {
  appointmentFixture,
  at,
  auditRowsOf,
  barberBusyDayFixture,
  barberScheduleFixture,
  cents,
  contendedCommit,
  duration,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  fixtureHash,
  fixtureWalkInHash,
  localDate,
  locationFixture,
  memoryStore,
  memoryTxPorts,
  recordingTelemetry,
  seatFixture,
  serviceFixture,
  until,
  unwrapOk,
  utcMs,
} from '@core/testing';
import {
  type EditAppointmentCommand,
  editAppointment,
} from './edit-appointment.pipeline';

const THURSDAY = localDate('2026-10-01');
const THURSDAY_KEY = BusyKey.of(FIXTURE_IDS.barber, THURSDAY);
const OPERATION = OperationId.of('operation-0123456789ab');
const RECEPTION = Actor.staff(UserId.of('u-desk'), [Role.Receptionist]);
const GRANT = CouponGrantId.of('grant-1');
const COUPON = CouponId.of('coupon-1');
const VOUCHER = GiftVoucherId.of('v-1');

function bodyOf<E extends { readonly id: string }>(entity: E): DocBody {
  const { id: _id, ...body } = entity;
  return body;
}

/** The client's cut on Thursday at 10:00. */
function visit(
  extra: Parameters<typeof appointmentFixture>[0] = {},
): Appointment {
  return appointmentFixture({
    localDate: THURSDAY,
    utcEpochMs: utcMs('2026-10-01T10:00:00.000+03:00'),
    busyKeys: [THURSDAY_KEY],
    ...extra,
  });
}

function customerRecord() {
  return {
    path: [Collections.Customers, FIXTURE_IDS.customer],
    body: {
      userId: FIXTURE_IDS.client,
      displayName: 'Maria Ivanova',
      phone: null,
      email: null,
      searchName: 'maria ivanova',
      searchPrefixes: [],
      createdAtUtcMs: FIXTURE_NOW_UTC_MS,
      customerOrigin: CustomerOrigin.Seed,
    },
  };
}

function catalogue() {
  return [
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
    customerRecord(),
  ];
}

/** A move to 11:00 on the visit's own day — the shop's wall clock, never an instant. */
const MOVE_TO_ELEVEN: BookingCall.EditCommand = {
  editCommand: EditCommand.Move,
  localDate: THURSDAY,
  startMinutes: at(11),
  seatIds: null,
};

function command(
  extra: Partial<EditAppointmentCommand> = {},
): EditAppointmentCommand {
  return {
    appointmentId: FIXTURE_IDS.appointment,
    actorRoles: [Role.Receptionist],
    commands: [MOVE_TO_ELEVEN],
    acknowledgedOverlap: false,
    expectedVersion: 1,
    operationId: OPERATION,
    actor: RECEPTION,
    ...extra,
  };
}

function grant(extra: Partial<CouponGrant> = {}): CouponGrant {
  return {
    id: GRANT,
    customerId: FIXTURE_IDS.customer,
    holderUserId: FIXTURE_IDS.client,
    couponId: COUPON,
    grantedAtUtcMs: utcMs('2026-09-01T10:00:00.000+03:00'),
    discountMethod: DiscountMethod.PercentOff,
    discountPercent: 10,
    ...GrantLifecycle.active(
      GrantCapacityTerms.singleUse(),
      GrantExpiryTerms.none(),
    ),
    ...extra,
  } as CouponGrant;
}

/** The grant as a save that put it on `appointmentId`'s bill left it — burned. */
function spentBy(appointmentId: AppointmentId): CouponGrant {
  return unwrapOk(
    CouponGrantSystem.burn(
      grant(),
      utcMs('2026-09-27T10:00:00.000+03:00'),
      `appointment:${appointmentId}`,
    ),
  );
}

/** The grant's line as a save stored it on the bill. */
const GRANT_LINE: AppliedDiscount = {
  discountId: AppliedDiscountId.of(`grant:${GRANT}`),
  label: 'Autumn',
  appliedAtUtcMs: utcMs('2026-09-27T10:00:00.000+03:00'),
  combinability: Combinability.Stackable,
  ...DiscountProvenance.grant(GRANT),
  ...CouponValue.of({
    discountMethod: DiscountMethod.PercentOff,
    discountPercent: 10,
  }),
};

const APPLY_GRANT: BookingCall.EditCommand = {
  editCommand: EditCommand.Discounts,
  discounts: [{ discountSource: DiscountSource.Grant, grantId: GRANT }],
};

function coupon(extra: Partial<Coupon> = {}): Coupon {
  return {
    id: COUPON,
    name: 'Autumn',
    code: null,
    combinability: Combinability.Stackable,
    usageLimit: null,
    couponStatus: CouponStatus.Enabled,
    couponOccasion: null,
    ...CouponValue.of({
      discountMethod: DiscountMethod.PercentOff,
      discountPercent: 10,
    }),
    ...CouponExpiryRule.never(),
    ...extra,
  } as Coupon;
}

function voucher(balance: number): GiftVoucher {
  return {
    id: VOUCHER,
    code: VoucherCode.of('GIFT50'),
    initialValueCents: cents(5000),
    balanceCents: cents(balance),
    currency: Currency.EUR,
    issuedAtUtcMs: utcMs('2026-09-01T10:00:00.000+03:00'),
    expiresAtUtcMs: null,
    expiresLocalDate: null,
    issuedToCustomerId: null,
    holderUserId: null,
    ...VoucherLifecycle.active(),
  };
}

function rig(
  documents: readonly { readonly path: DocPath; readonly body: DocBody }[],
  coupons: ReadonlyMap<string, Coupon> = new Map(),
) {
  const store = memoryStore(documents);
  const tx = memoryTxPorts(store);
  // The rows the committed plans created (WS-1: inside the act's commit).
  const rows: AuditEntry[] = [];
  const codesAsked: string[] = [];
  const contactsAsked: (readonly UserId[])[] = [];
  const telemetry = recordingTelemetry();
  const contended = contendedCommit(tx.commit);
  const pipeline = editAppointment({
    ...tx,
    commit: contended.commit,
    walkInHash: fixtureWalkInHash,
    ...telemetry,
    loadPolicy: async () => Result.ok(BookingPolicy.DEFAULT),
    findCouponByCode: async (code) => {
      codesAsked.push(code);
      return Result.ok(coupons.get(code) ?? null);
    },
    loadAccountContacts: async (userIds) => {
      contactsAsked.push(userIds);
      const maria: AccountContact = {
        firstName: 'Maria',
        lastName: 'Ivanova',
        phone: null,
        email: null,
      };
      return Result.ok(new Map([[FIXTURE_IDS.client, maria]]));
    },
  });
  const run: typeof pipeline = async (cmd) => {
    const answer = await pipeline(cmd);
    rows.splice(0, rows.length, ...auditRowsOf(tx.plans));
    return answer;
  };
  return {
    store,
    tx,
    rows,
    telemetry,
    codesAsked,
    contactsAsked,
    run,
    decisions: contended.decisions,
  };
}

/** The row a staff move of the fixture visit files for its client (`operation:<operationId>`). */
const EDIT_ROW = fixtureHash(
  AuditSystem.rowBasis(
    AuditAction.BookingStaffMove,
    FIXTURE_IDS.appointment,
    FIXTURE_IDS.customer,
    `operation:${OPERATION}`,
  ),
);

function stored(appointment: Appointment) {
  return {
    path: [Collections.Appointments, appointment.id],
    body: bodyOf(appointment),
  };
}

const PATH = `${Collections.Appointments}/${FIXTURE_IDS.appointment}`;

const readKeys = (tx: ReturnType<typeof rig>['tx']): ReadonlySet<string> =>
  new Set(
    tx.transactions.flatMap((t) => t.reads.map((path) => path.join('/'))),
  );

describe('editAppointment — the shop moving its own book', () => {
  it('folds a move and re-decides it: ONE Update (revision, ledger), the busy Set and, last, the staff verb’s row (WS-1)', async () => {
    const { store, tx, rows, run } = rig([...catalogue(), stored(visit())]);
    const answer = await run(command());
    expect(answer).toEqual({
      ok: true,
      value: {
        appointmentId: FIXTURE_IDS.appointment,
        revision: 2,
        replayed: false,
      },
    });
    const plan = tx.plans[0] ?? [];
    expect(
      plan.map((op: WriteOp) => [op.writeAction, op.path.join('/')]),
    ).toEqual([
      [WriteAction.Update, PATH],
      [WriteAction.Set, `${Collections.BarberBusy}/${THURSDAY_KEY}`],
      [WriteAction.Create, `${Collections.AuditLog}/${EDIT_ROW}`],
    ]);
    expect(plan.at(-1)).toEqual({
      writeAction: WriteAction.Create,
      path: [Collections.AuditLog, EDIT_ROW],
      body: {
        recordedAtUtcMs: FIXTURE_NOW_UTC_MS,
        resourceId: FIXTURE_IDS.appointment,
        auditOperationId: OPERATION,
        ...RECEPTION,
        auditAction: AuditAction.BookingStaffMove,
        editRevision: 2,
        // What the save changed (WS-2): the slot only — the day rides
        // with the start, every other pair untouched.
        ...StaffEditDelta.NONE,
        editMoveFromLocalDate: THURSDAY,
        editMoveToLocalDate: THURSDAY,
        editMoveFromStartMinutes: at(10),
        editMoveToStartMinutes: at(11),
        auditTarget: 'CUSTOMER',
        targetCustomerId: FIXTURE_IDS.customer,
      },
    });
    expect(store.get(PATH)).toMatchObject({
      startMinutes: at(11),
      utcEpochMs: utcMs('2026-10-01T11:00:00.000+03:00'),
      revision: 2,
      appliedOperations: [
        {
          operationId: OPERATION,
          revision: 2,
          digest: fixtureHash(
            AppointmentEditSystem.digestBasis([MOVE_TO_ELEVEN]),
          ).slice(0, 16),
        },
      ],
      bookingStatus: 'CONFIRMED',
    });
    for (const op of plan) {
      if (op.path[0] === Collections.BarberBusy) {
        expect(readKeys(tx).has(op.path.join('/'))).toBe(true);
      }
    }
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      auditAction: AuditAction.BookingStaffMove,
      editRevision: 2,
      targetCustomerId: FIXTURE_IDS.customer,
    });
    expect(rows[0]?.id).toBe(
      fixtureHash(
        AuditSystem.rowBasis(
          AuditAction.BookingStaffMove,
          FIXTURE_IDS.appointment,
          FIXTURE_IDS.customer,
          AuditSystem.changeKey.staffEdit(OPERATION),
        ),
      ),
    );
  });

  it('keys the row `operation:<operationId>` — the id required (WS-4.1), the key byte for byte today’s', async () => {
    const { rows, run } = rig([...catalogue(), stored(visit())]);
    expect((await run(command())).ok).toBe(true);
    expect(rows.map((row) => row.id)).toEqual([
      fixtureHash(
        AuditSystem.rowBasis(
          AuditAction.BookingStaffMove,
          FIXTURE_IDS.appointment,
          FIXTURE_IDS.customer,
          'operation:operation-0123456789ab',
        ),
      ),
    ]);
  });

  it('a batch is a save — folded in order, so the resize measures the MOVED seats', async () => {
    const { store, rows, run } = rig([...catalogue(), stored(visit())]);
    const answer = await run(
      command({
        commands: [
          MOVE_TO_ELEVEN,
          {
            editCommand: EditCommand.Resize,
            resizeEdge: ResizeEdge.End,
            localDate: THURSDAY,
            atMinutes: until(11, 45),
            seatIds: null,
          },
        ],
      }),
    );
    expect(answer.ok).toBe(true);
    const seats = store.get(PATH)?.['seats'] as readonly Record<
      string,
      unknown
    >[];
    expect(seats[0]).toMatchObject({
      startMinutes: at(11),
      durationMinutes: duration(45),
    });
    expect(rows[0]?.auditAction).toBe(AuditAction.BookingStaffSave);
  });

  it('refuses a stale claim (STALE, naming both revisions)', async () => {
    const { tx, run } = rig([...catalogue(), stored(visit({ revision: 3 }))]);
    const answer = await run(command({ expectedVersion: 2 }));
    expect(!answer.ok && answer.error).toEqual({
      errorCode: StaffEditErrorCode.Stale,
      expected: 2,
      actual: 3,
    });
    expect(tx.plans).toEqual([]);
  });

  it('answers a re-sent intent with its original revision — before the stale check — writes nothing and plans ZERO audit ops (WS-1)', async () => {
    const digest = fixtureHash(
      AppointmentEditSystem.digestBasis([MOVE_TO_ELEVEN]),
    ).slice(0, 16);
    const applied = visit({
      revision: 5,
      appliedOperations: [{ operationId: OPERATION, revision: 5, digest }],
    });
    const { tx, rows, run } = rig([...catalogue(), stored(applied)]);
    const answer = await run(command({ expectedVersion: 4 }));
    expect(answer).toEqual({
      ok: true,
      value: {
        appointmentId: FIXTURE_IDS.appointment,
        revision: 5,
        replayed: true,
      },
    });
    expect(tx.plans).toEqual([[]]);
    expect(rows).toEqual([]);
  });

  it('the same intent twice on one store: the second answers the first’s revision as a replay, ZERO audit ops', async () => {
    const { tx, rows, run } = rig([...catalogue(), stored(visit())]);
    const first = await run(command());
    const second = await run(command());
    expect(first).toEqual({
      ok: true,
      value: {
        appointmentId: FIXTURE_IDS.appointment,
        revision: 2,
        replayed: false,
      },
    });
    expect(second).toEqual({
      ok: true,
      value: {
        appointmentId: FIXTURE_IDS.appointment,
        revision: 2,
        replayed: true,
      },
    });
    expect(tx.plans[1]).toEqual([]);
    expect(rows.map((row) => row.id)).toEqual([EDIT_ROW]);
  });

  it('commits the edit without a row when no verified actor is known, and logs it loudly', async () => {
    const { store, tx, rows, telemetry, run } = rig([
      ...catalogue(),
      stored(visit()),
    ]);
    const answer = await run(command({ actor: null }));
    expect(answer.ok).toBe(true);
    expect(store.get(PATH)?.['revision']).toBe(2);
    expect(
      (tx.plans[0] ?? []).some((op) => op.path[0] === Collections.AuditLog),
    ).toBe(false);
    expect(rows).toEqual([]);
    expect(telemetry.lines).toEqual([
      {
        level: 'error',
        msg: LogEvent.AuditActorMissing,
        fields: {
          action: AuditAction.BookingStaffMove,
          resourceId: FIXTURE_IDS.appointment,
        },
      },
    ]);
  });

  it('a Create of a row already there refuses the WHOLE edit as REPOSITORY_ALREADY_EXISTS — nothing applied (an id older than the ledger)', async () => {
    const { store, tx, run } = rig([
      ...catalogue(),
      stored(visit()),
      { path: [Collections.AuditLog, EDIT_ROW], body: { seeded: true } },
    ]);
    const answer = await run(command());
    expect(!answer.ok && answer.error.errorCode).toBe(
      RepositoryErrorCode.AlreadyExists,
    );
    expect(store.get(PATH)?.['revision']).toBe(1);
    expect(tx.plans).toEqual([]);
  });

  it('a contention re-run of the decision derives the identical rows', async () => {
    const { decisions, run } = rig([...catalogue(), stored(visit())]);
    expect((await run(command())).ok).toBe(true);
    expect(decisions).toHaveLength(2);
    const auditOf = (plan: readonly WriteOp[] | undefined) =>
      (plan ?? []).filter((op) => op.path[0] === Collections.AuditLog);
    expect(auditOf(decisions[0])).toHaveLength(1);
    expect(auditOf(decisions[1])).toEqual(auditOf(decisions[0]));
  });

  it('refuses a known name with another batch (operationId)', async () => {
    const applied = visit({
      appliedOperations: [
        { operationId: OPERATION, revision: 1, digest: 'other' },
      ],
    });
    const { run } = rig([...catalogue(), stored(applied)]);
    const answer = await run(command());
    expect(!answer.ok && answer.error).toEqual({
      errorCode: StaffEditErrorCode.InvalidCommand,
      field: 'operationId',
    });
  });

  it('answers a collision as the acknowledgeable OVERLAP — naming a lone resize’s handle — and writes when acknowledged', async () => {
    const taken = barberBusyDayFixture({
      id: BarberBusyDayId.of(THURSDAY_KEY),
      localDate: THURSDAY,
      blocks: [
        MinuteBlock.of(at(10), until(10, 30), BlockKind.Busy),
        MinuteBlock.of(at(10, 30), until(11), BlockKind.Busy),
      ],
    });
    const docs = [
      ...catalogue(),
      stored(visit()),
      { path: [Collections.BarberBusy, THURSDAY_KEY], body: bodyOf(taken) },
    ];
    const resize: BookingCall.EditCommand = {
      editCommand: EditCommand.Resize,
      resizeEdge: ResizeEdge.End,
      localDate: THURSDAY,
      atMinutes: until(10, 45),
      seatIds: null,
    };
    const refused = await rig(docs).run(command({ commands: [resize] }));
    expect(!refused.ok && refused.error).toMatchObject({
      errorCode: StaffEditErrorCode.Overlaps,
      barberId: FIXTURE_IDS.barber,
      resizeEdge: ResizeEdge.End,
    });
    const acknowledged = await rig(docs).run(
      command({ commands: [resize], acknowledgedOverlap: true }),
    );
    expect(acknowledged.ok).toBe(true);
  });

  it('refuses a visit that never happened (bookingStatus) and an end before the arrival (BEFORE_ARRIVAL)', async () => {
    const cancelled = visit({
      lifecycle: BookingLifecycle.cancel(
        FIXTURE_NOW_UTC_MS,
        CancellationReasonSet.of([CancellationReason.Unspecified]),
      ),
    });
    const never = await rig([...catalogue(), stored(cancelled)]).run(command());
    expect(!never.ok && never.error).toMatchObject({
      errorCode: BookingErrorCode.InvalidInput,
      field: 'bookingStatus',
    });
    const arrived = visit({
      arrivedAtUtcMs: utcMs('2026-10-01T10:20:00.000+03:00'),
    });
    const early = await rig([...catalogue(), stored(arrived)]).run(
      command({
        commands: [
          {
            editCommand: EditCommand.Move,
            localDate: THURSDAY,
            startMinutes: at(9),
            seatIds: null,
          },
        ],
      }),
    );
    expect(!early.ok && early.error.errorCode).toBe(
      StaffEditErrorCode.BeforeArrival,
    );
  });

  it('refuses a wall clock inside the spring-forward gap DST_GAP_INVALID_TIME, writing nothing (4A-2 (a))', async () => {
    const { tx, run } = rig([...catalogue(), stored(visit())]);
    const answer = await run(
      command({
        commands: [
          {
            editCommand: EditCommand.Move,
            localDate: localDate('2027-03-28'),
            startMinutes: at(3, 30),
            seatIds: null,
          },
        ],
      }),
    );
    expect(!answer.ok && answer.error).toMatchObject({
      errorCode: TimeErrorCode.DstGap,
    });
    expect(tx.plans).toEqual([]);
  });

  /*
   * Every chair of the folded visit is read on the TARGET shop's clock — a
   * seat no command named included (the rest of a party moved as one, the
   * seat that starts the envelope once the first is gone, every seat of a
   * relocated visit). Europe/Sofia springs 03:00 → 04:00 on 2027-03-28: a
   * start in that hour is refused, never written with the stored instant.
   */
  describe('the clock of every chair (Law 7.3)', () => {
    const GAP_DAY = localDate('2027-03-28');
    const GUEST_SEAT = SeatId.of('seat-guest');
    const MLADOST = LocationId.of('loc-mladost');
    const UTC = unwrapOk(ZonedTimeSystem.checkZone('UTC'));

    /** The client's cut at 10:00 and a guest's straight after it, at 10:30. */
    function party(): Appointment {
      return visit({
        seats: [
          seatFixture(),
          seatFixture({
            seatId: GUEST_SEAT,
            startMinutes: at(10, 30),
            occupant: SeatOccupant.anonymous(SeatLabel.of('Guest')),
          }),
        ],
        endMinutes: until(11),
      });
    }

    const moveTo = (startMinutes: ReturnType<typeof at>) =>
      ({
        editCommand: EditCommand.Move,
        localDate: GAP_DAY,
        startMinutes,
        seatIds: null,
      }) as const satisfies BookingCall.EditCommand;

    it('refuses a party moved as one when the seat it carries lands in the gap — the move named 02:45, the guest lands at 03:15', async () => {
      const { store, tx, rows, run } = rig([...catalogue(), stored(party())]);
      const answer = await run(command({ commands: [moveTo(at(2, 45))] }));
      expect(!answer.ok && answer.error).toEqual({
        errorCode: TimeErrorCode.DstGap,
        localDate: GAP_DAY,
        minute: at(3, 15),
        timeZone: FIXTURE_TIME_ZONE,
      });
      expect(tx.plans).toEqual([]);
      expect(store.get(PATH)).toMatchObject({
        localDate: THURSDAY,
        utcEpochMs: utcMs('2026-10-01T10:00:00.000+03:00'),
        revision: 1,
      });
      expect(rows).toEqual([]);
    });

    it('refuses the seat that becomes the envelope’s start inside the gap once the first is removed — never the stored instant', async () => {
      const { store, tx, run } = rig([...catalogue(), stored(party())]);
      const answer = await run(
        command({
          commands: [
            moveTo(at(2, 45)),
            {
              editCommand: EditCommand.RemoveSeat,
              seatId: FIXTURE_IDS.seat,
            },
          ],
        }),
      );
      expect(!answer.ok && answer.error).toMatchObject({
        errorCode: TimeErrorCode.DstGap,
        localDate: GAP_DAY,
        minute: at(3, 15),
      });
      expect(tx.plans).toEqual([]);
      expect(store.get(PATH)?.['utcEpochMs']).toBe(
        utcMs('2026-10-01T10:00:00.000+03:00'),
      );
    });

    it('moves the envelope’s instant to the seat that now starts it when the first is removed', async () => {
      const { store, run } = rig([...catalogue(), stored(party())]);
      const answer = await run(
        command({
          commands: [
            { editCommand: EditCommand.RemoveSeat, seatId: FIXTURE_IDS.seat },
          ],
        }),
      );
      expect(answer.ok).toBe(true);
      expect(store.get(PATH)).toMatchObject({
        startMinutes: at(10, 30),
        utcEpochMs: utcMs('2026-10-01T10:30:00.000+03:00'),
      });
    });

    /** The centre on UTC's clock, and Mladost on Sofia's — Ivan's cut offered at both. */
    function twoZones(appointment: Appointment) {
      return [
        {
          path: [Collections.Locations, FIXTURE_IDS.location],
          body: bodyOf(locationFixture({ timeZone: UTC })),
        },
        {
          path: [Collections.Locations, MLADOST],
          body: bodyOf(locationFixture({ id: MLADOST })),
        },
        {
          path: [Collections.Services, FIXTURE_IDS.service],
          body: bodyOf(
            serviceFixture({ locationIds: [FIXTURE_IDS.location, MLADOST] }),
          ),
        },
        {
          path: [Collections.BarberSchedules, FIXTURE_IDS.barber],
          body: bodyOf(barberScheduleFixture()),
        },
        customerRecord(),
        stored(appointment),
      ];
    }

    const RELOCATE: BookingCall.EditCommand = {
      editCommand: EditCommand.Relocate,
      locationId: MLADOST,
    };

    it('reads a relocated visit on the TARGET shop’s zone — its instant recomputed there', async () => {
      const atUtcShop = visit({
        utcEpochMs: utcMs('2026-10-01T10:00:00.000+00:00'),
      });
      const { store, run } = rig(twoZones(atUtcShop));
      const answer = await run(command({ commands: [RELOCATE] }));
      expect(answer.ok).toBe(true);
      expect(store.get(PATH)).toMatchObject({
        locationId: MLADOST,
        localDate: THURSDAY,
        startMinutes: at(10),
        utcEpochMs: utcMs('2026-10-01T10:00:00.000+03:00'),
      });
    });

    it('refuses relocating a visit onto a wall clock the target shop’s zone never shows, writing nothing', async () => {
      // 03:30 on 2027-03-28 is on UTC's clock, and erased from Sofia's.
      const atUtcShop = visit({
        localDate: GAP_DAY,
        seats: [seatFixture({ startMinutes: at(3, 30) })],
        startMinutes: at(3, 30),
        endMinutes: until(4),
        utcEpochMs: utcMs('2027-03-28T03:30:00.000+00:00'),
        busyKeys: [BusyKey.of(FIXTURE_IDS.barber, GAP_DAY)],
      });
      const { store, tx, run } = rig(twoZones(atUtcShop));
      const answer = await run(command({ commands: [RELOCATE] }));
      expect(!answer.ok && answer.error).toEqual({
        errorCode: TimeErrorCode.DstGap,
        localDate: GAP_DAY,
        minute: at(3, 30),
        timeZone: FIXTURE_TIME_ZONE,
      });
      expect(tx.plans).toEqual([]);
      expect(store.get(PATH)).toMatchObject({
        locationId: FIXTURE_IDS.location,
        utcEpochMs: utcMs('2027-03-28T03:30:00.000+00:00'),
      });
    });
  });

  it('refuses a fresh seat on a chair this shop does not roster (barberId)', async () => {
    const { run } = rig([...catalogue(), stored(visit())]);
    const answer = await run(
      command({
        commands: [
          {
            editCommand: EditCommand.AddSeat,
            seatId: SeatId.of('seat-new'),
            serviceId: FIXTURE_IDS.service,
            variantId: null,
            barberId: BarberId.of('b-nobody'),
            localDate: THURSDAY,
            startMinutes: at(12),
            durationMinutes: duration(30),
            addedSubject: {
              requestedSubjectRole: RequestedSubjectRole.Guest,
              label: SeatLabel.of('Guest'),
              contact: null,
            },
          },
        ],
      }),
    );
    expect(!answer.ok && answer.error).toEqual({
      errorCode: StaffEditErrorCode.InvalidCommand,
      field: 'barberId',
    });
  });

  describe('the bill', () => {
    it('reads each grant AND its coupon in the transaction — the coupon’s name on the receipt — and burns the grant in the same plan (OR-13)', async () => {
      const { store, tx, run } = rig([
        ...catalogue(),
        stored(visit()),
        { path: [Collections.CouponGrants, GRANT], body: bodyOf(grant()) },
        { path: [Collections.Coupons, COUPON], body: bodyOf(coupon()) },
      ]);
      const answer = await run(command({ commands: [APPLY_GRANT] }));
      expect(answer.ok).toBe(true);
      expect(readKeys(tx).has(`${Collections.CouponGrants}/${GRANT}`)).toBe(
        true,
      );
      expect(readKeys(tx).has(`${Collections.Coupons}/${COUPON}`)).toBe(true);
      // The burn rides the save's own plan, on the grant this attempt read.
      const burn = (tx.plans[0] ?? []).filter(
        (op) => op.path[0] === Collections.CouponGrants,
      );
      expect(burn).toEqual([
        CouponGrantSystem.transitionWrite(
          grant(),
          unwrapOk(
            CouponGrantSystem.burn(
              grant(),
              FIXTURE_NOW_UTC_MS,
              `appointment:${FIXTURE_IDS.appointment}`,
            ),
          ),
        ),
      ]);
      expect(store.get(`${Collections.CouponGrants}/${GRANT}`)).toMatchObject({
        grantStatus: GrantStatus.Used,
        usedAtUtcMs: FIXTURE_NOW_UTC_MS,
        usedNote: `appointment:${FIXTURE_IDS.appointment}`,
        grantCapacity: GrantCapacity.SingleUse,
      });
      expect(store.get(PATH)?.['discounts']).toEqual([
        expect.objectContaining({
          discountId: `grant:${GRANT}`,
          label: 'Autumn',
          discountSource: DiscountSource.Grant,
          discountGrantId: GRANT,
        }),
      ]);
    });

    it('restores the grant when its line leaves the bill — ACTIVE again, the burn’s stamps deleted', async () => {
      const spent = spentBy(FIXTURE_IDS.appointment);
      const { store, tx, run } = rig([
        ...catalogue(),
        stored(visit({ discounts: [GRANT_LINE] })),
        { path: [Collections.CouponGrants, GRANT], body: bodyOf(spent) },
        { path: [Collections.Coupons, COUPON], body: bodyOf(coupon()) },
      ]);
      const answer = await run(
        command({
          commands: [{ editCommand: EditCommand.Discounts, discounts: [] }],
        }),
      );
      expect(answer.ok).toBe(true);
      expect(
        (tx.plans[0] ?? []).filter(
          (op) => op.path[0] === Collections.CouponGrants,
        ),
      ).toEqual([
        CouponGrantSystem.transitionWrite(
          spent,
          unwrapOk(CouponGrantSystem.restore(spent)),
        ),
      ]);
      expect(store.get(PATH)?.['discounts']).toEqual([]);
      const back = store.get(`${Collections.CouponGrants}/${GRANT}`);
      expect(back?.['grantStatus']).toBe(GrantStatus.Active);
      expect(back).not.toHaveProperty('usedAtUtcMs');
      expect(back).not.toHaveProperty('usedNote');
    });

    it('writes no grant for a line the bill keeps — the same bill saved again, or a save that leaves the bill alone', async () => {
      for (const commands of [[APPLY_GRANT], [MOVE_TO_ELEVEN]]) {
        const { store, tx, run } = rig([
          ...catalogue(),
          stored(visit({ discounts: [GRANT_LINE] })),
          {
            path: [Collections.CouponGrants, GRANT],
            body: bodyOf(spentBy(FIXTURE_IDS.appointment)),
          },
          { path: [Collections.Coupons, COUPON], body: bodyOf(coupon()) },
        ]);
        const answer = await run(command({ commands }));
        expect(answer.ok).toBe(true);
        expect(
          (tx.plans[0] ?? []).some(
            (op) => op.path[0] === Collections.CouponGrants,
          ),
        ).toBe(false);
        expect(store.get(PATH)?.['discounts']).toEqual([GRANT_LINE]);
        expect(
          store.get(`${Collections.CouponGrants}/${GRANT}`)?.['grantStatus'],
        ).toBe(GrantStatus.Used);
      }
    });

    it('answers a replay of the save that burned the grant without writing it again', async () => {
      const digest = fixtureHash(
        AppointmentEditSystem.digestBasis([APPLY_GRANT]),
      ).slice(0, 16);
      const { tx, run } = rig([
        ...catalogue(),
        stored(
          visit({
            revision: 2,
            discounts: [GRANT_LINE],
            appliedOperations: [
              { operationId: OPERATION, revision: 2, digest },
            ],
          }),
        ),
        {
          path: [Collections.CouponGrants, GRANT],
          body: bodyOf(spentBy(FIXTURE_IDS.appointment)),
        },
      ]);
      const answer = await run(command({ commands: [APPLY_GRANT] }));
      expect(answer).toEqual({
        ok: true,
        value: {
          appointmentId: FIXTURE_IDS.appointment,
          revision: 2,
          replayed: true,
        },
      });
      expect(tx.plans).toEqual([[]]);
    });

    it('refuses a grant another visit already spent as `grant` — BOOKING_STAFF_EDIT_INVALID_COMMAND, nothing written', async () => {
      const { store, tx, run } = rig([
        ...catalogue(),
        stored(visit()),
        {
          path: [Collections.CouponGrants, GRANT],
          body: bodyOf(spentBy(AppointmentId.of('appt-earlier'))),
        },
        { path: [Collections.Coupons, COUPON], body: bodyOf(coupon()) },
      ]);
      const answer = await run(command({ commands: [APPLY_GRANT] }));
      expect(!answer.ok && answer.error).toEqual({
        errorCode: StaffEditErrorCode.InvalidCommand,
        field: 'grant',
      });
      expect(tx.plans).toEqual([]);
      expect(store.get(PATH)?.['discounts']).toEqual([]);
    });

    it('labels a grant whose coupon is gone by the grant itself (couponId || grantId), stackable', async () => {
      const { store, run } = rig([
        ...catalogue(),
        stored(visit()),
        { path: [Collections.CouponGrants, GRANT], body: bodyOf(grant()) },
      ]);
      await run(
        command({
          commands: [
            {
              editCommand: EditCommand.Discounts,
              discounts: [
                { discountSource: DiscountSource.Grant, grantId: GRANT },
              ],
            },
          ],
        }),
      );
      expect(store.get(PATH)?.['discounts']).toEqual([
        expect.objectContaining({ label: COUPON, combinability: 'STACKABLE' }),
      ]);
    });

    it('refuses an EXCLUSIVE grant beside another discount, as today', async () => {
      const { tx, run } = rig([
        ...catalogue(),
        stored(visit()),
        { path: [Collections.CouponGrants, GRANT], body: bodyOf(grant()) },
        {
          path: [Collections.Coupons, COUPON],
          body: bodyOf(coupon({ combinability: Combinability.Exclusive })),
        },
      ]);
      const answer = await run(
        command({
          commands: [
            {
              editCommand: EditCommand.Discounts,
              discounts: [
                { discountSource: DiscountSource.Grant, grantId: GRANT },
                {
                  discountSource: DiscountSource.Manual,
                  discountMethod: DiscountMethod.PercentOff,
                  discountPercent: 5,
                },
              ],
            },
          ],
        }),
      );
      expect(!answer.ok && answer.error).toEqual({
        errorCode: StaffEditErrorCode.InvalidCommand,
        field: 'discounts',
      });
      expect(tx.plans).toEqual([]);
    });

    it('resolves a typed coupon code OUTSIDE the transaction (findCouponByCode)', async () => {
      const code = VoucherCode.of('AUTUMN10');
      const { store, tx, codesAsked, run } = rig(
        [...catalogue(), stored(visit())],
        new Map([[code, coupon({ code })]]),
      );
      const answer = await run(
        command({
          commands: [
            {
              editCommand: EditCommand.Discounts,
              discounts: [{ discountSource: DiscountSource.Code, code }],
            },
          ],
        }),
      );
      expect(answer.ok).toBe(true);
      expect(codesAsked).toEqual([code]);
      expect(readKeys(tx).has(`${Collections.Coupons}/${COUPON}`)).toBe(false);
      expect(store.get(PATH)?.['discounts']).toEqual([
        expect.objectContaining({
          discountId: `code:${COUPON}`,
          discountCode: code,
        }),
      ]);
    });

    it('refuses a NEW manual figure from a role that does not handle money (FORBIDDEN)', async () => {
      const { run } = rig([...catalogue(), stored(visit())]);
      const answer = await run(
        command({
          actorRoles: [Role.Barber],
          commands: [
            {
              editCommand: EditCommand.Discounts,
              discounts: [
                {
                  discountSource: DiscountSource.Manual,
                  discountMethod: DiscountMethod.FixedAmount,
                  discountAmountCents: cents(500),
                },
              ],
            },
          ],
        }),
      );
      expect(!answer.ok && answer.error.errorCode).toBe(
        StaffEditErrorCode.Forbidden,
      );
    });

    it('applies a voucher BY CODE read in the transaction — its balance Update on a key it read', async () => {
      const { store, tx, run } = rig([
        ...catalogue(),
        stored(visit()),
        {
          path: [Collections.GiftVouchers, VOUCHER],
          body: bodyOf(voucher(5000)),
        },
      ]);
      const answer = await run(
        command({
          commands: [
            {
              editCommand: EditCommand.Vouchers,
              codes: [VoucherCode.of('GIFT50')],
            },
          ],
        }),
      );
      expect(answer.ok).toBe(true);
      expect(tx.transactions[0]?.queries).toContainEqual({
        collection: [Collections.GiftVouchers],
        where: [{ field: 'code', op: '==', value: 'GIFT50' }],
        orderBy: [],
        limit: 1,
      });
      const plan = tx.plans[0] ?? [];
      const voucherWrite = plan.find(
        (op) => op.path[0] === Collections.GiftVouchers,
      );
      expect(voucherWrite?.path).toEqual([Collections.GiftVouchers, VOUCHER]);
      // The voucher's document came back from the in-tx `code ==` query.
      expect(
        store.get(`${Collections.GiftVouchers}/${VOUCHER}`)?.['balanceCents'],
      ).toBe(2200);
      expect(store.get(PATH)?.['voucherRedemptions']).toEqual([
        expect.objectContaining({
          voucherId: VOUCHER,
          amountCents: 2800,
          balanceAfterCents: 2200,
        }),
      ]);
    });
  });

  it('an added SELF seat whose owner has no client record: the contact is read outside, then the record is created in the plan', async () => {
    const docs = catalogue().filter(
      (doc) => doc.path[0] !== Collections.Customers,
    );
    const { store, tx, rows, contactsAsked, run } = rig([
      ...docs,
      stored(visit()),
    ]);
    const answer = await run(
      command({
        commands: [
          {
            editCommand: EditCommand.AddSeat,
            seatId: SeatId.of('seat-new'),
            serviceId: FIXTURE_IDS.service,
            variantId: null,
            barberId: FIXTURE_IDS.barber,
            localDate: THURSDAY,
            startMinutes: at(12),
            durationMinutes: duration(30),
            addedSubject: { requestedSubjectRole: RequestedSubjectRole.Self },
          },
        ],
      }),
    );
    expect(answer.ok).toBe(true);
    expect(contactsAsked).toEqual([[FIXTURE_IDS.client]]);
    // The contacts-first pass wrote nothing and planned no row; the second
    // pass's ONE plan holds the record and, last, the row (WS-1).
    expect(tx.plans).toHaveLength(2);
    expect(tx.plans[0]).toEqual([]);
    expect(tx.plans[1]?.at(-1)?.path[0]).toBe(Collections.AuditLog);
    expect(rows).toHaveLength(1);
    expect(
      store.get(`${Collections.Customers}/${FIXTURE_IDS.customer}`),
    ).toMatchObject({
      userId: FIXTURE_IDS.client,
      displayName: 'Maria Ivanova',
      customerOrigin: CustomerOrigin.FirstBooking,
    });
    // The customer record was read in the placement getAll, never users/{uid}.
    expect(
      readKeys(tx).has(`${Collections.Customers}/${FIXTURE_IDS.customer}`),
    ).toBe(true);
    expect(
      [...readKeys(tx)].some((key) => key.startsWith(`${Collections.Users}/`)),
    ).toBe(false);
  });
});

describe('editAppointment — a walk-in the desk took a contact for (OR-26)', () => {
  const MARIA_PHONE = E164.of('+359888123456');
  const MARIA_RECORD = CustomerId.forWalkIn(MARIA_PHONE, fixtureWalkInHash);
  const MARIA_PATH = `${Collections.Customers}/${MARIA_RECORD}`;
  const ADDED = SeatId.of('seat-maria');

  /** A guest's seat added at noon, with what the desk took for them. */
  const addGuest = (
    contact: BookingCall.GuestContact | null,
    label = 'Мария',
  ): BookingCall.EditCommand => ({
    editCommand: EditCommand.AddSeat,
    seatId: ADDED,
    serviceId: FIXTURE_IDS.service,
    variantId: null,
    barberId: FIXTURE_IDS.barber,
    localDate: THURSDAY,
    startMinutes: at(12),
    durationMinutes: duration(30),
    addedSubject: {
      requestedSubjectRole: RequestedSubjectRole.Guest,
      label: SeatLabel.of(label),
      contact,
    },
  });
  const seatsOf = (body: unknown) =>
    (body as { readonly seats: readonly Record<string, unknown>[] }).seats;

  it('an added guest with a phone: the record is read in phase one, created STAFF_WALK_IN in the plan, and the seat is WALK_IN', async () => {
    const { store, tx, run } = rig([...catalogue(), stored(visit())]);
    const answer = await run(
      command({ commands: [addGuest({ phone: MARIA_PHONE, email: null })] }),
    );
    expect(answer.ok).toBe(true);
    const plan = tx.plans[0] ?? [];
    expect(
      plan
        .filter((op) => op.path[0] === Collections.Customers)
        .map((op) => [op.writeAction, op.path.join('/')]),
    ).toEqual([[WriteAction.Create, MARIA_PATH]]);
    expect(store.get(MARIA_PATH)).toMatchObject({
      userId: null,
      displayName: 'Мария',
      phone: MARIA_PHONE,
      email: null,
      customerOrigin: CustomerOrigin.StaffWalkIn,
    });
    expect(readKeys(tx).has(MARIA_PATH)).toBe(true);
    const saved = store.get(PATH);
    expect(
      seatsOf(saved).find((seat) => seat['seatId'] === ADDED),
    ).toMatchObject({
      seatSubject: SeatSubject.WalkIn,
      subjectCustomerId: MARIA_RECORD,
      guestLabel: 'Мария',
    });
    expect(saved).toMatchObject({
      subjectCustomerIds: [FIXTURE_IDS.customer, MARIA_RECORD].sort(),
    });
  });

  it('derives the added walk-in’s id under the KEYED digest, the added account’s under the plain one', async () => {
    const { tx, run } = rig([...catalogue(), stored(visit())]);
    expect(
      (
        await run(
          command({
            commands: [addGuest({ phone: MARIA_PHONE, email: null })],
          }),
        )
      ).ok,
    ).toBe(true);
    const unkeyed = CustomerId.forWalkIn(MARIA_PHONE, fixtureHash);
    expect(MARIA_RECORD).not.toBe(unkeyed);
    expect(readKeys(tx).has(MARIA_PATH)).toBe(true);
    expect(readKeys(tx).has(`${Collections.Customers}/${unkeyed}`)).toBe(false);
  });

  it('meets the record a visit before created: the same id, nothing written over it', async () => {
    const before = {
      path: [Collections.Customers, MARIA_RECORD],
      body: { displayName: 'Мария Иванова' },
    };
    const { store, tx, run } = rig([...catalogue(), before, stored(visit())]);
    const answer = await run(
      command({ commands: [addGuest({ phone: MARIA_PHONE, email: null })] }),
    );
    expect(answer.ok).toBe(true);
    expect(
      (tx.plans[0] ?? []).filter((op) => op.path[0] === Collections.Customers),
    ).toEqual([]);
    expect(store.get(MARIA_PATH)).toEqual({ displayName: 'Мария Иванова' });
  });

  it('a re-sent intent writes nothing again — no second record, no second seat', async () => {
    const { tx, run } = rig([...catalogue(), stored(visit())]);
    const batch = command({
      commands: [addGuest({ phone: MARIA_PHONE, email: null })],
    });
    expect((await run(batch)).ok).toBe(true);
    const again = await run({ ...batch, expectedVersion: 2 });
    expect(again.ok && again.value.replayed).toBe(true);
    expect(tx.plans.slice(1).flat()).toEqual([]);
  });

  it('a name alone keys nothing — the added guest stays ANONYMOUS, no record is made', async () => {
    const { store, tx, run } = rig([...catalogue(), stored(visit())]);
    expect(
      (await run(command({ commands: [addGuest(null, 'Петър')] }))).ok,
    ).toBe(true);
    expect(
      (tx.plans[0] ?? []).filter((op) => op.path[0] === Collections.Customers),
    ).toEqual([]);
    expect(
      seatsOf(store.get(PATH)).find((seat) => seat['seatId'] === ADDED),
    ).toMatchObject({
      seatSubject: SeatSubject.Anonymous,
      guestLabel: 'Петър',
    });
  });

  it('a stored walk-in keeps its record through a re-decision — a move re-seats it WALK_IN, never a stranger', async () => {
    const walkInSeat = seatFixture({
      seatId: SeatId.of('seat-walk-in'),
      startMinutes: at(10),
      occupant: SeatOccupant.walkIn(MARIA_RECORD, SeatLabel.of('Мария')),
    });
    const walkInVisit = visit({
      ownerUserId: null,
      ownerCustomerId: null,
      subjectUserIds: [],
      subjectCustomerIds: [MARIA_RECORD],
      placement: Placement.Staff,
      seats: [walkInSeat],
    });
    const { store, tx, run } = rig([...catalogue(), stored(walkInVisit)]);
    const answer = await run(command());
    expect(answer.ok).toBe(true);
    expect(
      (tx.plans[0] ?? []).filter((op) => op.path[0] === Collections.Customers),
    ).toEqual([]);
    expect(store.get(PATH)).toMatchObject({
      startMinutes: at(11),
      subjectCustomerIds: [MARIA_RECORD],
      seats: [
        {
          seatSubject: SeatSubject.WalkIn,
          subjectCustomerId: MARIA_RECORD,
          guestLabel: 'Мария',
        },
      ],
    });
  });
});
