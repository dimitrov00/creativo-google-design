import {
  Actor,
  type AppliedDiscount,
  AuditAction,
  BlockKind,
  BookingLifecycle,
  BookingPolicy,
  CancellationReason,
  CancellationReasonSet,
  CancelledBy,
  Combinability,
  CouponValue,
  DiscountProvenance,
  type DocBody,
  GrantCapacity,
  GrantCapacityTerms,
  GrantExpiryTerms,
  GrantLifecycle,
  MinuteBlock,
  RequestedSubjectRole,
  SeatOccupant,
  SeatLabel,
  SeatOutcome,
  VoucherCode,
  VoucherLifecycle,
  VoucherRedemption,
  WriteOp,
} from '@core/components';
import {
  AppliedDiscountId,
  AppointmentId,
  BarberId,
  BookingStatus,
  BusyKey,
  CouponGrantId,
  CouponId,
  Currency,
  type EndMinute,
  GiftVoucherId,
  GrantStatus,
  LogEvent,
  type MinuteOfDay,
  OperationId,
  Result,
  SeatId,
  UserId,
} from '@core/primitives';
import {
  BookingErrorCode,
  RepositoryError,
  RepositoryErrorCode,
  SchedulingErrorCode,
} from '@core/errors';
import {
  type Appointment,
  type AuditEntry,
  type BarberBusyDay,
  type CouponGrant,
  type GiftVoucher,
  type ShopLocation,
  Collections,
  QueryOp,
} from '@core/entities';
import {
  AppointmentLifecycleSystem,
  AuditSystem,
  CouponGrantSystem,
} from '@core/systems';
import {
  appointmentFixture,
  auditRowsOf,
  contendedCommit,
  at,
  barberBusyDayFixture,
  barberScheduleFixture,
  cents,
  FIXTURE_IDS,
  FIXTURE_NOW,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TODAY,
  fixtureHash,
  fixtureWalkInHash,
  hourCount,
  localDate,
  locationFixture,
  memoryDefaultLocationPorts,
  memoryLocationLoadPorts,
  memoryProgramsWorld,
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
  type BookAppointmentCommand,
  bookAppointment,
} from './book-appointment.pipeline';
import { rebuildBusy } from './rebuild-busy.pipeline';
import { transitionAppointment } from './transition-appointment.pipeline';

const STAFF = Actor.staff(UserId.of('u-staff'), []);
const GUEST_SEAT = SeatId.of('seat-2');
const VOUCHER = GiftVoucherId.of('v-1');

function bodyOf<E extends { readonly id: string }>(entity: E): DocBody {
  const { id: _id, ...body } = entity;
  return body;
}

function party(
  extra: Parameters<typeof appointmentFixture>[0] = {},
): Appointment {
  return appointmentFixture({
    seats: [
      seatFixture(),
      seatFixture({
        seatId: GUEST_SEAT,
        barberId: FIXTURE_IDS.barber,
        startMinutes: seatFixture().startMinutes,
        occupant: SeatOccupant.anonymous(SeatLabel.of('Guest')),
      }),
    ],
    ...extra,
  });
}

