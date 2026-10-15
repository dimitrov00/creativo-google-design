import {
  Actor,
  AuditAction,
  BookingLifecycle,
  type DocBody,
  WriteOp,
} from '@core/components';
import {
  AppointmentId,
  BookingErrorCode,
  SchedulingErrorCode,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import { type Appointment, type AuditEntry, Collections } from '@core/entities';
import { AuditSystem } from '@core/systems';
import {
  appointmentFixture,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  fixtureHash,
  memoryStore,
  memoryTxPorts,
  recordingTelemetry,
} from '@core/testing';
import { MarkArrivalAction, markArrival } from './mark-arrival.pipeline';

const STAFF = Actor.staff(UserId.of('u-staff'), []);

function bodyOf(appointment: Appointment): DocBody {
  const { id: _id, ...body } = appointment;
  return body;
}

function rig(appointments: readonly Appointment[]) {
  const store = memoryStore(
    appointments.map((appointment) => ({
      path: [Collections.Appointments, appointment.id],
      body: bodyOf(appointment),
    })),
  );
  const tx = memoryTxPorts(store);
  const rows: AuditEntry[] = [];
  const telemetry = recordingTelemetry();
  const run = markArrival({
    ...tx,
    ...telemetry,
    appendAudit: async (written) => {
      rows.push(...written);
    },
  });
  return { store, tx, rows, telemetry, run };
}

const PATH = `${Collections.Appointments}/${FIXTURE_IDS.appointment}`;

describe('markArrival', () => {
  it('stamps the arrival with the request’s instant in ONE root update, then audits it after the commit', async () => {
    const { store, tx, rows, run } = rig([appointmentFixture()]);
    const answer = await run({
      markArrivalAction: MarkArrivalAction.Arrive,
      appointmentId: FIXTURE_IDS.appointment,
      actor: STAFF,
    });
    expect(answer).toEqual({
      ok: true,
      value: { appointmentId: FIXTURE_IDS.appointment, unchanged: false },
    });
    expect(store.get(PATH)?.['arrivedAtUtcMs']).toBe(FIXTURE_NOW_UTC_MS);
    expect(tx.plans).toHaveLength(1);
    const [write] = tx.plans[0] ?? [];
    expect(write?.writeAction).toBe('UPDATE');
    expect(write?.path).toEqual([
      Collections.Appointments,
      FIXTURE_IDS.appointment,
    ]);
    // The read set is the appointment alone.
    expect(tx.transactions[0]?.reads).toEqual([
      [Collections.Appointments, FIXTURE_IDS.appointment],
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      auditAction: AuditAction.BookingStaffArrived,
      resourceId: FIXTURE_IDS.appointment,
      auditTarget: 'CUSTOMER',
      targetCustomerId: FIXTURE_IDS.customer,
    });
    expect(rows[0]?.id).toBe(
      fixtureHash(
        AuditSystem.rowBasis(
          AuditAction.BookingStaffArrived,
          FIXTURE_IDS.appointment,
          FIXTURE_IDS.customer,
          AuditSystem.changeKey.arrived(FIXTURE_NOW_UTC_MS),
        ),
      ),
    );
  });

  it('a second tap changes nothing: no write, no row — the first stamp wins', async () => {
    const earlier = UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, -60_000);
    const { store, tx, rows, run } = rig([
      appointmentFixture({ arrivedAtUtcMs: earlier }),
    ]);
    const answer = await run({
      markArrivalAction: MarkArrivalAction.Arrive,
      appointmentId: FIXTURE_IDS.appointment,
      actor: STAFF,
    });
    expect(answer.ok && answer.value.unchanged).toBe(true);
    expect(store.get(PATH)?.['arrivedAtUtcMs']).toBe(earlier);
    expect(tx.plans).toEqual([[]]);
    expect(rows).toEqual([]);
  });

  it('clears a stamp, keyed by the stamp it took back', async () => {
    const earlier = UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, -60_000);
    const { store, rows, run } = rig([
      appointmentFixture({ arrivedAtUtcMs: earlier }),
    ]);
    const answer = await run({
      markArrivalAction: MarkArrivalAction.Clear,
      appointmentId: FIXTURE_IDS.appointment,
      actor: STAFF,
    });
    expect(answer.ok && answer.value.unchanged).toBe(false);
    expect(store.get(PATH)?.['arrivedAtUtcMs']).toBeNull();
    expect(rows.map((row) => row.auditAction)).toEqual([
      AuditAction.BookingStaffUnarrived,
    ]);
    expect(rows[0]?.id).toBe(
      fixtureHash(
        AuditSystem.rowBasis(
          AuditAction.BookingStaffUnarrived,
          FIXTURE_IDS.appointment,
          FIXTURE_IDS.customer,
          AuditSystem.changeKey.unarrived(earlier),
        ),
      ),
    );
  });

  it('clearing what was never set is a no-op, not an error', async () => {
    const { tx, rows, run } = rig([appointmentFixture()]);
    const answer = await run({
      markArrivalAction: MarkArrivalAction.Clear,
      appointmentId: FIXTURE_IDS.appointment,
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

  it('logs loudly and writes no row when no verified actor is known — the stamp still stands', async () => {
    const { store, rows, telemetry, run } = rig([appointmentFixture()]);
    const answer = await run({
      markArrivalAction: MarkArrivalAction.Arrive,
      appointmentId: FIXTURE_IDS.appointment,
      actor: null,
    });
    expect(answer.ok).toBe(true);
    expect(store.get(PATH)?.['arrivedAtUtcMs']).toBe(FIXTURE_NOW_UTC_MS);
    expect(rows).toEqual([]);
    expect(telemetry.lines.map((line) => line.msg)).toEqual([
      'audit row has no verified actor',
    ]);
  });

  it('plans exactly the lifecycle system’s write', async () => {
    const { tx, run } = rig([appointmentFixture()]);
    await run({
      markArrivalAction: MarkArrivalAction.Arrive,
      appointmentId: FIXTURE_IDS.appointment,
      actor: STAFF,
    });
    const before = appointmentFixture();
    expect(tx.plans[0]).toEqual([
      WriteOp.transition(
        [Collections.Appointments, before.id],
        {
          ...BookingLifecycle.sliceOf(before),
          seats: before.seats,
          arrivedAtUtcMs: FIXTURE_NOW_UTC_MS,
        },
        [],
      ),
    ]);
  });
});
