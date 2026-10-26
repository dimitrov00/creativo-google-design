import {
  Actor,
  AuditAction,
  type DocBody,
  SeatOccupant,
  SeatLabel,
  WriteOp,
} from '@core/components';
import { AppointmentId, OperationId, SeatId, UserId } from '@core/primitives';
import { BookingErrorCode, SchedulingErrorCode } from '@core/errors';
import { type Appointment, type AuditEntry, Collections } from '@core/entities';
import { AuditSystem } from '@core/systems';
import {
  appointmentFixture,
  cents,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  fixtureHash,
  memoryStore,
  memoryTxPorts,
  recordingTelemetry,
  seatFixture,
} from '@core/testing';
import { recordSeatTip } from './record-seat-tip.pipeline';

const STAFF = Actor.staff(UserId.of('u-staff'), []);
const GUEST_SEAT = SeatId.of('seat-2');
/** The tip's client-minted operation id (WS-4.1 — required on the call). */
const OPERATION = OperationId.of('tip-op-0123456789ab');

function bodyOf(appointment: Appointment): DocBody {
  const { id: _id, ...body } = appointment;
  return body;
}

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
  const rows: AuditEntry[] = [];
  const run = recordSeatTip({
    ...tx,
    ...recordingTelemetry(),
    appendAudit: async (written) => {
      rows.push(...written);
    },
  });
  return { store, tx, rows, run };
}

const PATH = `${Collections.Appointments}/${FIXTURE_IDS.appointment}`;

describe('recordSeatTip', () => {
  it('rewrites the seats with the one tip changed, inside the transaction, and audits the ACT for that seat’s person', async () => {
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
    const before = party();
    expect(tx.plans).toEqual([
      [
        WriteOp.update([Collections.Appointments, before.id], {
          seats: [
            { ...before.seats[0], tipCents: cents(300) },
            before.seats[1],
          ],
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
    expect(rows[0]?.id).toBe(
      fixtureHash(
        AuditSystem.rowBasis(
          AuditAction.BookingTipRecorded,
          FIXTURE_IDS.appointment,
          FIXTURE_IDS.customer,
          AuditSystem.changeKey.tip(FIXTURE_IDS.seat, FIXTURE_NOW_UTC_MS),
        ),
      ),
    );
  });

  it('keys the row `tip:<seat>:<instant>` — byte for byte today’s key; the operation id changes no key in WS-4.1 (DEP-4)', async () => {
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
          FIXTURE_IDS.appointment,
          FIXTURE_IDS.customer,
          `tip:${FIXTURE_IDS.seat}:${FIXTURE_NOW_UTC_MS}`,
        ),
      ),
    ]);
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
