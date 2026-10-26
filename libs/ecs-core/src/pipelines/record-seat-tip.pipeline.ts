import { type Actor, AuditContext, WriteOp } from '@core/components';
import {
  Result,
  type AppointmentId,
  AuditResourceId,
  type OperationId,
  type PriceCents,
  type SeatId,
} from '@core/primitives';
import { BookingError, type RecordSeatTipError } from '@core/errors';
import type { TelemetryPorts, TxPorts } from '@core/ports';
import {
  AuditDeltaSystem,
  type AuditFact,
  AuditSystem,
  BillingSystem,
} from '@core/systems';
import {
  appointmentPath,
  logUnaudited,
  readAppointment,
} from './booking-read-set.pipeline';

/**
 * `recordSeatTip` — what was left for whoever did the work, on ONE seat
 * (the tip's one home: a party can be two barbers). `null` clears it. The
 * same figure again is not a change: a retried call or a second tap on
 * «Запази» writes nothing and logs nothing. Otherwise the stored seats are
 * rewritten with that one field changed — inside the transaction, so the
 * read is what the write is conditioned on — and the act's row (the act AND
 * the amount, before and after, in the seat's currency — WS-2) is
 * `Create`d in the SAME plan (WS-1), keyed by the act's operation id and
 * the seat (`tip:<operationId>:<seatId>`) and naming that seat's person.
 * An unchanged figure plans no row, so a replay never meets its own.
 */

export type RecordSeatTipCommand = {
  readonly appointmentId: AppointmentId;
  readonly seatId: SeatId;
  /** In the seat's own currency; `null` clears ("not recorded" — never zero). */
  readonly tipCents: PriceCents | null;
  /** The act's operation id — the client-minted name of this ONE act, REQUIRED (WS-4.1). */
  readonly operationId: OperationId;
  readonly actor: Actor | null;
};

export type RecordSeatTipAnswer = {
  readonly appointmentId: AppointmentId;
  readonly seatId: SeatId;
  /** The stored figure already was this one — nothing written, nothing logged. */
  readonly unchanged: boolean;
};

export type RecordSeatTipPorts = TxPorts & TelemetryPorts;

/** The decision: whether anything changes and the facts it could not audit, with the plan beside it. */
type Decided = {
  readonly unaudited: readonly AuditFact[];
  readonly unchanged: boolean;
  readonly writes: readonly WriteOp[];
};

export const recordSeatTip =
  (ports: RecordSeatTipPorts) =>
  async (
    cmd: RecordSeatTipCommand,
  ): Promise<Result<RecordSeatTipAnswer, RecordSeatTipError>> => {
    // Read before the transaction: a contention re-run of `decide` derives
    // the same plan, row ids included.
    const recordedAtUtcMs = ports.nowUtcMs();
    const committed = await ports.commit(
      (tx) => readAppointment(tx, cmd.appointmentId),
      (appointment): Result<Decided, RecordSeatTipError> => {
        if (appointment === null) {
          return Result.err(BookingError.invalidInput('appointmentId'));
        }
        const tip = BillingSystem.recordTip(
          appointment,
          cmd.seatId,
          cmd.tipCents,
        );
        if (!tip.ok) return tip;
        if (tip.value === null) {
          return Result.ok({ unaudited: [], unchanged: true, writes: [] });
        }
        const audit = AuditSystem.commitWrites(
          [
            {
              resourceId: AuditResourceId.forAppointment(appointment.id),
              subjects: AuditSystem.subjectsOfSeats(
                appointment.seats,
                cmd.seatId,
              ),
              changeKey: AuditSystem.changeKey.tip(cmd.operationId, cmd.seatId),
              operationId: cmd.operationId,
              context: AuditContext.tip(
                tip.value.auditAction,
                cmd.seatId,
                AuditDeltaSystem.tipOnSeat(
                  appointment.seats,
                  tip.value.seats,
                  cmd.seatId,
                ),
              ),
            },
          ],
          cmd.actor,
          recordedAtUtcMs,
          ports.hash,
        );
        return Result.ok({
          unaudited: audit.unaudited,
          unchanged: false,
          writes: [
            WriteOp.update(appointmentPath(appointment.id), {
              seats: tip.value.seats,
            }),
            ...audit.writes,
          ],
        });
      },
    );
    if (!committed.ok) return committed;
    logUnaudited(ports, committed.value.unaudited);
    return Result.ok({
      appointmentId: cmd.appointmentId,
      seatId: cmd.seatId,
      unchanged: committed.value.unchanged,
    });
  };
