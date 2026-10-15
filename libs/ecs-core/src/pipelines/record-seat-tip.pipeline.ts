import {
  type Actor,
  AuditAction,
  AuditContext,
  Seat,
  WriteOp,
} from '@core/components';
import {
  BookingError,
  type RepositoryError,
  Result,
  SchedulingError,
  type AppointmentId,
  AuditResourceId,
  type PriceCents,
  type SeatId,
} from '@core/primitives';
import type { GovernancePorts, TelemetryPorts, TxPorts } from '@core/ports';
import { type AuditFact, AuditSystem } from '@core/systems';
import {
  appendAuditFacts,
  appointmentPath,
  readAppointment,
} from './booking-read-set.pipeline';

/**
 * `recordSeatTip` — what was left for whoever did the work, on ONE seat
 * (the tip's one home: a party can be two barbers). `null` clears it. The
 * same figure again is not a change: a retried call or a second tap on
 * «Запази» writes nothing and logs nothing. Otherwise the stored seats are
 * rewritten with that one field changed — inside the transaction, so the
 * read is what the write is conditioned on — and the act's row (the act,
 * never the amount) is appended AFTER the commit, keyed by the seat and the
 * instant (`tip:<seatId>:<recordedAtUtcMs>`) and naming that seat's person.
 */

export type RecordSeatTipCommand = {
  readonly appointmentId: AppointmentId;
  readonly seatId: SeatId;
  /** In the seat's own currency; `null` clears ("not recorded" — never zero). */
  readonly tipCents: PriceCents | null;
  readonly actor: Actor | null;
};

export type RecordSeatTipAnswer = {
  readonly appointmentId: AppointmentId;
  readonly seatId: SeatId;
  /** The stored figure already was this one — nothing written, nothing logged. */
  readonly unchanged: boolean;
};

/**
 * No such visit (`BOOKING_INVALID_INPUT`, field `appointmentId`), no such
 * seat on it (`SCHEDULING_APPOINTMENT_UNKNOWN_SEAT`) — the edge answers both
 * as the callable's not-found — or the store.
 */
export type RecordSeatTipError =
  | BookingError.InvalidInput
  | SchedulingError.AppointmentUnknownSeat
  | RepositoryError;

export type RecordSeatTipPorts = TxPorts &
  Pick<GovernancePorts, 'appendAudit'> &
  TelemetryPorts;

/** The decision: its facts and whether anything changes, with the plan beside it. */
type Decided = {
  readonly auditFacts: readonly AuditFact[];
  readonly unchanged: boolean;
  readonly writes: readonly WriteOp[];
};

export const recordSeatTip =
  (ports: RecordSeatTipPorts) =>
  async (
    cmd: RecordSeatTipCommand,
  ): Promise<Result<RecordSeatTipAnswer, RecordSeatTipError>> => {
    const recordedAtUtcMs = ports.nowUtcMs();
    const committed = await ports.commit(
      (tx) => readAppointment(tx, cmd.appointmentId),
      (appointment): Result<Decided, RecordSeatTipError> => {
        if (appointment === null) {
          return Result.err(BookingError.invalidInput('appointmentId'));
        }
        let index = -1;
        for (let i = 0; i < appointment.seats.length && index < 0; i++) {
          if ((appointment.seats[i] as Seat).seatId === cmd.seatId) index = i;
        }
        if (index < 0) {
          return Result.err(SchedulingError.appointmentUnknownSeat(cmd.seatId));
        }
        const seat = appointment.seats[index] as Seat;
        if (seat.tipCents === cmd.tipCents) {
          return Result.ok({ auditFacts: [], unchanged: true, writes: [] });
        }
        const seats: Seat[] = [];
        for (let i = 0; i < appointment.seats.length; i++) {
          const each = appointment.seats[i] as Seat;
          seats.push(i === index ? Seat.withTip(each, cmd.tipCents) : each);
        }
        return Result.ok({
          auditFacts: [
            {
              resourceId: AuditResourceId.forAppointment(appointment.id),
              subjects: AuditSystem.subjectsOfSeats(
                appointment.seats,
                cmd.seatId,
              ),
              changeKey: AuditSystem.changeKey.tip(cmd.seatId, recordedAtUtcMs),
              context: AuditContext.tip(
                cmd.tipCents === null
                  ? AuditAction.BookingTipCleared
                  : AuditAction.BookingTipRecorded,
                cmd.seatId,
              ),
            },
          ],
          unchanged: false,
          writes: [WriteOp.update(appointmentPath(appointment.id), { seats })],
        });
      },
    );
    if (!committed.ok) return committed;
    await appendAuditFacts(ports, committed.value.auditFacts, cmd.actor);
    return Result.ok({
      appointmentId: cmd.appointmentId,
      seatId: cmd.seatId,
      unchanged: committed.value.unchanged,
    });
  };
