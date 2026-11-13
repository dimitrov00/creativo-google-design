import {
  AuditAction,
  type BarberActivationAnswer,
  type TeamCall,
  type WriteOp,
} from '@core/components';
import { type BarberId, Result } from '@core/primitives';
import { type RepositoryError, TeamError } from '@core/errors';
import {
  type Barber,
  type BarberSchedule,
  Collections,
  type Service,
  type User,
} from '@core/entities';
import type { ClockPorts, CommitPorts, HashPorts } from '@core/ports';
import { StaffSetupSystem, TeamSystem } from '@core/systems';
import {
  admitTeamStaffCaller,
  TEAM_SERVICES,
  type TeamAct,
  teamActor,
} from './team-caller.pipeline';

/**
 * `activateBarber` — the go-live step (team onboarding D9,
 * `activateBarberIfReady`): idempotent, asked by the web after any editor
 * saves on a `DRAFT` and when the member page opens, so the editors stay
 * unaware of onboarding. The caller gate first, on the VERIFIED token (any
 * staff role). Then ONE commit that reads `users/{caller}`, `barbers/{id}`,
 * the barber's roster and every service, and asks
 * `TeamSystem.admitActivation` (a stored staff account, not blocked),
 * `StaffSetupSystem.checklistOf` and `TeamSystem.activate`:
 *
 * - a `DRAFT` with every needed item done goes live at the status its
 *   admin set (`barberDraftTargetStatus`) — the record SET whole beside its
 *   ONE `TEAM_BARBER_STATUS_CHANGED` row, credited to the caller;
 * - a `DRAFT` still missing one answers `NOT_READY` and the first missing
 *   item, and writes nothing;
 * - any other record answers `UNCHANGED` and writes nothing — so a replay
 *   of a step that landed is `UNCHANGED`.
 *
 * A failed call leaves the `DRAFT`, which is the safe state; the next call
 * retries. The answer: `{ barberId, barberActivation }`, plus
 * `staffSetupItem` when not ready.
 */

/** The call as the wire decoded it, with the verified caller. */
export type ActivateBarberCommand = TeamAct & {
  readonly barberId: BarberId;
};

export type ActivateBarberPorts = CommitPorts & ClockPorts & HashPorts;

type Snapshot = {
  readonly caller: User | null;
  readonly barber: Barber | null;
  readonly schedule: BarberSchedule | null;
  readonly services: readonly Service[];
};

/** The transaction's decision: the step's answer and its plan. */
type Activation = {
  readonly answer: BarberActivationAnswer;
  readonly writes: readonly WriteOp[];
};

export const activateBarber =
  (ports: ActivateBarberPorts) =>
  async (
    cmd: ActivateBarberCommand,
  ): Promise<Result<TeamCall.Activation, TeamError | RepositoryError>> => {
    const admitted = admitTeamStaffCaller(cmd);
    if (!admitted.ok) return admitted;
    const callerUserId = admitted.value;
    // Read once, before the transaction: `decide` may run more than once.
    const nowUtcMs = ports.nowUtcMs();
    const committed = await ports.commit(
      async (tx): Promise<Snapshot> => {
        const [caller, barber, schedule, services] = await Promise.all([
          tx.get<User>([Collections.Users, callerUserId]),
          tx.get<Barber>([Collections.Barbers, cmd.barberId]),
          tx.get<BarberSchedule>([Collections.BarberSchedules, cmd.barberId]),
          tx.query<Service>(TEAM_SERVICES),
        ]);
        return { caller, barber, schedule, services };
      },
      ({
        caller,
        barber,
        schedule,
        services,
      }): Result<Activation, TeamError> => {
        const stored = TeamSystem.admitActivation(caller, nowUtcMs);
        if (!stored.ok) return stored;
        if (barber === null) {
          return Result.err(TeamError.barberNotFound(cmd.barberId));
        }
        const step = TeamSystem.activate(
          barber,
          StaffSetupSystem.checklistOf(barber, services, schedule),
          nowUtcMs,
          cmd.operationId,
        );
        return Result.ok({
          answer: step.answer,
          writes:
            step.barber === null
              ? []
              : TeamSystem.writesOf(
                  {
                    action: AuditAction.TeamBarberStatusChanged,
                    before: barber,
                    after: step.barber,
                    actor: teamActor(callerUserId, stored.value),
                    nowUtcMs,
                    operationId: cmd.operationId,
                  },
                  ports.hash,
                ),
        });
      },
    );
    return committed.ok
      ? Result.ok({ barberId: cmd.barberId, ...committed.value.answer })
      : committed;
  };