function rig(
  appointments: readonly Appointment[],
  options: {
    readonly vouchers?: readonly GiftVoucher[];
    readonly grants?: readonly CouponGrant[];
    readonly policy?: Result<BookingPolicy, RepositoryError>;
    /** The visit's shop — the fixture shop unless given; `null`: none stored. */
    readonly location?: ShopLocation | null;
    readonly busy?: readonly BarberBusyDay[];
  } = {},
) {
  const location =
    options.location === undefined ? locationFixture() : options.location;
  const store = memoryStore([
    ...(location === null
      ? []
      : [
          {
            path: [Collections.Locations, location.id],
            body: bodyOf(location),
          },
        ]),
    ...appointments.map((appointment) => ({
      path: [Collections.Appointments, appointment.id],
      body: bodyOf(appointment),
    })),
    ...(options.vouchers ?? []).map((each) => ({
      path: [Collections.GiftVouchers, each.id],
      body: bodyOf(each),
    })),
    ...(options.grants ?? []).map((each) => ({
      path: [Collections.CouponGrants, each.id],
      body: bodyOf(each),
    })),
    ...(options.busy ?? []).map((day) => ({
      path: [Collections.BarberBusy, day.id],
      body: bodyOf(day),
    })),
  ]);
  const tx = memoryTxPorts(store);
  // The rows the committed plans created (WS-1: inside the act's commit).
  const rows: AuditEntry[] = [];
  const telemetry = recordingTelemetry();
  let policyReads = 0;
  const contended = contendedCommit(tx.commit);
  const pipeline = transitionAppointment({
    ...tx,
    commit: contended.commit,
    ...telemetry,
    loadPolicy: async () => {
      policyReads++;
      return options.policy ?? Result.ok(BookingPolicy.DEFAULT);
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
    run,
    policyReads: () => policyReads,
    decisions: contended.decisions,
  };
}

const PATH = `${Collections.Appointments}/${FIXTURE_IDS.appointment}`;

/**
 * A staff transition as the edge decodes it. Its operation id (WS-4.1 —
 * required on the call) names the verb by default, so two different acts in
 * one spec never share a name; `extra.operationId` names a retry.
 */
function command(
  to: BookingStatus,
  extra: {
    seatId?: SeatId | null;
    reason?: CancellationReason | null;
    operationId?: OperationId;
  } = {},
) {
  return {
    appointmentId: FIXTURE_IDS.appointment,
    to,
    seatId: extra.seatId ?? null,
    reason: extra.reason ?? null,
    operationId: extra.operationId ?? opOf(to),
    actor: STAFF,
  };
}

/** The default operation id {@link command} names a verb's act with. */
function opOf(to: BookingStatus): OperationId {
  return OperationId.of(`transition-op-${to.toLowerCase()}`);
}

/** The row id a staff act on the fixture visit files for its client (`transition:<op>[:<seat>]`). */
function rowId(
  action: AuditAction,
  operationId: OperationId,
  seatId: SeatId | null = null,
): string {
  return fixtureHash(
    AuditSystem.rowBasis(
      action,
      FIXTURE_IDS.appointment,
      FIXTURE_IDS.customer,
      AuditSystem.changeKey.transition(operationId, seatId),
    ),
  );
}

describe('transitionAppointment — the shop’s lifecycle pen', () => {
  it('confirms a pending booking: one transition, the pending stamp deleted, audited as the staff verb', async () => {
    const pendingAt = utcMs('2026-09-27T09:00:00.000+03:00');
    const pending = appointmentFixture({
      lifecycle: BookingLifecycle.pending(pendingAt),
    });
    const { tx, rows, run } = rig([pending]);
    const answer = await run(command(BookingStatus.Confirmed));
    expect(answer).toEqual({
      ok: true,
      value: {
        appointmentId: FIXTURE_IDS.appointment,
        to: BookingStatus.Confirmed,
      },
    });
    expect(tx.plans).toEqual([
      [
        WriteOp.transition(
          [Collections.Appointments, pending.id],
          {
            ...BookingLifecycle.confirm(FIXTURE_NOW_UTC_MS),
            seats: pending.seats,
            arrivedAtUtcMs: null,
            // The act that wrote the visit (WS-4.3, DEP-19).
            writeOperationId: opOf(BookingStatus.Confirmed),
          },
          ['pendingAtUtcMs'],
        ),
        // The act's row, LAST in the SAME plan (WS-1).
        WriteOp.create(
          [
            Collections.AuditLog,
            rowId(
              AuditAction.BookingStaffConfirmed,
              opOf(BookingStatus.Confirmed),
            ),
          ],
          {
            recordedAtUtcMs: FIXTURE_NOW_UTC_MS,
            resourceId: pending.id,
            auditOperationId: opOf(BookingStatus.Confirmed),
            ...STAFF,
            auditAction: AuditAction.BookingStaffConfirmed,
            transitionReason: null,
            transitionSeatId: null,
            // The state the act left — and the stamp it deleted (WS-2).
            transitionFromBookingStatus: BookingStatus.Pending,
            transitionFromStatusAtUtcMs: pendingAt,
            transitionFromAttendanceState: null,
            auditTarget: 'CUSTOMER',
            targetCustomerId: FIXTURE_IDS.customer,
          },
        ),
      ],
    ]);
    expect(rows.map((row) => row.auditAction)).toEqual([
      AuditAction.BookingStaffConfirmed,
    ]);
  });

  it('keys the row `transition:<operationId>` for the party — never an instant (WS-1, DEP-6)', async () => {
    const pending = appointmentFixture({
      lifecycle: BookingLifecycle.pending(
        utcMs('2026-09-27T09:00:00.000+03:00'),
      ),
    });
    const { rows, run } = rig([pending]);
    expect((await run(command(BookingStatus.Confirmed))).ok).toBe(true);
    expect(rows.map((row) => row.id)).toEqual([
      fixtureHash(
        AuditSystem.rowBasis(
          AuditAction.BookingStaffConfirmed,
          pending.id,
          FIXTURE_IDS.customer,
          `transition:${opOf(BookingStatus.Confirmed)}`,
        ),
      ),
    ]);
  });

  it('the same transition twice: the second is the graph’s refusal, commits nothing and plans ZERO audit ops (RU-4)', async () => {
    const { tx, rows, run } = rig([appointmentFixture()]);
    expect((await run(command(BookingStatus.Completed))).ok).toBe(true);
    const again = await run(command(BookingStatus.Completed));
    expect(!again.ok && again.error.errorCode).toBe(
      SchedulingErrorCode.AppointmentInvalidTransition,
    );
    expect(tx.plans).toHaveLength(1);
    expect(rows.map((row) => row.id)).toEqual([
      rowId(AuditAction.BookingStaffCompleted, opOf(BookingStatus.Completed)),
    ]);
  });

  it('the same seat act twice: the second is the seat’s refusal, plans ZERO audit ops', async () => {
    const { tx, rows, run } = rig([party()]);
    const cmd = command(BookingStatus.NoShow, { seatId: FIXTURE_IDS.seat });
    expect((await run(cmd)).ok).toBe(true);
    expect((await run(cmd)).ok).toBe(false);
    expect(tx.plans).toHaveLength(1);
    expect(rows).toHaveLength(1);
  });

  it('stamps the stored visit with the act’s operation id — party or seat; a refused retry leaves it (WS-4.3, DEP-19)', async () => {
    const { store, run } = rig([party()]);
    const seatAct = command(BookingStatus.NoShow, {
      seatId: FIXTURE_IDS.seat,
    });
    expect((await run(seatAct)).ok).toBe(true);
    expect(store.get(PATH)?.['writeOperationId']).toBe(seatAct.operationId);
    const partyAct = command(BookingStatus.Completed);
    expect((await run(partyAct)).ok).toBe(true);
    expect(store.get(PATH)?.['writeOperationId']).toBe(partyAct.operationId);
    const retry = await run(
      command(BookingStatus.Completed, {
        operationId: OperationId.of('transition-op-retry'),
      }),
    );
    expect(retry.ok).toBe(false);
    expect(store.get(PATH)?.['writeOperationId']).toBe(partyAct.operationId);
  });

  it('commits the move without a row when no verified actor is known, and logs it loudly', async () => {
    const { store, tx, rows, telemetry, run } = rig([appointmentFixture()]);
    const answer = await run({
      ...command(BookingStatus.Completed),
      actor: null,
    });
    expect(answer.ok).toBe(true);
    expect(store.get(PATH)?.['bookingStatus']).toBe('COMPLETED');
    expect(tx.plans[0]?.map((op) => op.path[0])).toEqual([
      Collections.Appointments,
    ]);
    expect(rows).toEqual([]);
    expect(telemetry.lines).toEqual([
      {
        level: 'error',
        msg: LogEvent.AuditActorMissing,
        fields: {
          action: AuditAction.BookingStaffCompleted,
          resourceId: FIXTURE_IDS.appointment,
        },
      },
    ]);
  });

  it('a Create of a row already there refuses the WHOLE move as REPOSITORY_ALREADY_EXISTS — nothing applied', async () => {
    const { store, tx, run } = rig([appointmentFixture()]);
    const id = rowId(
      AuditAction.BookingStaffCompleted,
      opOf(BookingStatus.Completed),
    );
    store.set(`${Collections.AuditLog}/${id}`, { seeded: true });
    const answer = await run(command(BookingStatus.Completed));
    expect(!answer.ok && answer.error.errorCode).toBe(
      RepositoryErrorCode.AlreadyExists,
    );
    expect(store.get(PATH)?.['bookingStatus']).toBe('CONFIRMED');
    expect(tx.plans).toEqual([]);
  });

  it('a contention re-run of the decision derives the identical plan — row ids included', async () => {
    const { decisions, run } = rig([party()]);
    await run(command(BookingStatus.Completed));
    expect(decisions).toHaveLength(2);
    expect(decisions[1]).toEqual(decisions[0]);
  });

  it('completes the party: every open seat worked; the read set is the visit and its shop', async () => {
    const { store, tx, run, policyReads } = rig([party()]);
    await run(command(BookingStatus.Completed));
    expect(store.get(PATH)?.['bookingStatus']).toBe('COMPLETED');
    const seats = store.get(PATH)?.['seats'] as readonly {
      attendanceState: string;
    }[];
    expect(seats.map((seat) => seat.attendanceState)).toEqual([
      'WORKED',
      'WORKED',
    ]);
    // A verb that is not a cancel reads no policy and stamps no window.
    expect(policyReads()).toBe(0);
    for (const seat of seats)
      expect(seat).not.toHaveProperty('cancellationWindowHours');
    expect(tx.transactions[0]?.reads).toEqual([
      [Collections.Appointments, FIXTURE_IDS.appointment],
      [Collections.Locations, FIXTURE_IDS.location],
    ]);
  });

  it('resolves ONE seat of a party: the root stays a summary, the row names that seat', async () => {
    const { store, rows, run } = rig([party()]);
    const answer = await run(
      command(BookingStatus.NoShow, { seatId: FIXTURE_IDS.seat }),
    );
    expect(answer.ok).toBe(true);
    const seats = store.get(PATH)?.['seats'] as readonly {
      attendanceState: string;
    }[];
    expect(seats.map((seat) => seat.attendanceState)).toEqual([
      'NO_SHOW',
      'SCHEDULED',
    ]);
    expect(store.get(PATH)?.['bookingStatus']).toBe('CONFIRMED');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      transitionSeatId: FIXTURE_IDS.seat,
      targetCustomerId: FIXTURE_IDS.customer,
    });
    expect(rows[0]?.id).toBe(
      rowId(
        AuditAction.BookingStaffNoShow,
        opOf(BookingStatus.NoShow),
        FIXTURE_IDS.seat,
      ),
    );
    expect(rows[0]?.auditOperationId).toBe(opOf(BookingStatus.NoShow));
  });

  it.each([
    [
      'confirming one seat (a party-level act)',
      BookingStatus.Confirmed,
      FIXTURE_IDS.seat,
      SchedulingErrorCode.AppointmentInvalidTransition,
    ],
    [
      'a seat the visit does not hold',
      BookingStatus.NoShow,
      SeatId.of('ghost'),
      SchedulingErrorCode.AppointmentUnknownSeat,
    ],
  ])('refuses %s, writing nothing', async (_case, to, seatId, errorCode) => {
    const { tx, run } = rig([party()]);
    const answer = await run(command(to, { seatId }));
    expect(!answer.ok && answer.error.errorCode).toBe(errorCode);
    expect(tx.plans).toEqual([]);
  });

  it('refuses re-resolving a resolved seat (SEAT_ALREADY_RESOLVED)', async () => {
    const resolved = party({
      seats: [
        seatFixture({ outcome: SeatOutcome.worked(FIXTURE_NOW_UTC_MS) }),
        seatFixture({
          seatId: GUEST_SEAT,
          occupant: SeatOccupant.anonymous(SeatLabel.of('Guest')),
        }),
      ],
    });
    const { run } = rig([resolved]);
    const answer = await run(
      command(BookingStatus.NoShow, { seatId: FIXTURE_IDS.seat }),
    );
    expect(!answer.ok && answer.error.errorCode).toBe(
      SchedulingErrorCode.AppointmentSeatAlreadyResolved,
    );
  });

  it('the shop’s cancel stamps the window in force — never refused by it', async () => {
    const { store, run } = rig([appointmentFixture()]);
    const answer = await run(
      command(BookingStatus.Cancelled, {
        reason: CancellationReason.StaffBarberAbsence,
      }),
    );
    expect(answer.ok).toBe(true);
    const seats = store.get(PATH)?.['seats'] as readonly Record<
      string,
      unknown
    >[];
    expect(seats[0]).toMatchObject({
      attendanceState: 'CANCELLED',
      cancelledBy: 'STAFF',
      cancellationReason: 'STAFF_BARBER_ABSENCE',
      cancellationWindowHours: 24,
    });
  });

  it('an unreadable policy stamps the window UNKNOWN and logs a warning — the cancel still lands', async () => {
    const { store, telemetry, run } = rig([appointmentFixture()], {
      policy: Result.err(
        RepositoryError.readFailed('settings/bookingPolicy', 'down'),
      ),
    });
    const answer = await run(
      command(BookingStatus.Cancelled, {
        reason: CancellationReason.Unspecified,
      }),
    );
    expect(answer.ok).toBe(true);
    const seats = store.get(PATH)?.['seats'] as readonly Record<
      string,
      unknown
    >[];
    expect(seats[0]?.['cancellationWindowHours']).toBeNull();
    expect(telemetry.lines.map((line) => line.msg)).toContain(
      'cancellation window unread; stamped unknown',
    );
  });

  it('a cancel gives back what vouchers paid, in the same plan', async () => {
    const line: VoucherRedemption = {
      voucherId: VOUCHER,
      code: VoucherCode.of('GIFT50'),
      amountCents: cents(1000),
      balanceAfterCents: cents(0),
      currency: Currency.EUR,
      appliedAtUtcMs: utcMs('2026-09-27T10:00:00.000+03:00'),
      reversedAtUtcMs: null,
    };
    const voucher: GiftVoucher = {
      id: VOUCHER,
      code: VoucherCode.of('GIFT50'),
      initialValueCents: cents(1000),
      balanceCents: cents(0),
      currency: Currency.EUR,
      issuedAtUtcMs: utcMs('2026-09-01T10:00:00.000+03:00'),
      expiresAtUtcMs: null,
      expiresLocalDate: null,
      issuedToCustomerId: null,
      holderUserId: null,
      ...VoucherLifecycle.active(),
    };
    const { store, tx, run } = rig(
      [appointmentFixture({ voucherRedemptions: [line] })],
      { vouchers: [voucher] },
    );
    await run(
      command(BookingStatus.Cancelled, {
        reason: CancellationReason.Unspecified,
      }),
    );
    // The visit, the voucher's restore and — last — the act's row (WS-1).
    expect(tx.plans[0]).toHaveLength(3);
    expect(tx.plans[0]?.[2]?.path[0]).toBe(Collections.AuditLog);
    expect(
      store.get(`${Collections.GiftVouchers}/${VOUCHER}`)?.['balanceCents'],
    ).toBe(1000);
    expect(store.get(PATH)?.['voucherRedemptions']).toEqual([
      VoucherRedemption.reversed(line, FIXTURE_NOW_UTC_MS),
    ]);
  });

  it('reopens a no-show: the no-show stamps lifted, audited as its own act', async () => {
    const { store, rows, run } = rig([
      appointmentFixture({
        seats: [
          seatFixture({ outcome: SeatOutcome.noShow(FIXTURE_NOW_UTC_MS) }),
        ],
        lifecycle: BookingLifecycle.noShow(FIXTURE_NOW_UTC_MS),
      }),
    ]);
    const answer = await run(command(BookingStatus.Confirmed));
    expect(answer.ok).toBe(true);
    const seats = store.get(PATH)?.['seats'] as readonly {
      attendanceState: string;
    }[];
    expect(seats[0]?.attendanceState).toBe('SCHEDULED');
    expect(rows.map((row) => row.auditAction)).toEqual([
      AuditAction.BookingStaffReopenNoShow,
    ]);
  });

  it('reopens a completed visit on its own day', async () => {
    const { store, rows, run } = rig([
      appointmentFixture({
        seats: [
          seatFixture({ outcome: SeatOutcome.worked(FIXTURE_NOW_UTC_MS) }),
        ],
        lifecycle: BookingLifecycle.complete(FIXTURE_NOW_UTC_MS),
      }),
    ]);
    const answer = await run(command(BookingStatus.Confirmed));
    expect(answer.ok).toBe(true);
    expect(store.get(PATH)?.['bookingStatus']).toBe('CONFIRMED');
    expect(rows.map((row) => row.auditAction)).toEqual([
      AuditAction.BookingStaffReopenCompleted,
    ]);
  });

  it('refuses to reopen a settled visit on another day (REOPEN_WINDOW_CLOSED)', async () => {
    const { tx, run } = rig([
      appointmentFixture({
        localDate: localDate('2026-09-27'),
        utcEpochMs: utcMs('2026-09-27T10:00:00.000+03:00'),
        lifecycle: BookingLifecycle.complete(FIXTURE_NOW_UTC_MS),
      }),
    ]);
    const answer = await run(command(BookingStatus.Confirmed));
    expect(!answer.ok && answer.error.errorCode).toBe(
      SchedulingErrorCode.AppointmentReopenWindowClosed,
    );
    expect(tx.plans).toEqual([]);
  });

  it('reinstates a cancellation only while the chair is free — reading the live visits on its busy keys (#7)', async () => {
    const cancelled = appointmentFixture({
      lifecycle: BookingLifecycle.cancel(
        FIXTURE_NOW_UTC_MS,
        CancellationReasonSet.of([CancellationReason.Unspecified]),
      ),
    });
    const free = rig([cancelled]);
    const reinstated = await free.run(command(BookingStatus.Confirmed));
    expect(reinstated.ok).toBe(true);
    expect(free.rows.map((row) => row.auditAction)).toEqual([
      AuditAction.BookingStaffReinstate,
    ]);
    expect(free.tx.transactions[0]?.queries).toEqual([
      {
        collection: [Collections.Appointments],
        where: [
          {
            field: 'busyKeys',
            op: QueryOp.ArrayContains,
            value: cancelled.busyKeys[0],
          },
          {
            field: 'bookingStatus',
            op: QueryOp.In,
            value: ['PENDING', 'CONFIRMED'],
          },
        ],
        orderBy: [],
        limit: null,
      },
    ]);

    const taker = appointmentFixture({ id: AppointmentId.of('appt-taker') });
    const taken = rig([cancelled, taker]);
    const refused = await taken.run(command(BookingStatus.Confirmed));
    expect(!refused.ok && refused.error).toMatchObject({
      errorCode: SchedulingErrorCode.AppointmentReopenSlotTaken,
      from: BookingStatus.Cancelled,
    });
    expect(taken.tx.plans).toEqual([]);
  });

  it.each([
    [
      'a no-show',
      SeatOutcome.noShow(FIXTURE_NOW_UTC_MS),
      BookingLifecycle.noShow(FIXTURE_NOW_UTC_MS),
    ],
    [
      'a completed visit on its own day',
      SeatOutcome.worked(FIXTURE_NOW_UTC_MS),
      BookingLifecycle.complete(FIXTURE_NOW_UTC_MS),
    ],
  ])(
    'refuses to reopen %s once a live visit took its chair — naming the seat, writing nothing (OR-57)',
    async (_case, outcome, lifecycle) => {
      const left = appointmentFixture({
        seats: [seatFixture({ outcome })],
        lifecycle,
      });
      const taker = appointmentFixture({ id: AppointmentId.of('appt-taker') });
      const { tx, rows, run } = rig([left, taker]);
      const refused = await run(command(BookingStatus.Confirmed));
      expect(!refused.ok && refused.error).toEqual({
        errorCode: SchedulingErrorCode.AppointmentReopenSlotTaken,
        from: lifecycle.bookingStatus,
        barberId: FIXTURE_IDS.barber,
        localDate: FIXTURE_TODAY,
        startMinutes: seatFixture().startMinutes,
        seatIndex: 0,
      });
      expect(tx.transactions[0]?.queries).toHaveLength(1);
      expect(tx.plans).toEqual([]);
      expect(rows).toEqual([]);

      // With the chair still free, the same reopen lands.
      expect((await rig([left]).run(command(BookingStatus.Confirmed))).ok).toBe(
        true,
      );
    },
  );

  it('names the seat a reopen would collide on, and lets a seat the reopen leaves resolved stay out of it (OR-57)', async () => {
    const OTHER = BarberId.of('b-other');
    const elsewhere = seatFixture({
      outcome: SeatOutcome.noShow(FIXTURE_NOW_UTC_MS),
      barberId: OTHER,
    });
    const keys = {
      barberIds: [OTHER, FIXTURE_IDS.barber],
      busyKeys: [
        BusyKey.of(OTHER, FIXTURE_TODAY),
        BusyKey.of(FIXTURE_IDS.barber, FIXTURE_TODAY),
      ],
      lifecycle: BookingLifecycle.noShow(FIXTURE_NOW_UTC_MS),
    };
    const taker = appointmentFixture({ id: AppointmentId.of('appt-taker') });
    const bothAbsent = appointmentFixture({
      ...keys,
      seats: [
        elsewhere,
        seatFixture({
          seatId: GUEST_SEAT,
          outcome: SeatOutcome.noShow(FIXTURE_NOW_UTC_MS),
        }),
      ],
    });
    const refused = await rig([bothAbsent, taker]).run(
      command(BookingStatus.Confirmed),
    );
    expect(!refused.ok && refused.error).toMatchObject({
      errorCode: SchedulingErrorCode.AppointmentReopenSlotTaken,
      from: BookingStatus.NoShow,
      barberId: FIXTURE_IDS.barber,
      seatIndex: 1,
    });

    // The guest had been called off: the no-show's reopen leaves that seat
    // cancelled, so it holds no chair and the taker is no collision.
    const guestCancelled = appointmentFixture({
      ...keys,
      seats: [
        elsewhere,
        seatFixture({
          seatId: GUEST_SEAT,
          outcome: SeatOutcome.cancelled(
            FIXTURE_NOW_UTC_MS,
            CancelledBy.Staff,
            CancellationReason.Unspecified,
            null,
          ),
        }),
      ],
    });
    const { store, run } = rig([guestCancelled, taker]);
    expect((await run(command(BookingStatus.Confirmed))).ok).toBe(true);
    const seats = store.get(PATH)?.['seats'] as readonly {
      attendanceState: string;
    }[];
    expect(seats.map((seat) => seat.attendanceState)).toEqual([
      'SCHEDULED',
      'CANCELLED',
    ]);
  });

  it('refuses a move the graph does not allow (INVALID_TRANSITION)', async () => {
    const { run } = rig([
      appointmentFixture({
        lifecycle: BookingLifecycle.complete(FIXTURE_NOW_UTC_MS),
      }),
    ]);
    const answer = await run(command(BookingStatus.NoShow));
    expect(!answer.ok && answer.error).toMatchObject({
      errorCode: SchedulingErrorCode.AppointmentInvalidTransition,
      from: 'COMPLETED',
      to: 'NO_SHOW',
    });
  });

  it('answers an unknown visit as invalid input on appointmentId', async () => {
    const { run } = rig([]);
    const answer = await run({
      ...command(BookingStatus.Confirmed),
      appointmentId: AppointmentId.of('nope'),
    });
    expect(!answer.ok && answer.error).toMatchObject({
      errorCode: BookingErrorCode.InvalidInput,
      field: 'appointmentId',
    });
  });
});

