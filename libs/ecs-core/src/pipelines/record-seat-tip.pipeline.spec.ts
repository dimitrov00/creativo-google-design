import {
  Actor,
  AuditAction,
  SeatOccupant,
  SeatLabel,
  WriteOp,
} from '@core/components';
import {
  AppointmentId,
  Currency,
  LogEvent,
  OperationId,
  SeatId,
  UserId,
  AuditResourceId,
} from '@core/primitives';
import {
  BookingErrorCode,
  RepositoryErrorCode,
  SchedulingErrorCode,
} from '@core/errors';
import { type Appointment, type AuditEntry, Collections } from '@core/entities';
import { AuditSystem } from '@core/systems';
import {
  bodyOf,
  appointmentFixture,
  auditRowsOf,
  cents,
  contendedCommit,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  fixtureHash,
  memoryStore,
  memoryTxPorts,
  recordingTelemetry,
  seatFixture,
  unwrapOk,
} from '@core/testing';
import { recordSeatTip } from './record-seat-tip.pipeline';

const STAFF = Actor.staff(UserId.of('u-staff'), []);
const GUEST_SEAT = SeatId.of('seat-2');
/** The tip's client-minted operation id (WS-4.1 — required on the call). */
const OPERATION = OperationId.of('tip-op-0123456789ab');

/** The client's cut and a guest's, side by side. */
function party(): Appointment {
  return appointmentFixture({
    seats: [
      seatFixture(),
      seatFixture({
        seatId: GUEST_SEAT,
        occupant: SeatOccupant.anonymous(SeatLabel.of('Guest')),
      }),
    ],
  });
}

function rig(appointments: readonly Appointment[]) {
  const store = memoryStore(
    appointments.map((appointment) => ({
      path: [Collections.Appointments, appointment.id],
      body: bodyOf(appointment),
    })),
  );
  const tx = memoryTxPorts(store);
  // The rows the committed plans created (WS-1: inside the act's commit).
  const rows: AuditEntry[] = [];
  const telemetry = recordingTelemetry();
  const contended = contendedCommit(tx.commit);
  const pipeline = recordSeatTip({
    ...tx,
    commit: contended.commit,
    ...telemetry,
  });
  const run: typeof pipeline = async (cmd) => {
    const answer = await pipeline(cmd);
    rows.splice(0, rows.length, ...auditRowsOf(tx.plans));
    return answer;
  };
  return { store, tx, rows, telemetry, run, decisions: contended.decisions };
}

/** The row id a tip on the client's seat files. */
const TIP_ROW = fixtureHash(
  AuditSystem.rowBasis(
    AuditAction.BookingTipRecorded,
    AuditResourceId.forAppointment(FIXTURE_IDS.appointment),
    FIXTURE_IDS.customer,
    `tip:${OPERATION}:${FIXTURE_IDS.seat}`,
  ),
);

const PATH = `${Collections.Appointments}/${FIXTURE_IDS.appointment}`;

