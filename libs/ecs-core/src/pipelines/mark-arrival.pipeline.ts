import { type Actor, MarkArrivalAction, type WriteOp } from '@core/components';
import { Result, type AppointmentId, type OperationId } from '@core/primitives';
import {
  BookingError,
  type MarkArrivalError,
  type SchedulingError,
} from '@core/errors';
import type { TelemetryPorts, TxPorts } from '@core/ports';
import {
  type AuditFact,
  AppointmentLifecycleSystem,
  AuditSystem,
  type LifecycleStep,
} from '@core/systems';
import { logUnaudited, readAppointment } from './booking-read-set.pipeline';

/**
 * `markArrived` / `clearArrival` — ONE pipeline, the verb a tag of the
 * command (blueprint §4.1): the party walked in, or the stamp is taken
 * back. The decision is `AppointmentLifecycleSystem.markArrived` /
 * `clearArrival` — first stamp wins (a second tap writes nothing and audits
 * nothing), clearing what was never set is a no-op, a settled visit
 * refuses either. One read (the appointment), one commit: the root update
 * and the act's rows (`arrived:<operationId>` / `unarrived:<operationId>`),
 * `Create`d in the SAME plan (WS-1) — an unchanged tap plans neither, so a
 * replay never meets its own row.
 */

export type MarkArrivalCommand = {
  /** The verb — `MarkArrivalAction` (`@core/components`). */
  readonly markArrivalAction: MarkArrivalAction;
  readonly appointmentId: AppointmentId;
  /** The act's operation id — the client-minted name of this ONE act, REQUIRED (WS-4.1). */
  readonly operationId: OperationId;
  /** The verified caller the row names; `null` logs loudly and writes no row. */
  readonly actor: Actor | null;
};

export type MarkArrivalAnswer = {
  readonly appointmentId: AppointmentId;
  /** Nothing changed — already arrived (a second tap), or already clear. */
  readonly unchanged: boolean;
};

export type MarkArrivalPorts = TxPorts & TelemetryPorts;

type Decided = {
  /** The lifecycle step wrote nothing — never the audit creates (DEP-8 withdrawn). */
  readonly unchanged: boolean;
  /** The facts no row was planned for: no verified actor. */
  readonly unaudited: readonly AuditFact[];
  readonly writes: readonly WriteOp[];
};

export const markArrival =
  (ports: MarkArrivalPorts) =>
  async (
    cmd: MarkArrivalCommand,
  ): Promise<Result<MarkArrivalAnswer, MarkArrivalError>> => {
    // One instant per request, read before the transaction: the stamp
    // written and the rows' instant — a contention re-run of `decide`
    // derives the same plan, row ids included.
    const nowUtcMs = ports.nowUtcMs();
    const committed = await ports.commit(
      (tx) => readAppointment(tx, cmd.appointmentId),
      (appointment): Result<Decided, MarkArrivalError> => {
        if (appointment === null) {
          return Result.err(BookingError.invalidInput('appointmentId'));
        }
        const step: Result<LifecycleStep, SchedulingError> =
          cmd.markArrivalAction === MarkArrivalAction.Arrive
            ? AppointmentLifecycleSystem.markArrived(
                appointment,
                nowUtcMs,
                cmd.operationId,
              )
            : AppointmentLifecycleSystem.clearArrival(
                appointment,
                cmd.operationId,
              );
        if (!step.ok) return step;
        const audit = AuditSystem.commitWrites(
          step.value.auditFacts,
          cmd.actor,
          nowUtcMs,
          ports.hash,
        );
        return Result.ok({
          unchanged: step.value.writes.length === 0,
          unaudited: audit.unaudited,
          writes: [...step.value.writes, ...audit.writes],
        });
      },
    );
    if (!committed.ok) return committed;
    logUnaudited(ports, committed.value.unaudited);
    return Result.ok({
      appointmentId: cmd.appointmentId,
      unchanged: committed.value.unchanged,
    });
  };