/*
 * WHAT THE CLIENT HOLDS (OR-13, DEP-F10b): a coupon grant and a gift-voucher
 * balance are consumed only by a visit that happened. A move that ENDS the
 * visit cancelled or no-show (`BillingSystem.releasesHoldings`) gives both
 * back in its own plan — the reward's line dropped from the bill, the grant
 * restored, the voucher line reversed and its balance restored; a completed
 * visit keeps what it spent, and a reopen re-burns nothing (the barber
 * re-adds the reward).
 */

const GRANT = CouponGrantId.of('grant-1');

/** The client's single-use reward, burned by the save that put it on the bill. */
function spentGrant(): CouponGrant {
  const active: CouponGrant = {
    id: GRANT,
    customerId: FIXTURE_IDS.customer,
    holderUserId: FIXTURE_IDS.client,
    couponId: CouponId.of('coupon-1'),
    grantedAtUtcMs: utcMs('2026-09-01T10:00:00.000+03:00'),
    ...unwrapOk(CouponValue.percentOff(10)),
    ...GrantLifecycle.active(
      GrantCapacityTerms.singleUse(),
      GrantExpiryTerms.none(),
    ),
  };
  return unwrapOk(
    CouponGrantSystem.burn(
      active,
      utcMs('2026-09-27T10:00:00.000+03:00'),
      `appointment:${FIXTURE_IDS.appointment}`,
    ),
  );
}