describe('recordSeatTip', () => {
  it('rewrites the seats with the one tip changed and files the ACT’s row for that seat’s person in the SAME plan, last (WS-1)', async () => {
    const { store, tx, rows, run } = rig([party()]);
    const answer = await run({
      appointmentId: FIXTURE_IDS.appointment,
      seatId: FIXTURE_IDS.seat,
      tipCents: cents(300),
      operationId: OPERATION,
      actor: STAFF,
    });
    expect(answer).toEqual({
      ok: true,
      value: {
        appointmentId: FIXTURE_IDS.appointment,
        seatId: FIXTURE_IDS.seat,
        unchanged: false,
      },
    });
    // The callable answers this value as it is (Law 5 — no wire encoder):
    // exactly these keys, in this order, byte for byte on the wire.
    expect(Object.keys(unwrapOk(answer))).toEqual([
      'appointmentId',
      'seatId',
      'unchanged',
    ]);
    const before = party();
    expect(tx.plans).toEqual([
      [
        WriteOp.update([Collections.Appointments, before.id], {
          seats: [
            { ...before.seats[0], tipCents: cents(300) },
            before.seats[1],
          ],
          // The act that wrote the visit (WS-4.3, DEP-19).
          writeOperationId: OPERATION,
        }),
        WriteOp.create([Collections.AuditLog, TIP_ROW], {
          recordedAtUtcMs: FIXTURE_NOW_UTC_MS,
          resourceId: FIXTURE_IDS.appointment,
          auditOperationId: OPERATION,
          ...STAFF,
          auditAction: AuditAction.BookingTipRecorded,
          tipSeatId: FIXTURE_IDS.seat,
          // The amount, before and after, in the seat's currency (WS-2).
          tipAmountCents: cents(300),
          tipFromCents: null,
          tipCurrency: Currency.EUR,
          auditTarget: 'CUSTOMER',
          targetCustomerId: FIXTURE_IDS.customer,
        }),
      ],
    ]);
    const seats = store.get(PATH)?.['seats'] as readonly {
      tipCents: unknown;
    }[];
    expect(seats.map((seat) => seat.tipCents)).toEqual([300, null]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      auditAction: AuditAction.BookingTipRecorded,
      tipSeatId: FIXTURE_IDS.seat,
      targetCustomerId: FIXTURE_IDS.customer,
    });
    expect(rows[0]?.id).toBe(TIP_ROW);
  });

  it('keys the row `tip:<operationId>:<seat>` — never an instant (WS-1, DEP-6)', async () => {
    const { rows, run } = rig([party()]);
    expect(
      (
        await run({
          appointmentId: FIXTURE_IDS.appointment,
          seatId: FIXTURE_IDS.seat,
          tipCents: cents(300),
          operationId: OPERATION,
          actor: STAFF,
        })
      ).ok,
    ).toBe(true);
    expect(rows.map((row) => row.id)).toEqual([
      fixtureHash(
        AuditSystem.rowBasis(
          AuditAction.BookingTipRecorded,
          AuditResourceId.forAppointment(FIXTURE_IDS.appointment),
          FIXTURE_IDS.customer,
          AuditSystem.changeKey.tip(OPERATION, FIXTURE_IDS.seat),
        ),
      ),
    ]);
  });

  it('the same call twice: the second answers unchanged and plans ZERO audit ops', async () => {
    const { tx, rows, run } = rig([party()]);
    const cmd = {
      appointmentId: FIXTURE_IDS.appointment,
      seatId: FIXTURE_IDS.seat,
      tipCents: cents(300),
      operationId: OPERATION,
      actor: STAFF,
    };
    const first = await run(cmd);
    const second = await run(cmd);
    expect(first.ok && first.value.unchanged).toBe(false);
    expect(second).toEqual({
      ok: true,
      value: {
        appointmentId: FIXTURE_IDS.appointment,
        seatId: FIXTURE_IDS.seat,
        unchanged: true,
      },
    });
    expect(tx.plans[1]).toEqual([]);
    expect(rows.map((row) => row.id)).toEqual([TIP_ROW]);
  });

  it('stamps the stored visit with the act’s operation id; an unchanged figure stamps nothing (WS-4.3, DEP-19)', async () => {
    const { store, tx, run } = rig([party()]);
    const cmd = {
      appointmentId: FIXTURE_IDS.appointment,
      seatId: FIXTURE_IDS.seat,
      tipCents: cents(300),
      operationId: OPERATION,
      actor: STAFF,
    };
    await run(cmd);
    expect(store.get(PATH)?.['writeOperationId']).toBe(OPERATION);
    await run({ ...cmd, operationId: OperationId.of('tip-op-same-figure') });
    expect(tx.plans[1]).toEqual([]);
    expect(store.get(PATH)?.['writeOperationId']).toBe(OPERATION);
  });

  it('commits the tip without a row when no verified actor is known, and logs it loudly', async () => {
    const { store, tx, rows, telemetry, run } = rig([party()]);
    const answer = await run({
      appointmentId: FIXTURE_IDS.appointment,
      seatId: FIXTURE_IDS.seat,
      tipCents: cents(300),
      operationId: OPERATION,
      actor: null,
    });
    expect(answer.ok && answer.value.unchanged).toBe(false);
    const seats = store.get(PATH)?.['seats'] as readonly {
      tipCents: unknown;
    }[];
    expect(seats[0]?.tipCents).toBe(300);
    expect(tx.plans[0]).toHaveLength(1);
    expect(rows).toEqual([]);
    expect(telemetry.lines).toEqual([
      {
        level: 'error',
        msg: LogEvent.AuditActorMissing,
        fields: {
          action: AuditAction.BookingTipRecorded,
          resourceId: FIXTURE_IDS.appointment,
        },
      },
    ]);
  });

  it('a Create of a row already there refuses the WHOLE act as REPOSITORY_ALREADY_EXISTS — nothing applied', async () => {
    const { store, tx, run } = rig([party()]);
    store.set(`${Collections.AuditLog}/${TIP_ROW}`, { seeded: true });
    const answer = await run({
      appointmentId: FIXTURE_IDS.appointment,
      seatId: FIXTURE_IDS.seat,
      tipCents: cents(300),
      operationId: OPERATION,
      actor: STAFF,
    });
    expect(!answer.ok && answer.error.errorCode).toBe(
      RepositoryErrorCode.AlreadyExists,
    );
    const seats = store.get(PATH)?.['seats'] as readonly {
      tipCents: unknown;
    }[];
    expect(seats[0]?.tipCents).toBeNull();
    expect(tx.plans).toEqual([]);
  });

  it('a contention re-run of the decision derives the identical plan — row ids included', async () => {
    const { decisions, run } = rig([party()]);
    await run({
      appointmentId: FIXTURE_IDS.appointment,
      seatId: FIXTURE_IDS.seat,
      tipCents: cents(300),
      operationId: OPERATION,
      actor: STAFF,
    });
    expect(decisions).toHaveLength(2);
    expect(decisions[1]).toEqual(decisions[0]);
  });

  it('a guest’s tip keeps one untargeted row — a label is nobody a history can be asked about', async () => {
    const { rows, run } = rig([party()]);
    await run({
      appointmentId: FIXTURE_IDS.appointment,
      seatId: GUEST_SEAT,
      tipCents: cents(100),
      operationId: OPERATION,
      actor: STAFF,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.auditTarget).toBe('NONE');
  });

  it('clears with null, audited as cleared', async () => {
    const { store, rows, run } = rig([
      appointmentFixture({ seats: [seatFixture({ tipCents: cents(500) })] }),
    ]);
    const answer = await run({
      appointmentId: FIXTURE_IDS.appointment,
      seatId: FIXTURE_IDS.seat,
      tipCents: null,
      operationId: OPERATION,
      actor: STAFF,
    });
    expect(answer.ok && answer.value.unchanged).toBe(false);
    const seats = store.get(PATH)?.['seats'] as readonly {
      tipCents: unknown;
    }[];
    expect(seats[0]?.tipCents).toBeNull();
    expect(rows.map((row) => row.auditAction)).toEqual([
      AuditAction.BookingTipCleared,
    ]);
  });

  it.each([
    ['the same figure again', cents(500), cents(500)],
    ['a second clear', null, null],
  ])(
    '%s is not a change: nothing written, nothing logged',
    async (_case, stored, sent) => {
      const { tx, rows, run } = rig([
        appointmentFixture({ seats: [seatFixture({ tipCents: stored })] }),
      ]);
      const answer = await run({
        appointmentId: FIXTURE_IDS.appointment,
        seatId: FIXTURE_IDS.seat,
        tipCents: sent,
        operationId: OPERATION,
        actor: STAFF,
      });
      expect(answer.ok && answer.value.unchanged).toBe(true);
      expect(tx.plans).toEqual([[]]);
      expect(rows).toEqual([]);
    },
  );

  it('refuses a seat the visit does not hold (UNKNOWN_SEAT) and an unknown visit (appointmentId)', async () => {
    const { tx, run } = rig([appointmentFixture()]);
    const seat = await run({
      appointmentId: FIXTURE_IDS.appointment,
      seatId: SeatId.of('ghost'),
      tipCents: cents(100),
      operationId: OPERATION,
      actor: STAFF,
    });
    expect(!seat.ok && seat.error.errorCode).toBe(
      SchedulingErrorCode.AppointmentUnknownSeat,
    );
    const visit = await run({
      appointmentId: AppointmentId.of('nope'),
      seatId: FIXTURE_IDS.seat,
      tipCents: cents(100),
      operationId: OPERATION,
      actor: STAFF,
    });
    expect(!visit.ok && visit.error.errorCode).toBe(
      BookingErrorCode.InvalidInput,
    );
    expect(tx.plans).toEqual([]);
  });
});
