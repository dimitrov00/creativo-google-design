import type { Actor, WriteOp } from '@core/components';
import {
  BookingError,
  type RepositoryError,
  Result,
  type SchedulingError,
  type AppointmentId,
} from '@core/primitives';
import type { GovernancePorts, TelemetryPorts, TxPorts } from '@core/ports';
import {
  type AuditFact,
  AppointmentLifecycleSystem,
  type LifecycleStep,
} from '@core/systems';
import { appendAuditFacts, readAppointment } from './booking-read-set.pipeline';

/**
 * `markArrived` / `clearArrival` — ONE pipeline, the verb a tag of the
 * command (blueprint §4.1): the party walked in, or the stamp is taken
 * back. The decision is `AppointmentLifecycleSystem.markArrived` /
 * `clearArrival` — first stamp wins (a second tap writes nothing and audits
 * nothing), clearing what was never set is a no-op, a settled visit
 * refuses either. One read (the appointment), one root update, then the
 * act's row AFTER the commit (`arrived:<stamp>` / `unarrived:<stamp>`).
 */

/** The verb — the field `markArrivalAction`, the ONLY source of these strings. */
export const MarkArrivalAction = {
  Arrive: 'ARRIVE',
  Clear: 'CLEAR',
} as const;
export type MarkArrivalAction =
  (typeof MarkArrivalAction)[keyof typeof MarkArrivalAction];

export type MarkArrivalCommand = {
  readonly markArrivalAction: MarkArrivalAction;
  readonly appointmentId: AppointmentId;
  /** The verified caller the row names; `null` logs loudly and writes no row. */
  readonly actor: Actor | null;
};

export type MarkArrivalAnswer = {
  readonly appointmentId: AppointmentId;
  /** Nothing changed — already arrived (a second tap), or already clear. */
  readonly unchanged: boolean;
};

/**
 * What it refuses with: no such visit (`BOOKING_INVALID_INPUT`, field
 * `appointmentId` — the edge answers it as the callable's own not-found),
 * a settled visit (the lifecycle's `SCHEDULING_APPOINTMENT_NOT_ARRIVABLE`),
 * or the store.
 */
export type MarkArrivalError =
  BookingError.InvalidInput | SchedulingError | RepositoryError;

export type MarkArrivalPorts = TxPorts &
  Pick<GovernancePorts, 'appendAudit'> &
  TelemetryPorts;

type Decided = {
  readonly auditFacts: readonly AuditFact[];
  readonly writes: readonly WriteOp[];
};

export const markArrival =
  (ports: MarkArrivalPorts) =>
  async (
    cmd: MarkArrivalCommand,
  ): Promise<Result<MarkArrivalAnswer, MarkArrivalError>> => {
    // One instant per request: the stamp written and the row's change key.
    const nowUtcMs = ports.nowUtcMs();
    const committed = await ports.commit(
      (tx) => readAppointment(tx, cmd.appointmentId),
      (appointment): Result<Decided, MarkArrivalError> => {
        if (appointment === null) {
          return Result.err(BookingError.invalidInput('appointmentId'));
        }
        const step: Result<LifecycleStep, SchedulingError> =
          cmd.markArrivalAction === MarkArrivalAction.Arrive
            ? AppointmentLifecycleSystem.markArrived(appointment, nowUtcMs)
            : AppointmentLifecycleSystem.clearArrival(appointment);
        if (!step.ok) return step;
        return Result.ok({
          auditFacts: step.value.auditFacts,
          writes: step.value.writes,
        });
      },
    );
    if (!committed.ok) return committed;
    await appendAuditFacts(ports, committed.value.auditFacts, cmd.actor);
    return Result.ok({
      appointmentId: cmd.appointmentId,
      unchanged: committed.value.auditFacts.length === 0,
    });
  };