const GRANT_LINE: AppliedDiscount = {
  discountId: AppliedDiscountId.of(`grant:${GRANT}`),
  label: 'Autumn',
  appliedAtUtcMs: utcMs('2026-09-27T10:00:00.000+03:00'),
  combinability: Combinability.Stackable,
  ...DiscountProvenance.grant(GRANT),
  ...unwrapOk(CouponValue.percentOff(10)),
};

const MANUAL_LINE: AppliedDiscount = {
  discountId: AppliedDiscountId.of('manual'),
  label: 'Desk',
  appliedAtUtcMs: utcMs('2026-09-27T10:00:00.000+03:00'),
  combinability: Combinability.Stackable,
  ...DiscountProvenance.manual(),
  ...unwrapOk(CouponValue.percentOff(5)),
};

const DRAW: VoucherRedemption = {
  voucherId: VOUCHER,
  code: VoucherCode.of('GIFT50'),
  amountCents: cents(1000),
  balanceAfterCents: cents(0),
  currency: Currency.EUR,
  appliedAtUtcMs: utcMs('2026-09-27T10:00:00.000+03:00'),
  reversedAtUtcMs: null,
};

/** The voucher the draw emptied. */
function drawnVoucher(): GiftVoucher {
  return {
    id: VOUCHER,
    code: VoucherCode.of('GIFT50'),
    initialValueCents: cents(1000),
    balanceCents: cents(0),
    currency: Currency.EUR,
    issuedAtUtcMs: utcMs('2026-09-01T10:00:00.000+03:00'),
    expiresAtUtcMs: null,
    expiresLocalDate: null,
    issuedToCustomerId: null,
    holderUserId: null,
    ...VoucherLifecycle.active(),
  };
}

