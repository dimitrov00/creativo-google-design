import {
  Actor,
  type AppliedDiscount,
  AuditAction,
  BookingLifecycle,
  BookingPolicy,
  CancellationReason,
  CancellationReasonSet,
  CancelledBy,
  Combinability,
  CouponValue,
  DiscountProvenance,
  type DocBody,
  GrantCapacityTerms,
  GrantExpiryTerms,
  GrantLifecycle,
  SeatOutcome,
  VoucherCode,
  VoucherLifecycle,
  VoucherRedemption,
  WriteOp,
} from '@core/components';
import {
  AppliedDiscountId,
  AppointmentId,
  CouponGrantId,
  CouponId,
  Currency,
  GiftVoucherId,
  GrantStatus,
  LogEvent,
  OperationId,
  Result,
  UserId,
} from '@core/primitives';
import {
  BookingErrorCode,
  RepositoryError,
  RepositoryErrorCode,
  CancellationRefusalCode,
} from '@core/errors';
import {
  type Appointment,
  type AuditEntry,
  type CouponGrant,
  type GiftVoucher,
  Collections,
} from '@core/entities';
import { AuditSystem, CouponGrantSystem } from '@core/systems';
import {
  appointmentFixture,
  auditRowsOf,
  cents,
  contendedCommit,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  fixtureHash,
  hourCount,
  localDate,
  memoryStore,
  memoryTxPorts,
  recordingTelemetry,
  unwrapOk,
  utcMs,
} from '@core/testing';
import { cancelAppointment } from './cancel-appointment.pipeline';

const CLIENT = Actor.user(FIXTURE_IDS.client);
const VOUCHER = GiftVoucherId.of('v-1');
const GRANT = CouponGrantId.of('grant-1');

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

/** The reward's line on the bill. */
const GRANT_LINE: AppliedDiscount = {
  discountId: AppliedDiscountId.of(`grant:${GRANT}`),
  label: 'Autumn',
  appliedAtUtcMs: utcMs('2026-09-27T10:00:00.000+03:00'),
  combinability: Combinability.Stackable,
  ...DiscountProvenance.grant(GRANT),
  ...unwrapOk(CouponValue.percentOff(10)),
};

/** A figure the desk set beside it. */
const MANUAL_LINE: AppliedDiscount = {
  discountId: AppliedDiscountId.of('manual'),
  label: 'Desk',
  appliedAtUtcMs: utcMs('2026-09-27T10:00:00.000+03:00'),
  combinability: Combinability.Stackable,
  ...DiscountProvenance.manual(),
  ...unwrapOk(CouponValue.percentOff(5)),
};

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
  grants: readonly CouponGrant[] = [],
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
    ...grants.map((each) => ({
      path: [Collections.CouponGrants, each.id],
      body: bodyOf(each),
    })),
  ]);
  const tx = memoryTxPorts(store);
  // The rows the committed plans created (WS-1: inside the act's commit).
  const rows: AuditEntry[] = [];
  const telemetry = recordingTelemetry();
  const contended = contendedCommit(tx.commit);
  const pipeline = cancelAppointment({
    ...tx,
    commit: contended.commit,
    ...telemetry,
    loadPolicy: async () => policy,
  });
  const run: typeof pipeline = async (cmd) => {
    const answer = await pipeline(cmd);
    rows.splice(0, rows.length, ...auditRowsOf(tx.plans));
    return answer;
  };
  return { store, tx, rows, telemetry, run, decisions: contended.decisions };
}

const PATH = `${Collections.Appointments}/${FIXTURE_IDS.appointment}`;
/** The cancel's client-minted operation id (WS-4.1 — required on the call). */
const OPERATION = OperationId.of('cancel-op-0123456789');
/** The row a cancel of the fixture visit files for its client (`cancel:<operationId>`). */
const CANCEL_ROW = fixtureHash(
  AuditSystem.rowBasis(
    AuditAction.BookingCancelled,
    FIXTURE_IDS.appointment,
    FIXTURE_IDS.customer,
    `cancel:${OPERATION}`,
  ),
);

