import {
  Actor,
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
  DiscountSource,
  type DocBody,
  type DocPath,
  GrantCapacityTerms,
  GrantExpiryTerms,
  GrantLifecycle,
  MinuteBlock,
  Role,
  SeatLabel,
  VoucherCode,
  VoucherLifecycle,
  WriteAction,
  type WriteOp,
} from '@core/components';
import {
  BarberBusyDayId,
  BarberId,
  BookingErrorCode,
  BusyKey,
  CouponGrantId,
  CouponId,
  Currency,
  GiftVoucherId,
  OperationId,
  Result,
  SeatId,
  UserId,
} from '@core/primitives';
import {
  type Appointment,
  type AuditEntry,
  type Coupon,
  type CouponGrant,
  type GiftVoucher,
  Collections,
} from '@core/entities';
import type { AccountContact } from '@core/ports';
import {
  AppointmentEditSystem,
  AuditSystem,
  EditCommand,
  RequestedSubjectRole,
  ResizeEdge,
  StaffEditErrorCode,
} from '@core/systems';
import {
  appointmentFixture,
  at,
  barberBusyDayFixture,
  barberScheduleFixture,
  cents,
  duration,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  fixtureHash,
  localDate,
  locationFixture,
  memoryStore,
  memoryTxPorts,
  recordingTelemetry,
  serviceFixture,
  until,
  utcMs,
} from '@core/testing';
import {
  type EditAppointmentCommand,
  type EditCommandInput,
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

const MOVE_TO_ELEVEN: EditCommandInput = {
  editCommand: EditCommand.Move,
  startUtcMs: utcMs('2026-10-01T11:00:00.000+03:00'),
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
  const rows: AuditEntry[] = [];
  const codesAsked: string[] = [];
  const contactsAsked: (readonly UserId[])[] = [];
  const run = editAppointment({
    ...tx,
    ...recordingTelemetry(),
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
    appendAudit: async (written) => {
      rows.push(...written);
    },
  });
  return { store, tx, rows, codesAsked, contactsAsked, run };
}

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
  it('folds a move and re-decides it: ONE Update (revision, ledger) and the busy Set, audited as the staff verb', async () => {
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
    ]);
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
          AuditSystem.changeKey.staffEdit(OPERATION, 2),
        ),
      ),
    );
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
            atUtcMs: utcMs('2026-10-01T11:45:00.000+03:00'),
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

  it('answers a re-sent intent with its original revision — before the stale check — and writes nothing', async () => {
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
    expect(rows[0]?.id).toBe(
      fixtureHash(
        AuditSystem.rowBasis(
          AuditAction.BookingStaffMove,
          FIXTURE_IDS.appointment,
          FIXTURE_IDS.customer,
          AuditSystem.changeKey.staffEdit(OPERATION, 5),
        ),
      ),
    );
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
    const resize: EditCommandInput = {
      editCommand: EditCommand.Resize,
      resizeEdge: ResizeEdge.End,
      atUtcMs: utcMs('2026-10-01T10:45:00.000+03:00'),
      seatIds: null,
    };
    const refused = await rig(docs).run(command({ commands: [resize] }));
    expect(!refused.ok && refused.error).toMatchObject({
      errorCode: StaffEditErrorCode.Overlaps,
      barberId: FIXTURE_IDS.barber,
      edge: ResizeEdge.End,
    });
    const acknowledged = await rig(docs).run(
      command({ commands: [resize], acknowledgedOverlap: true }),
    );
    expect(acknowledged.ok).toBe(true);
  });

  it('refuses a visit that never happened (status) and an end before the arrival (BEFORE_ARRIVAL)', async () => {
    const cancelled = visit({
      lifecycle: BookingLifecycle.cancel(
        FIXTURE_NOW_UTC_MS,
        CancellationReasonSet.of([CancellationReason.Unspecified]),
      ),
    });
    const never = await rig([...catalogue(), stored(cancelled)]).run(command());
    expect(!never.ok && never.error).toMatchObject({
      errorCode: BookingErrorCode.InvalidInput,
      field: 'status',
    });
    const arrived = visit({
      arrivedAtUtcMs: utcMs('2026-10-01T10:20:00.000+03:00'),
    });
    const early = await rig([...catalogue(), stored(arrived)]).run(
      command({
        commands: [
          {
            editCommand: EditCommand.Move,
            startUtcMs: utcMs('2026-10-01T09:00:00.000+03:00'),
            seatIds: null,
          },
        ],
      }),
    );
    expect(!early.ok && early.error.errorCode).toBe(
      StaffEditErrorCode.BeforeArrival,
    );
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
            startUtcMs: utcMs('2026-10-01T12:00:00.000+03:00'),
            durationMinutes: duration(30),
            addedSubject: {
              requestedSubjectRole: RequestedSubjectRole.Guest,
              label: SeatLabel.of('Guest'),
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
    it('reads each grant AND its coupon in the transaction — the coupon’s name on the receipt — and writes no grant', async () => {
      const { store, tx, run } = rig([
        ...catalogue(),
        stored(visit()),
        { path: [Collections.CouponGrants, GRANT], body: bodyOf(grant()) },
        { path: [Collections.Coupons, COUPON], body: bodyOf(coupon()) },
      ]);
      const answer = await run(
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
      expect(answer.ok).toBe(true);
      expect(readKeys(tx).has(`${Collections.CouponGrants}/${GRANT}`)).toBe(
        true,
      );
      expect(readKeys(tx).has(`${Collections.Coupons}/${COUPON}`)).toBe(true);
      expect(
        (tx.plans[0] ?? []).some(
          (op) => op.path[0] === Collections.CouponGrants,
        ),
      ).toBe(false);
      expect(store.get(PATH)?.['discounts']).toEqual([
        expect.objectContaining({
          discountId: `grant:${GRANT}`,
          label: 'Autumn',
          discountSource: DiscountSource.Grant,
          discountGrantId: GRANT,
        }),
      ]);
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
    const { store, tx, contactsAsked, run } = rig([...docs, stored(visit())]);
    const answer = await run(
      command({
        commands: [
          {
            editCommand: EditCommand.AddSeat,
            seatId: SeatId.of('seat-new'),
            serviceId: FIXTURE_IDS.service,
            variantId: null,
            barberId: FIXTURE_IDS.barber,
            startUtcMs: utcMs('2026-10-01T12:00:00.000+03:00'),
            durationMinutes: duration(30),
            addedSubject: { requestedSubjectRole: RequestedSubjectRole.Self },
          },
        ],
      }),
    );
    expect(answer.ok).toBe(true);
    expect(contactsAsked).toEqual([[FIXTURE_IDS.client]]);
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
