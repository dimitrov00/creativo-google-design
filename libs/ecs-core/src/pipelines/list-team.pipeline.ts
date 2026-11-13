import type { TeamCall, WriteOp } from '@core/components';
import { Result } from '@core/primitives';
import type { RepositoryError, TeamError } from '@core/errors';
import {
  type Barber,
  type BarberSchedule,
  Collections,
  type Service,
  type User,
} from '@core/entities';
import type { ClockPorts, CommitPorts } from '@core/ports';
import { TeamRosterSystem, TeamSystem } from '@core/systems';
import {
  admitTeamCaller,
  TEAM_BARBERS,
  TEAM_ROSTERS,
  TEAM_SERVICES,
  TEAM_STAFF_ACCOUNTS,
  type TeamCaller,
} from './team-caller.pipeline';

/**
 * `listTeam` — the Team page's one read (team onboarding D8,
 * `docs/designs/team-onboarding.md`): every barber record, whatever its
 * lifecycle, and every staff account, as the page's rows. The caller gate
 * first, on the VERIFIED token (`admitTeamCaller`: the team manager's).
 * Then ONE read-only transaction — a consistent snapshot, and the caller
 * judged on their STORED account beside it, as every team callable judges
 * (`TeamSystem.admit`) — that reads `users/{caller}`, every barber record,
 * every account holding a staff role, every roster and every service;
 * `TeamRosterSystem.membersOf` derives the rows. Nothing is written.
 *
 * The answer: `{ members }` — ids, names, roles, shop days and counts; no
 * contact of anyone. A refusal answers `TEAM_UNAUTHENTICATED` or
 * `TEAM_FORBIDDEN`; a store failure answers as the read answers it.
 */

/** The verified caller — the call names nothing else. */
export type ListTeamCommand = TeamCaller;

export type ListTeamPorts = CommitPorts & ClockPorts;

type Snapshot = {
  readonly caller: User | null;
  readonly barbers: readonly Barber[];
  readonly accounts: readonly User[];
  readonly schedules: readonly BarberSchedule[];
  readonly services: readonly Service[];
};

/** The decision of a read: its answer, and no write. */
const NO_WRITES: readonly WriteOp[] = [];

export const listTeam =
  (ports: ListTeamPorts) =>
  async (
    cmd: ListTeamCommand,
  ): Promise<Result<TeamCall.Listed, TeamError | RepositoryError>> => {
    const admitted = admitTeamCaller(cmd);
    if (!admitted.ok) return admitted;
    const callerUserId = admitted.value;
    const nowUtcMs = ports.nowUtcMs();
    return ports.commit(
      async (tx): Promise<Snapshot> => {
        const [caller, barbers, accounts, schedules, services] =
          await Promise.all([
            tx.get<User>([Collections.Users, callerUserId]),
            tx.query<Barber>(TEAM_BARBERS),
            tx.query<User>(TEAM_STAFF_ACCOUNTS),
            tx.query<BarberSchedule>(TEAM_ROSTERS),
            tx.query<Service>(TEAM_SERVICES),
          ]);
        return { caller, barbers, accounts, schedules, services };
      },
      ({ caller, ...facts }) => {
        const stored = TeamSystem.admit(caller, nowUtcMs);
        return stored.ok
          ? Result.ok({
              members: TeamRosterSystem.membersOf(facts),
              writes: NO_WRITES,
            })
          : stored;
      },
    );
  };