const GRANT_PATH = `${Collections.CouponGrants}/${GRANT}`;
const VOUCHER_PATH = `${Collections.GiftVouchers}/${VOUCHER}`;

describe('transitionAppointment — what the client holds goes back only when the visit did not happen (OR-13)', () => {
  it.each([
    [BookingStatus.NoShow, null],
    [BookingStatus.Cancelled, CancellationReason.StaffBarberAbsence],
  ] as const)(
    'a %s gives back the reward AND the voucher draw, in the same plan — the reward’s line dropped from the bill',
    async (to, reason) => {
      const spent = spentGrant();
      const { store, tx, rows, run } = rig(
        [
          appointmentFixture({
            discounts: [GRANT_LINE, MANUAL_LINE],
            voucherRedemptions: [DRAW],
          }),
        ],
        { vouchers: [drawnVoucher()], grants: [spent] },
      );
      const answer = await run(command(to, { reason }));
      expect(answer.ok).toBe(true);
      expect(tx.transactions[0]?.reads).toEqual([
        [Collections.Appointments, FIXTURE_IDS.appointment],
        [Collections.Locations, FIXTURE_IDS.location],
        [Collections.GiftVouchers, VOUCHER],
        [Collections.CouponGrants, GRANT],
      ]);
      const plan = tx.plans[0] ?? [];
      expect(rows).toHaveLength(1);
      expect(plan.map((op) => op.path.join('/'))).toEqual([
        PATH,
        VOUCHER_PATH,
        GRANT_PATH,
        `${Collections.AuditLog}/${rows[0]?.id}`,
      ]);
      expect(plan[2]).toEqual(
        CouponGrantSystem.transitionWrite(
          spent,
          unwrapOk(CouponGrantSystem.restore(spent)),
        ),
      );
      expect(store.get(PATH)).toMatchObject({
        bookingStatus: to,
        discounts: [MANUAL_LINE],
        voucherRedemptions: [
          VoucherRedemption.reversed(DRAW, FIXTURE_NOW_UTC_MS),
        ],
      });
      expect(store.get(VOUCHER_PATH)?.['balanceCents']).toBe(1000);
      expect(store.get(GRANT_PATH)).toMatchObject({
        grantStatus: GrantStatus.Active,
        grantCapacity: GrantCapacity.SingleUse,
      });
      expect(store.get(GRANT_PATH)).not.toHaveProperty('usedAtUtcMs');
    },
  );

  it('a completed visit keeps the reward USED and the draw spent — nothing it holds is read or written', async () => {
    const { store, tx, rows, run } = rig(
      [
        appointmentFixture({
          discounts: [GRANT_LINE],
          voucherRedemptions: [DRAW],
        }),
      ],
      { vouchers: [drawnVoucher()], grants: [spentGrant()] },
    );
    expect((await run(command(BookingStatus.Completed))).ok).toBe(true);
    expect(tx.transactions[0]?.reads).toEqual([
      [Collections.Appointments, FIXTURE_IDS.appointment],
      [Collections.Locations, FIXTURE_IDS.location],
    ]);
    expect(rows).toHaveLength(1);
    expect(tx.plans[0]?.map((op) => op.path.join('/'))).toEqual([
      PATH,
      `${Collections.AuditLog}/${rows[0]?.id}`,
    ]);
    expect(store.get(PATH)?.['discounts']).toEqual([GRANT_LINE]);
    expect(store.get(GRANT_PATH)?.['grantStatus']).toBe(GrantStatus.Used);
    expect(store.get(VOUCHER_PATH)?.['balanceCents']).toBe(0);
  });

  it('one seat’s no-show while the party still happens gives nothing back', async () => {
    const { store, tx, rows, run } = rig(
      [party({ discounts: [GRANT_LINE], voucherRedemptions: [DRAW] })],
      { vouchers: [drawnVoucher()], grants: [spentGrant()] },
    );
    const answer = await run(
      command(BookingStatus.NoShow, { seatId: FIXTURE_IDS.seat }),
    );
    expect(answer.ok).toBe(true);
    expect(store.get(PATH)?.['bookingStatus']).toBe('CONFIRMED');
    expect(rows).toHaveLength(1);
    expect(tx.plans[0]?.map((op) => op.path.join('/'))).toEqual([
      PATH,
      `${Collections.AuditLog}/${rows[0]?.id}`,
    ]);
    expect(store.get(PATH)?.['discounts']).toEqual([GRANT_LINE]);
    expect(store.get(GRANT_PATH)?.['grantStatus']).toBe(GrantStatus.Used);
  });

  it.each([
    [BookingStatus.Cancelled, CancellationReason.StaffBarberAbsence],
    [BookingStatus.NoShow, null],
  ] as const)(
    'reopening a visit called %s re-burns nothing: the barber re-adds the reward',
    async (to, reason) => {
      const world = rig([appointmentFixture({ discounts: [GRANT_LINE] })], {
        grants: [spentGrant()],
      });
      expect((await world.run(command(to, { reason }))).ok).toBe(true);
      expect(world.store.get(GRANT_PATH)?.['grantStatus']).toBe(
        GrantStatus.Active,
      );
      expect((await world.run(command(BookingStatus.Confirmed))).ok).toBe(true);
      const reopen = world.tx.plans[1] ?? [];
      expect(reopen.some((op) => op.path[0] === Collections.CouponGrants)).toBe(
        false,
      );
      expect(
        world.tx.transactions[1]?.reads.map((path) => path[0]),
      ).not.toContain(Collections.CouponGrants);
      expect(world.store.get(PATH)).toMatchObject({
        bookingStatus: 'CONFIRMED',
        discounts: [],
      });
      expect(world.store.get(GRANT_PATH)?.['grantStatus']).toBe(
        GrantStatus.Active,
      );
    },
  );
});

