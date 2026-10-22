import {
  Actor,
  AuditAction,
  BookingLifecycle,
  BookingPolicy,
  CancellationReason,
  CancellationReasonSet,
  CancelledBy,
  type DocBody,
  SeatOutcome,
  VoucherCode,
  VoucherLifecycle,
  VoucherRedemption,
  WriteOp,
} from '@core/components';
import {
  AppointmentId,
  BookingErrorCode,
  Currency,
  GiftVoucherId,
  RepositoryError,
  Result,
  UserId,
  CancellationRefusalCode,
} from '@core/primitives';
import {
  type Appointment,
  type AuditEntry,
  type GiftVoucher,
  Collections,
} from '@core/entities';
import { AuditSystem } from '@core/systems';
import {
  appointmentFixture,
  cents,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  fixtureHash,
  localDate,
  memoryStore,
  memoryTxPorts,
  recordingTelemetry,
  utcMs,
} from '@core/testing';
import { cancelAppointment } from './cancel-appointment.pipeline';

const CLIENT = Actor.user(FIXTURE_IDS.client);
const VOUCHER = GiftVoucherId.of('v-1');

function bodyOf<E extends { readonly id: string }>(entity: E): DocBody {
  const { id: _id, ...body } = entity;
  return body;
}

/** The client's visit three days ahead — well outside the 24 h window. */
function laterVisit(
  extra: Parameters<typeof appointmentFixture>[0] = {},
): Appointment {
  return appointmentFixture({
    localDate: localDate('2026-10-01'),
    utcEpochMs: utcMs('2026-10-01T10:00:00.000+03:00'),
    ...extra,
  });
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

const LINE: VoucherRedemption = {
  voucherId: VOUCHER,
  code: VoucherCode.of('GIFT50'),
  amountCents: cents(2000),
  balanceAfterCents: cents(1000),
  currency: Currency.EUR,
  appliedAtUtcMs: utcMs('2026-09-27T10:00:00.000+03:00'),
  reversedAtUtcMs: null,
};

function rig(
  appointments: readonly Appointment[],
  vouchers: readonly GiftVoucher[] = [],
  policy: Result<BookingPolicy, RepositoryError> = Result.ok(
    BookingPolicy.DEFAULT,
  ),
) {
  const store = memoryStore([
    ...appointments.map((appointment) => ({
      path: [Collections.Appointments, appointment.id],
      body: bodyOf(appointment),
    })),
    ...vouchers.map((each) => ({
      path: [Collections.GiftVouchers, each.id],
      body: bodyOf(each),
    })),
  ]);
  const tx = memoryTxPorts(store);
  const rows: AuditEntry[] = [];
  const telemetry = recordingTelemetry();
  const run = cancelAppointment({
    ...tx,
    ...telemetry,
    loadPolicy: async () => policy,
    appendAudit: async (written) => {
      rows.push(...written);
    },
  });
  return { store, tx, rows, telemetry, run };
}

const PATH = `${Collections.Appointments}/${FIXTURE_IDS.appointment}`;

describe('cancelAppointment — the client calling off their own visit', () => {
  it('moves the visit to CANCELLED in ONE variant transition (the old variant’s fields deleted) and every open seat cancelled by the client under the window', async () => {
    const visit = laterVisit();
    const { store, tx, rows, run } = rig([visit]);
    const answer = await run({
      appointmentId: visit.id,
      callerUserId: FIXTURE_IDS.client,
      reason: CancellationReason.Unspecified,
      actor: CLIENT,
    });
    expect(answer).toEqual({ ok: true, value: { appointmentId: visit.id } });
    const seat = visit.seats[0];
    const cancelledSeat = {
      ...seat,
      ...SeatOutcome.cancelled(
        FIXTURE_NOW_UTC_MS,
        CancelledBy.Client,
        CancellationReason.Unspecified,
        24,
      ),
    };
    const after = BookingLifecycle.cancel(
      FIXTURE_NOW_UTC_MS,
      CancellationReasonSet.of([CancellationReason.Unspecified]),
    );
    expect(tx.plans).toEqual([
      [
        WriteOp.transition(
          [Collections.Appointments, visit.id],
          { ...after, seats: [cancelledSeat], arrivedAtUtcMs: null },
          ['confirmedAtUtcMs'],
        ),
      ],
    ]);
    expect(store.get(PATH)).toMatchObject({
      bookingStatus: 'CANCELLED',
      cancelledAtUtcMs: FIXTURE_NOW_UTC_MS,
    });
    expect(store.get(PATH)).not.toHaveProperty('confirmedAtUtcMs');
    // The read set: the visit (no live voucher lines, so nothing else).
    expect(tx.transactions[0]?.reads).toEqual([
      [Collections.Appointments, visit.id],
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      auditAction: AuditAction.BookingCancelled,
      cancellationReason: CancellationReason.Unspecified,
      targetCustomerId: FIXTURE_IDS.customer,
    });
    expect(rows[0]?.id).toBe(
      fixtureHash(
        AuditSystem.rowBasis(
          AuditAction.BookingCancelled,
          visit.id,
          FIXTURE_IDS.customer,
          AuditSystem.changeKey.cancelled(FIXTURE_NOW_UTC_MS),
        ),
      ),
    );
  });

  it('files a typed reason as OTHER (code-only, D23)', async () => {
    const { store, run } = rig([laterVisit()]);
    await run({
      appointmentId: FIXTURE_IDS.appointment,
      callerUserId: FIXTURE_IDS.client,
      reason: CancellationReason.Other,
      actor: CLIENT,
    });
    expect(store.get(PATH)?.['cancellationReason']).toBe('OTHER');
  });

  it('gives back what gift vouchers paid, in the SAME plan: the line reversed, the balance restored', async () => {
    const visit = laterVisit({ voucherRedemptions: [LINE] });
    const { store, tx, run } = rig([visit], [voucher(1000)]);
    const answer = await run({
      appointmentId: visit.id,
      callerUserId: FIXTURE_IDS.client,
      reason: CancellationReason.Unspecified,
      actor: CLIENT,
    });
    expect(answer.ok).toBe(true);
    expect(tx.transactions[0]?.reads).toEqual([
      [Collections.Appointments, visit.id],
      [Collections.GiftVouchers, VOUCHER],
    ]);
    const plan = tx.plans[0] ?? [];
    expect(plan).toHaveLength(2);
    expect(plan[1]).toEqual(
      WriteOp.transition(
        [Collections.GiftVouchers, VOUCHER],
        { balanceCents: cents(3000), voucherStatus: 'ACTIVE' },
        [],
      ),
    );
    expect(
      store.get(`${Collections.GiftVouchers}/${VOUCHER}`)?.['balanceCents'],
    ).toBe(3000);
    expect(store.get(PATH)?.['voucherRedemptions']).toEqual([
      VoucherRedemption.reversed(LINE, FIXTURE_NOW_UTC_MS),
    ]);
  });

  it('answers somebody else’s visit exactly as one that is not there — an id’s existence is no leak', async () => {
    const { tx, run } = rig([laterVisit()]);
    for (const [appointmentId, callerUserId] of [
      [FIXTURE_IDS.appointment, UserId.of('u-someone-else')],
      [AppointmentId.of('nope'), FIXTURE_IDS.client],
    ] as const) {
      const answer = await run({
        appointmentId,
        callerUserId,
        reason: CancellationReason.Unspecified,
        actor: CLIENT,
      });
      expect(!answer.ok && answer.error).toMatchObject({
        errorCode: BookingErrorCode.InvalidInput,
        field: 'appointmentId',
      });
    }
    expect(tx.plans).toEqual([]);
  });

  it('refuses a visit the graph will not let go — the retry of a committed cancel included (NOT_CANCELLABLE)', async () => {
    const { tx, rows, run } = rig([
      laterVisit({
        lifecycle: BookingLifecycle.cancel(
          FIXTURE_NOW_UTC_MS,
          CancellationReasonSet.of([CancellationReason.Unspecified]),
        ),
      }),
    ]);
    const answer = await run({
      appointmentId: FIXTURE_IDS.appointment,
      callerUserId: FIXTURE_IDS.client,
      reason: CancellationReason.Unspecified,
      actor: CLIENT,
    });
    expect(!answer.ok && answer.error.errorCode).toBe(
      CancellationRefusalCode.NotCancellable,
    );
    expect(tx.plans).toEqual([]);
    expect(rows).toEqual([]);
  });

  it('refuses inside the free-cancellation window (WINDOW_CLOSED, naming the hours)', async () => {
    // The fixture visit is at 10:00 today — an hour away, inside 24 h.
    const { tx, run } = rig([appointmentFixture()]);
    const answer = await run({
      appointmentId: FIXTURE_IDS.appointment,
      callerUserId: FIXTURE_IDS.client,
      reason: CancellationReason.Unspecified,
      actor: CLIENT,
    });
    expect(!answer.ok && answer.error).toMatchObject({
      errorCode: CancellationRefusalCode.WindowClosed,
      windowHours: 24,
    });
    expect(tx.plans).toEqual([]);
  });

  it('refuses when the policy cannot be read — before the transaction, nothing read, a warning logged', async () => {
    const { tx, telemetry, run } = rig(
      [laterVisit()],
      [],
      Result.err(RepositoryError.readFailed('settings/bookingPolicy', 'down')),
    );
    const answer = await run({
      appointmentId: FIXTURE_IDS.appointment,
      callerUserId: FIXTURE_IDS.client,
      reason: CancellationReason.Unspecified,
      actor: CLIENT,
    });
    expect(answer).toEqual({
      ok: false,
      error: { errorCode: CancellationRefusalCode.PolicyUnavailable },
    });
    expect(tx.transactions).toEqual([]);
    expect(telemetry.lines.map((line) => line.level)).toEqual(['warn']);
  });
});