describe('cancelAppointment — the client calling off their own visit', () => {
  it('moves the visit to CANCELLED in ONE variant transition (the old variant’s fields deleted) and every open seat cancelled by the client under the window', async () => {
    const visit = laterVisit();
    const { store, tx, rows, run } = rig([visit]);
    const answer = await run({
      appointmentId: visit.id,
      callerUserId: FIXTURE_IDS.client,
      reason: CancellationReason.Unspecified,
      operationId: OPERATION,
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
        hourCount(24),
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
        // The act's row, LAST in the SAME plan (WS-1).
        WriteOp.create([Collections.AuditLog, CANCEL_ROW], {
          recordedAtUtcMs: FIXTURE_NOW_UTC_MS,
          resourceId: visit.id,
          auditOperationId: OPERATION,
          ...CLIENT,
          auditAction: AuditAction.BookingCancelled,
          cancellationReason: CancellationReason.Unspecified,
          auditTarget: 'CUSTOMER',
          targetCustomerId: FIXTURE_IDS.customer,
        }),
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
    expect(rows[0]?.id).toBe(CANCEL_ROW);
  });

  it('keys the row `cancel:<operationId>` — never an instant (WS-1, DEP-6)', async () => {
    const visit = laterVisit();
    const { rows, run } = rig([visit]);
    expect(
      (
        await run({
          appointmentId: visit.id,
          callerUserId: FIXTURE_IDS.client,
          reason: CancellationReason.Unspecified,
          operationId: OPERATION,
          actor: CLIENT,
        })
      ).ok,
    ).toBe(true);
    expect(rows.map((row) => row.id)).toEqual([
      fixtureHash(
        AuditSystem.rowBasis(
          AuditAction.BookingCancelled,
          visit.id,
          FIXTURE_IDS.customer,
          AuditSystem.changeKey.cancel(OPERATION),
        ),
      ),
    ]);
  });

  it('the same cancel twice: the second is the graph’s NOT_CANCELLABLE, commits nothing and plans ZERO audit ops (RU-4)', async () => {
    const visit = laterVisit();
    const { tx, rows, run } = rig([visit]);
    const cmd = {
      appointmentId: visit.id,
      callerUserId: FIXTURE_IDS.client,
      reason: CancellationReason.Unspecified,
      operationId: OPERATION,
      actor: CLIENT,
    };
    expect((await run(cmd)).ok).toBe(true);
    const again = await run(cmd);
    expect(!again.ok && again.error.errorCode).toBe(
      CancellationRefusalCode.NotCancellable,
    );
    expect(tx.plans).toHaveLength(1);
    expect(rows.map((row) => row.id)).toEqual([CANCEL_ROW]);
  });

  it('commits the cancel without a row when no verified actor is known, and logs it loudly', async () => {
    const visit = laterVisit();
    const { store, tx, rows, telemetry, run } = rig([visit]);
    const answer = await run({
      appointmentId: visit.id,
      callerUserId: FIXTURE_IDS.client,
      reason: CancellationReason.Unspecified,
      operationId: OPERATION,
      actor: null,
    });
    expect(answer).toEqual({ ok: true, value: { appointmentId: visit.id } });
    expect(store.get(PATH)?.['bookingStatus']).toBe('CANCELLED');
    expect(tx.plans[0]).toHaveLength(1);
    expect(rows).toEqual([]);
    expect(telemetry.lines).toEqual([
      {
        level: 'error',
        msg: LogEvent.AuditActorMissing,
        fields: {
          action: AuditAction.BookingCancelled,
          resourceId: visit.id,
        },
      },
    ]);
  });

  it('a Create of a row already there refuses the WHOLE cancel as REPOSITORY_ALREADY_EXISTS — nothing applied', async () => {
    const visit = laterVisit({ voucherRedemptions: [LINE] });
    const { store, tx, run } = rig([visit], [voucher(1000)]);
    store.set(`${Collections.AuditLog}/${CANCEL_ROW}`, { seeded: true });
    const answer = await run({
      appointmentId: visit.id,
      callerUserId: FIXTURE_IDS.client,
      reason: CancellationReason.Unspecified,
      operationId: OPERATION,
      actor: CLIENT,
    });
    expect(!answer.ok && answer.error.errorCode).toBe(
      RepositoryErrorCode.AlreadyExists,
    );
    expect(store.get(PATH)?.['bookingStatus']).toBe('CONFIRMED');
    expect(
      store.get(`${Collections.GiftVouchers}/${VOUCHER}`)?.['balanceCents'],
    ).toBe(1000);
    expect(tx.plans).toEqual([]);
  });

  it('a contention re-run of the decision derives the identical plan — row ids included', async () => {
    const visit = laterVisit();
    const { decisions, run } = rig([visit]);
    await run({
      appointmentId: visit.id,
      callerUserId: FIXTURE_IDS.client,
      reason: CancellationReason.Unspecified,
      operationId: OPERATION,
      actor: CLIENT,
    });
    expect(decisions).toHaveLength(2);
    expect(decisions[1]).toEqual(decisions[0]);
  });

  it('files a typed reason as OTHER (code-only, D23)', async () => {
    const { store, run } = rig([laterVisit()]);
    await run({
      appointmentId: FIXTURE_IDS.appointment,
      callerUserId: FIXTURE_IDS.client,
      reason: CancellationReason.Other,
      operationId: OPERATION,
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
      operationId: OPERATION,
      actor: CLIENT,
    });
    expect(answer.ok).toBe(true);
    expect(tx.transactions[0]?.reads).toEqual([
      [Collections.Appointments, visit.id],
      [Collections.GiftVouchers, VOUCHER],
    ]);
    const plan = tx.plans[0] ?? [];
    // The visit, the voucher's restore and — last — the act's row (WS-1).
    expect(plan).toHaveLength(3);
    expect(plan[2]?.path).toEqual([Collections.AuditLog, CANCEL_ROW]);
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

  it('gives back the reward the bill honoured, in the SAME plan: its line dropped from the bill, the grant ACTIVE again (OR-13)', async () => {
    const visit = laterVisit({
      discounts: [GRANT_LINE, MANUAL_LINE],
      voucherRedemptions: [LINE],
    });
    const spent = spentGrant();
    const { store, tx, run } = rig([visit], [voucher(1000)], undefined, [
      spent,
    ]);
    const answer = await run({
      appointmentId: visit.id,
      callerUserId: FIXTURE_IDS.client,
      reason: CancellationReason.Unspecified,
      operationId: OPERATION,
      actor: CLIENT,
    });
    expect(answer.ok).toBe(true);
    // The grants the bill names ride the transaction's read set — one getAll.
    expect(tx.transactions[0]?.reads).toEqual([
      [Collections.Appointments, visit.id],
      [Collections.GiftVouchers, VOUCHER],
      [Collections.CouponGrants, GRANT],
    ]);
    const plan = tx.plans[0] ?? [];
    expect(plan.map((op) => op.path.join('/'))).toEqual([
      `${Collections.Appointments}/${visit.id}`,
      `${Collections.GiftVouchers}/${VOUCHER}`,
      `${Collections.CouponGrants}/${GRANT}`,
      `${Collections.AuditLog}/${CANCEL_ROW}`,
    ]);
    expect(plan[2]).toEqual(
      CouponGrantSystem.transitionWrite(
        spent,
        unwrapOk(CouponGrantSystem.restore(spent)),
      ),
    );
    // ONE update of the visit: the bill without its grant line, the
    // voucher line reversed, beside the cancel.
    expect(store.get(PATH)).toMatchObject({
      bookingStatus: 'CANCELLED',
      discounts: [MANUAL_LINE],
      voucherRedemptions: [
        VoucherRedemption.reversed(LINE, FIXTURE_NOW_UTC_MS),
      ],
    });
    const grant = store.get(`${Collections.CouponGrants}/${GRANT}`);
    expect(grant?.['grantStatus']).toBe(GrantStatus.Active);
    expect(grant).not.toHaveProperty('usedAtUtcMs');
    expect(grant).not.toHaveProperty('usedNote');
  });

  it('drops the grant line even when the grant cannot take the use back — the cancel still lands', async () => {
    const visit = laterVisit({ discounts: [GRANT_LINE] });
    const { store, tx, run } = rig([visit]);
    const answer = await run({
      appointmentId: visit.id,
      callerUserId: FIXTURE_IDS.client,
      reason: CancellationReason.Unspecified,
      operationId: OPERATION,
      actor: CLIENT,
    });
    expect(answer.ok).toBe(true);
    expect(tx.plans[0]?.map((op) => op.path[0])).toEqual([
      Collections.Appointments,
      Collections.AuditLog,
    ]);
    expect(store.get(PATH)?.['discounts']).toEqual([]);
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
        operationId: OPERATION,
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
      operationId: OPERATION,
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
      operationId: OPERATION,
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
      operationId: OPERATION,
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