/*
 * THE REOPEN-THEN-BOOK WINDOW (pass E, E-14 — flip 1's deferred "reopen busy
 * write", proven before it was fixed). The busy projection keeps only LIVE
 * visits (`BusySystem.rebuild` skips `!BookingLifecycle.isLive`), so a
 * cancelled, a no-show and a completed visit all lose their blocks once
 * `rebuildBusyOnAppointmentChange` ran — and a booking checks its collisions
 * against the busy DOCUMENTS only (`readPlacementSet`). Each window case
 * (the last describe) runs the whole story over ONE store: the visit leaves
 * the book, the trigger frees its day, the shop reopens it — and, BEFORE the
 * trigger runs again, a walk-in is placed over it.
 *
 * On `6d64f69f` (no busy write on any edge, F1-2) the walk-in was ADMITTED on
 * all three edges — outcome (b), DEP-5: the reopen now merges the visit's
 * blocks onto the busy days it reads, so the walk-in is refused. The plan
 * cases pin the reopen's `WriteOp[]` for each edge.
 */

const BUSY_KEY = BusyKey.of(FIXTURE_IDS.barber, FIXTURE_TODAY);
const BUSY_PATH = `${Collections.BarberBusy}/${BUSY_KEY}`;

/** The fixture visit called off by the shop. */
const CANCELLED_VISIT = appointmentFixture({
  seats: [
    seatFixture({
      outcome: SeatOutcome.cancelled(
        FIXTURE_NOW_UTC_MS,
        CancelledBy.Staff,
        CancellationReason.StaffBarberAbsence,
        hourCount(24),
      ),
    }),
  ],
  lifecycle: BookingLifecycle.cancel(
    FIXTURE_NOW_UTC_MS,
    CancellationReasonSet.of([CancellationReason.StaffBarberAbsence]),
  ),
});

