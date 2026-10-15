import {
  Actor,
  AuditAction,
  BookingLifecycle,
  BookingPolicy,
  CancellationReason,
  CancellationReasonSet,
  type DocBody,
  SeatOccupant,
  SeatLabel,
  SeatOutcome,
  VoucherCode,
  VoucherLifecycle,
  VoucherRedemption,
  WriteOp,
} from '@core/components';
import {
  AppointmentId,
  BookingErrorCode,
  BookingStatus,
  Currency,
  GiftVoucherId,
  RepositoryError,
  Result,
  SchedulingErrorCode,
  SeatId,
  UserId,
} from '@core/primitives';
import {
  type Appointment,
  type AuditEntry,
  type GiftVoucher,
  Collections,
  QueryOp,
} from '@core/entities';
import { AuditSystem } from '@core/systems';
import {
  appointmentFixture,
  cents,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  fixtureHash,
  localDate,
  locationFixture,
  memoryStore,
  memoryTxPorts,
  recordingTelemetry,
  seatFixture,
  utcMs,
} from '@core/testing';
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
    readonly policy?: Result<BookingPolicy, RepositoryError>;
  } = {},
) {
  const store = memoryStore([
    {
      path: [Collections.Locations, FIXTURE_IDS.location],
      body: bodyOf(locationFixture()),
    },
    ...appointments.map((appointment) => ({
      path: [Collections.Appointments, appointment.id],
      body: bodyOf(appointment),
    })),
    ...(options.vouchers ?? []).map((each) => ({
      path: [Collections.GiftVouchers, each.id],
      body: bodyOf(each),
    })),
  ]);
  const tx = memoryTxPorts(store);
  const rows: AuditEntry[] = [];
  const telemetry = recordingTelemetry();
  let policyReads = 0;
  const run = transitionAppointment({
    ...tx,
    ...telemetry,
    loadPolicy: async () => {
      policyReads++;
      return options.policy ?? Result.ok(BookingPolicy.DEFAULT);
    },
    appendAudit: async (written) => {
      rows.push(...written);
    },
  });
  return { store, tx, rows, telemetry, run, policyReads: () => policyReads };
}

const PATH = `${Collections.Appointments}/${FIXTURE_IDS.appointment}`;

function command(
  to: BookingStatus,
  extra: { seatId?: SeatId | null; reason?: CancellationReason | null } = {},
) {
  return {
    appointmentId: FIXTURE_IDS.appointment,
    to,
    seatId: extra.seatId ?? null,
    reason: extra.reason ?? null,
    actor: STAFF,
  };
}

describe('transitionAppointment — the shop’s lifecycle pen', () => {
  it('confirms a pending booking: one transition, the pending stamp deleted, audited as the staff verb', async () => {
    const pending = appointmentFixture({
      lifecycle: BookingLifecycle.pending(
        utcMs('2026-09-27T09:00:00.000+03:00'),
      ),
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
          },
          ['pendingAtUtcMs'],
        ),
      ],
    ]);
    expect(rows.map((row) => row.auditAction)).toEqual([
      AuditAction.BookingStaffConfirmed,
    ]);
    expect(rows[0]?.id).toBe(
      fixtureHash(
        AuditSystem.rowBasis(
          AuditAction.BookingStaffConfirmed,
          pending.id,
          FIXTURE_IDS.customer,
          AuditSystem.changeKey.transition(null, FIXTURE_NOW_UTC_MS),
        ),
      ),
    );
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
      fixtureHash(
        AuditSystem.rowBasis(
          AuditAction.BookingStaffNoShow,
          FIXTURE_IDS.appointment,
          FIXTURE_IDS.customer,
          AuditSystem.changeKey.transition(
            FIXTURE_IDS.seat,
            FIXTURE_NOW_UTC_MS,
          ),
        ),
      ),
    );
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
    expect(tx.plans[0]).toHaveLength(2);
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
    expect(!refused.ok && refused.error.errorCode).toBe(
      BookingErrorCode.SlotUnavailable,
    );
    expect(taken.tx.plans).toEqual([]);
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
