import {
  Actor,
  AuditAction,
  BookingLifecycle,
  MarkArrivalAction,
  WriteOp,
} from '@core/components';
import {
  AppointmentId,
  LogEvent,
  OperationId,
  UserId,
  UtcEpochMs,
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
  contendedCommit,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  fixtureHash,
  memoryStore,
  memoryTxPorts,
  recordingTelemetry,
} from '@core/testing';
import { markArrival } from './mark-arrival.pipeline';

const STAFF = Actor.staff(UserId.of('u-staff'), []);
/** The tap's client-minted operation id (WS-4.1 — required on the call). */
const OPERATION = OperationId.of('arrival-op-0123456789');

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
  const pipeline = markArrival({
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

/** The row id an arrival act files for the fixture's one client record. */
function rowId(
  action:
    | typeof AuditAction.BookingStaffArrived
    | typeof AuditAction.BookingStaffUnarrived,
  changeKey: string,
): string {
  return fixtureHash(
    AuditSystem.rowBasis(
      action,
      AuditResourceId.forAppointment(FIXTURE_IDS.appointment),
      FIXTURE_IDS.customer,
      changeKey,
    ),
  );
}

const PATH = `${Collections.Appointments}/${FIXTURE_IDS.appointment}`;

describe('markArrival', () => {
  it('stamps the arrival with the request’s instant and files its row in the SAME plan, the row last (WS-1)', async () => {
    const { store, tx, rows, run } = rig([appointmentFixture()]);
    const answer = await run({
      markArrivalAction: MarkArrivalAction.Arrive,
      appointmentId: FIXTURE_IDS.appointment,
      operationId: OPERATION,
      actor: STAFF,
    });
    expect(answer).toEqual({
      ok: true,
      value: { appointmentId: FIXTURE_IDS.appointment, unchanged: false },
    });
    expect(store.get(PATH)?.['arrivedAtUtcMs']).toBe(FIXTURE_NOW_UTC_MS);
    expect(tx.plans).toHaveLength(1);
    const [write, audit] = tx.plans[0] ?? [];
    expect(tx.plans[0]).toHaveLength(2);
    expect(write?.writeAction).toBe('UPDATE');
    expect(write?.path).toEqual([
      Collections.Appointments,
      FIXTURE_IDS.appointment,
    ]);
    expect(audit?.writeAction).toBe('CREATE');
    expect(audit?.path).toEqual([
      Collections.AuditLog,
      rowId(AuditAction.BookingStaffArrived, `arrived:${OPERATION}`),
    ]);
    // The read set is the appointment alone.
    expect(tx.transactions[0]?.reads).toEqual([
      [Collections.Appointments, FIXTURE_IDS.appointment],
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: rowId(AuditAction.BookingStaffArrived, `arrived:${OPERATION}`),
      recordedAtUtcMs: FIXTURE_NOW_UTC_MS,
      resourceId: FIXTURE_IDS.appointment,
      auditOperationId: OPERATION,
      ...STAFF,
      auditAction: AuditAction.BookingStaffArrived,
      auditTarget: 'CUSTOMER',
      targetCustomerId: FIXTURE_IDS.customer,
    });
  });

  it('keys the rows `arrived:<operationId>` / `unarrived:<operationId>` — never an instant (WS-1, DEP-6)', async () => {
    const arrive = rig([appointmentFixture()]);
    expect(
      (
        await arrive.run({
          markArrivalAction: MarkArrivalAction.Arrive,
          appointmentId: FIXTURE_IDS.appointment,
          operationId: OPERATION,
          actor: STAFF,
        })
      ).ok,
    ).toBe(true);
    const earlier = UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, -60_000);
    const clear = rig([appointmentFixture({ arrivedAtUtcMs: earlier })]);
    expect(
      (
        await clear.run({
          markArrivalAction: MarkArrivalAction.Clear,
          appointmentId: FIXTURE_IDS.appointment,
          operationId: OPERATION,
          actor: STAFF,
        })
      ).ok,
    ).toBe(true);
    expect([...arrive.rows, ...clear.rows].map((row) => row.id)).toEqual([
      rowId(
        AuditAction.BookingStaffArrived,
        AuditSystem.changeKey.arrived(OPERATION),
      ),
      rowId(
        AuditAction.BookingStaffUnarrived,
        AuditSystem.changeKey.unarrived(OPERATION),
      ),
    ]);
  });

  it('a second tap changes nothing: no write, no row — the first stamp wins', async () => {
    const earlier = UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, -60_000);
    const { store, tx, rows, run } = rig([
      appointmentFixture({ arrivedAtUtcMs: earlier }),
    ]);
    const answer = await run({
      markArrivalAction: MarkArrivalAction.Arrive,
      appointmentId: FIXTURE_IDS.appointment,
      operationId: OPERATION,
      actor: STAFF,
    });
    expect(answer.ok && answer.value.unchanged).toBe(true);
    expect(store.get(PATH)?.['arrivedAtUtcMs']).toBe(earlier);
    expect(tx.plans).toEqual([[]]);
    expect(rows).toEqual([]);
  });

  it('clears a stamp, keyed by its own operation', async () => {
    const earlier = UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, -60_000);
    const { store, rows, run } = rig([
      appointmentFixture({ arrivedAtUtcMs: earlier }),
    ]);
    const answer = await run({
      markArrivalAction: MarkArrivalAction.Clear,
      appointmentId: FIXTURE_IDS.appointment,
      operationId: OPERATION,
      actor: STAFF,
    });
    expect(answer.ok && answer.value.unchanged).toBe(false);
    expect(store.get(PATH)?.['arrivedAtUtcMs']).toBeNull();
    expect(rows.map((row) => row.auditAction)).toEqual([
      AuditAction.BookingStaffUnarrived,
    ]);
    expect(rows[0]?.id).toBe(
      rowId(AuditAction.BookingStaffUnarrived, `unarrived:${OPERATION}`),
    );
    expect(rows[0]?.auditOperationId).toBe(OPERATION);
  });

  it('clearing what was never set is a no-op, not an error', async () => {
    const { tx, rows, run } = rig([appointmentFixture()]);
    const answer = await run({
      markArrivalAction: MarkArrivalAction.Clear,
      appointmentId: FIXTURE_IDS.appointment,
      operationId: OPERATION,
      actor: STAFF,
    });
    expect(answer).toEqual({
      ok: true,
      value: { appointmentId: FIXTURE_IDS.appointment, unchanged: true },
    });
    expect(tx.plans).toEqual([[]]);
    expect(rows).toEqual([]);
  });

  it.each([MarkArrivalAction.Arrive, MarkArrivalAction.Clear])(
    'refuses %s on a settled visit (NOT_ARRIVABLE), writing nothing',
    async (markArrivalAction) => {
      const { tx, rows, run } = rig([
        appointmentFixture({
          lifecycle: BookingLifecycle.complete(FIXTURE_NOW_UTC_MS),
        }),
      ]);
      const answer = await run({
        markArrivalAction,
        appointmentId: FIXTURE_IDS.appointment,
        operationId: OPERATION,
        actor: STAFF,
      });
      expect(answer.ok).toBe(false);
      expect(!answer.ok && answer.error.errorCode).toBe(
        SchedulingErrorCode.AppointmentNotArrivable,
      );
      expect(tx.plans).toEqual([]);
      expect(rows).toEqual([]);
    },
  );

  it('answers an unknown visit as invalid input on appointmentId (the edge’s not-found)', async () => {
    const { run } = rig([]);
    const answer = await run({
      markArrivalAction: MarkArrivalAction.Arrive,
      appointmentId: AppointmentId.of('nope'),
      operationId: OPERATION,
      actor: STAFF,
    });
    expect(answer).toEqual({
      ok: false,
      error: {
        errorCode: BookingErrorCode.InvalidInput,
        field: 'appointmentId',
        detail: null,
        reason: null,
      },
    });
  });

  it('logs loudly and writes no row when no verified actor is known — the stamp still stands, `unchanged: false` (DEP-8 withdrawn)', async () => {
    const { store, tx, rows, telemetry, run } = rig([appointmentFixture()]);
    const answer = await run({
      markArrivalAction: MarkArrivalAction.Arrive,
      appointmentId: FIXTURE_IDS.appointment,
      operationId: OPERATION,
      actor: null,
    });
    expect(answer).toEqual({
      ok: true,
      value: { appointmentId: FIXTURE_IDS.appointment, unchanged: false },
    });
    expect(store.get(PATH)?.['arrivedAtUtcMs']).toBe(FIXTURE_NOW_UTC_MS);
    expect(tx.plans[0]).toHaveLength(1);
    expect(rows).toEqual([]);
    expect(telemetry.lines).toEqual([
      {
        level: 'error',
        msg: LogEvent.AuditActorMissing,
        fields: {
          action: AuditAction.BookingStaffArrived,
          resourceId: FIXTURE_IDS.appointment,
        },
      },
    ]);
  });

  it('the same call twice: the second answers unchanged and plans ZERO audit ops — it never meets its own row', async () => {
    const { tx, rows, run } = rig([appointmentFixture()]);
    const cmd = {
      markArrivalAction: MarkArrivalAction.Arrive,
      appointmentId: FIXTURE_IDS.appointment,
      operationId: OPERATION,
      actor: STAFF,
    };
    const first = await run(cmd);
    const second = await run(cmd);
    expect(first.ok && first.value.unchanged).toBe(false);
    expect(second).toEqual({
      ok: true,
      value: { appointmentId: FIXTURE_IDS.appointment, unchanged: true },
    });
    expect(tx.plans).toHaveLength(2);
    expect(tx.plans[1]).toEqual([]);
    expect(rows).toHaveLength(1);
  });

  it('stamps the stored visit with the act’s operation id; an unchanged tap stamps nothing (WS-4.3, DEP-19)', async () => {
    const { store, tx, run } = rig([appointmentFixture()]);
    const cmd = {
      markArrivalAction: MarkArrivalAction.Arrive,
      appointmentId: FIXTURE_IDS.appointment,
      operationId: OPERATION,
      actor: STAFF,
    };
    await run(cmd);
    expect(store.get(PATH)?.['writeOperationId']).toBe(OPERATION);
    const second = await run({
      ...cmd,
      operationId: OperationId.of('arrival-op-second-tap'),
    });
    expect(second.ok && second.value.unchanged).toBe(true);
    expect(tx.plans[1]).toEqual([]);
    expect(store.get(PATH)?.['writeOperationId']).toBe(OPERATION);
    const undo = OperationId.of('arrival-op-undo-0001');
    await run({
      ...cmd,
      markArrivalAction: MarkArrivalAction.Clear,
      operationId: undo,
    });
    expect(store.get(PATH)?.['writeOperationId']).toBe(undo);
  });

  it('a Create of a row already there refuses the WHOLE act as REPOSITORY_ALREADY_EXISTS — nothing applied', async () => {
    const id = rowId(AuditAction.BookingStaffArrived, `arrived:${OPERATION}`);
    const { store, tx, run } = rig([appointmentFixture()]);
    store.set(`${Collections.AuditLog}/${id}`, { seeded: true });
    const answer = await run({
      markArrivalAction: MarkArrivalAction.Arrive,
      appointmentId: FIXTURE_IDS.appointment,
      operationId: OPERATION,
      actor: STAFF,
    });
    expect(!answer.ok && answer.error.errorCode).toBe(
      RepositoryErrorCode.AlreadyExists,
    );
    expect(store.get(PATH)?.['arrivedAtUtcMs']).toBeNull();
    expect(store.get(`${Collections.AuditLog}/${id}`)).toEqual({
      seeded: true,
    });
    expect(tx.plans).toEqual([]);
  });

  it('a contention re-run of the decision derives the identical plan — row ids included', async () => {
    const { decisions, run } = rig([appointmentFixture()]);
    await run({
      markArrivalAction: MarkArrivalAction.Arrive,
      appointmentId: FIXTURE_IDS.appointment,
      operationId: OPERATION,
      actor: STAFF,
    });
    expect(decisions).toHaveLength(2);
    expect(decisions[1]).toEqual(decisions[0]);
  });

  it('plans exactly the lifecycle system’s write, then the row', async () => {
    const { tx, run } = rig([appointmentFixture()]);
    await run({
      markArrivalAction: MarkArrivalAction.Arrive,
      appointmentId: FIXTURE_IDS.appointment,
      operationId: OPERATION,
      actor: STAFF,
    });
    const before = appointmentFixture();
    expect(tx.plans[0]?.[0]).toEqual(
      WriteOp.transition(
        [Collections.Appointments, before.id],
        {
          ...BookingLifecycle.sliceOf(before),
          seats: before.seats,
          arrivedAtUtcMs: FIXTURE_NOW_UTC_MS,
          // The act that wrote the visit (WS-4.3, DEP-19).
          writeOperationId: OPERATION,
        },
        [],
      ),
    );
  });
});