/** The fixture visit nobody came to. */
const NO_SHOW_VISIT = appointmentFixture({
  seats: [seatFixture({ outcome: SeatOutcome.noShow(FIXTURE_NOW_UTC_MS) })],
  lifecycle: BookingLifecycle.noShow(FIXTURE_NOW_UTC_MS),
});

/** The fixture visit worked and settled. */
const COMPLETED_VISIT = appointmentFixture({
  seats: [seatFixture({ outcome: SeatOutcome.worked(FIXTURE_NOW_UTC_MS) })],
  lifecycle: BookingLifecycle.complete(FIXTURE_NOW_UTC_MS),
});

/** The three statuses a reopen comes back from — the settled two on the visit's own day. */
const LEFT_VISITS: readonly (readonly [BookingStatus, Appointment])[] = [
  [BookingStatus.Cancelled, CANCELLED_VISIT],
  [BookingStatus.NoShow, NO_SHOW_VISIT],
  [BookingStatus.Completed, COMPLETED_VISIT],
];

/** The reopen's step, as the system decides it on the pinned now. */
function reopenStep(left: Appointment) {
  const step = AppointmentLifecycleSystem.transition(
    left,
    {
      to: BookingStatus.Confirmed,
      seatId: null,
      reason: null,
      windowHours: null,
      operationId: opOf(BookingStatus.Confirmed),
    },
    FIXTURE_NOW,
  );
  if (!step.ok) throw new Error('a broken reopen fixture');
  return step.value;
}

/** The reopen's own writes — the plan's head. */
function reopenWrites(left: Appointment): readonly WriteOp[] {
  return reopenStep(left).writes;
}

/** The reopen's audit Creates — the plan's tail (WS-1), as the audit planner builds them. */
function reopenAudit(left: Appointment): readonly WriteOp[] {
  return AuditSystem.commitWrites(
    reopenStep(left).auditFacts,
    STAFF,
    FIXTURE_NOW_UTC_MS,
    fixtureHash,
  ).writes;
}

function busyBlock(from: MinuteOfDay, to: EndMinute): MinuteBlock {
  return MinuteBlock.of(from, to, BlockKind.Busy);
}

/** Ivan's busy day today as stored — the entity minus its id. */
function busyDayBody(blocks: readonly MinuteBlock[]): DocBody {
  return bodyOf(barberBusyDayFixture({ blocks }));
}

describe('transitionAppointment — a reopen holds its chair in barberBusy at once (DEP-5)', () => {
  it.each(LEFT_VISITS)(
    'reopening a %s visit merges its chair time onto the busy day it read, in the same plan',
    async (_from, left) => {
      const { tx, run } = rig([left]);
      const answer = await run(command(BookingStatus.Confirmed));
      expect(answer.ok).toBe(true);
      expect(tx.plans).toEqual([
        [
          ...reopenWrites(left),
          WriteOp.set(
            [Collections.BarberBusy, BUSY_KEY],
            busyDayBody([busyBlock(at(10), until(10, 30))]),
          ),
          ...reopenAudit(left),
        ],
      ]);
      expect(reopenAudit(left)).toHaveLength(1);
      // The busy day and its exceptions are read in the transaction, absent ones too.
      expect(tx.transactions[0]?.reads).toEqual([
        [Collections.Appointments, FIXTURE_IDS.appointment],
        [Collections.Locations, FIXTURE_IDS.location],
        [Collections.BarberBusy, BUSY_KEY],
        [Collections.ScheduleExceptions, BUSY_KEY],
      ]);
    },
  );

  it('merges onto the body it read: a neighbour’s blocks kept, a touching span joined', async () => {
    const { store, tx, run } = rig([NO_SHOW_VISIT], {
      busy: [
        barberBusyDayFixture({
          blocks: [
            busyBlock(at(10, 30), until(11)),
            busyBlock(at(12), until(12, 30)),
          ],
        }),
      ],
    });
    await run(command(BookingStatus.Confirmed));
    const merged = busyDayBody([
      busyBlock(at(10), until(11)),
      busyBlock(at(12), until(12, 30)),
    ]);
    // The busy day, then the act's row last (WS-1).
    expect(tx.plans[0]?.at(-2)).toEqual(
      WriteOp.set([Collections.BarberBusy, BUSY_KEY], merged),
    );
    expect(tx.plans[0]?.at(-1)?.path[0]).toBe(Collections.AuditLog);
    expect(store.get(BUSY_PATH)).toEqual(merged);
  });

  it('writes no busy day for a shop with no zone (its first instant is the zone’s) — the reopen still lands', async () => {
    const { tx, run } = rig([NO_SHOW_VISIT], { location: null });
    expect((await run(command(BookingStatus.Confirmed))).ok).toBe(true);
    expect(tx.plans.map((plan) => plan.map((op) => op.path[0]))).toEqual([
      [Collections.Appointments, Collections.AuditLog],
    ]);
  });

  it('a move that leaves the visit live, or ends it, reads and writes no busy day', async () => {
    const pending = rig([
      appointmentFixture({
        lifecycle: BookingLifecycle.pending(
          utcMs('2026-09-27T09:00:00.000+03:00'),
        ),
      }),
    ]);
    await pending.run(command(BookingStatus.Confirmed));
    const ended = rig([appointmentFixture()]);
    await ended.run(command(BookingStatus.NoShow));
    for (const { tx } of [pending, ended]) {
      expect(tx.plans.flat().map((op) => op.path[0])).toEqual([
        Collections.Appointments,
        Collections.AuditLog,
      ]);
      expect(tx.transactions[0]?.reads).toEqual([
        [Collections.Appointments, FIXTURE_IDS.appointment],
        [Collections.Locations, FIXTURE_IDS.location],
      ]);
    }
  });

  it.each([
    [BookingStatus.Completed, COMPLETED_VISIT, BookingStatus.NoShow],
    [BookingStatus.Cancelled, CANCELLED_VISIT, BookingStatus.NoShow],
    [BookingStatus.NoShow, NO_SHOW_VISIT, BookingStatus.Completed],
  ] as const)(
    'a move from a %s visit to a status that is not live reads no busy day, so it keeps its own answer',
    async (_from, left, to) => {
      const { tx, run } = rig([left], {
        busy: [barberBusyDayFixture()],
      });
      const answer = await run(command(to));
      expect(answer.ok).toBe(false);
      expect(tx.plans).toEqual([]);
      const reads = tx.transactions.flatMap((each) => each.reads);
      expect(reads.map((path) => path[0])).not.toContain(
        Collections.BarberBusy,
      );
      expect(reads.map((path) => path[0])).not.toContain(
        Collections.ScheduleExceptions,
      );
    },
  );
});

/** A walk-in the shop places at 10:15 today, on the reopened visit's chair. */
const WALK_IN: BookAppointmentCommand = {
  locationId: FIXTURE_IDS.location,
  localDate: FIXTURE_TODAY,
  seats: [
    {
      lineId: 'line-1',
      serviceId: FIXTURE_IDS.service,
      variantId: null,
      barberId: FIXTURE_IDS.barber,
      barberPreference: null,
      startMinutes: 615,
      subject: {
        requestedSubjectRole: RequestedSubjectRole.Guest,
        label: 'Walk-in',
        guestKey: null,
        contact: null,
      },
    },
  ],
  attemptId: AppointmentId.of('walk-in-attempt-0123456789'),
  operationId: OperationId.of('walk-in-attempt-0123456789'),
  bookedFromAppointmentId: null,
  contact: null,
  ownerUserId: null,
  staffPlacement: true,
  actor: STAFF,
};

/** The three pipelines over ONE store: the confirmed 10:00 visit, its busy day, the catalogue. */
function windowRig() {
  const confirmed = appointmentFixture();
  const store = memoryStore([
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
    {
      path: [Collections.Appointments, confirmed.id],
      body: bodyOf(confirmed),
    },
    {
      path: [Collections.BarberBusy, BUSY_KEY],
      body: bodyOf(barberBusyDayFixture()),
    },
  ]);
  const tx = memoryTxPorts(store);
  const telemetry = recordingTelemetry();
  const policy = async () => Result.ok(BookingPolicy.DEFAULT);
  const transition = transitionAppointment({
    ...tx,
    ...telemetry,
    loadPolicy: policy,
  });
  const rebuild = rebuildBusy({
    ...tx,
    ...telemetry,
    ...memoryLocationLoadPorts(
      memoryProgramsWorld({ locations: [locationFixture()] }),
    ),
    ...memoryDefaultLocationPorts(),
  });
  const book = bookAppointment({
    ...tx,
    walkInHash: fixtureWalkInHash,
    ...telemetry,
    loadPolicy: policy,
    loadAccountContacts: async () => Result.ok(new Map()),
  });
  /** The visit as stored now — the side the trigger is handed. */
  const visit = (): Appointment =>
    ({ id: confirmed.id, ...store.get(PATH) }) as Appointment;
  /** The trigger on one write of the visit (no refused side). */
  const trigger = (before: Appointment, after: Appointment) =>
    rebuild({
      before,
      after,
      salvagedKeys: [],
      salvagedLocationId: null,
      refusal: null,
    });
  return { store, tx, confirmed, visit, transition, trigger, book };
}

describe('transitionAppointment — the reopen-then-book window (E-14)', () => {
  it.each([
    [
      BookingStatus.Cancelled,
      CancellationReason.StaffBarberAbsence as CancellationReason | null,
    ],
    [BookingStatus.NoShow, null],
    [BookingStatus.Completed, null],
  ])(
    'a visit reopened from %s holds its chair before the trigger runs: an overlapping walk-in is refused',
    async (to, reason) => {
      const world = windowRig();
      // 0. While the visit holds its chair, the walk-in collides with it.
      const before = await world.book(WALK_IN);
      expect(!before.ok && before.error.errorCode).toBe(
        BookingErrorCode.SlotUnavailable,
      );
      // 1. The visit leaves the book (the settled two on its own day).
      expect((await world.transition(command(to, { reason }))).ok).toBe(true);
      const left = world.visit();
      expect(left.bookingStatus).toBe(to);
      // 2. The trigger frees its day: nothing live occupies it.
      await world.trigger(world.confirmed, left);
      expect(world.store.get(BUSY_PATH)).toBeUndefined();
      // 3. The shop reopens it — the trigger has NOT run since.
      const reopened = await world.transition(command(BookingStatus.Confirmed));
      expect(reopened.ok).toBe(true);
      expect(world.visit().bookingStatus).toBe(BookingStatus.Confirmed);
      // 4. A walk-in over the reopened chair is refused, nothing written.
      const plans = world.tx.plans.length;
      const booked = await world.book(WALK_IN);
      expect(!booked.ok && booked.error.errorCode).toBe(
        BookingErrorCode.SlotUnavailable,
      );
      expect(world.tx.plans).toHaveLength(plans);
      // 5. Idempotent with the trigger: its recompute lands on the same body.
      const merged = world.store.get(BUSY_PATH);
      expect(merged).toBeDefined();
      await world.trigger(left, world.visit());
      expect(world.store.get(BUSY_PATH)).toEqual(merged);
    },
  );
});
