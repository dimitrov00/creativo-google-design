import { StaffTarget, type TeamCall, type WriteOp } from '@core/components';
import { Result, StaffCapability, type UtcEpochMs } from '@core/primitives';
import type { AccessError, RepositoryError, TeamError } from '@core/errors';
import type { Barber, BarberSchedule, Service, User } from '@core/entities';
import type { ClockPorts, CommitPorts } from '@core/ports';
import { StaffAccessSystem, TeamRosterSystem } from '@core/systems';
import {
  admitTeamCaller,
  readStaffCaller,
  type StaffCallerFacts,
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
 * first, on the VERIFIED token (`admitTeamCaller`: any staff role). Then
 * ONE read-only transaction — a consistent snapshot, and the caller judged
 * on their STORED account beside it, as every team callable judges.
 *
 * It reads `users/{caller}` and `settings/staffPermissions` FIRST and asks
 * how much of the list the caller may see (staff permissions P6):
 *
 * - `TEAM_MANAGE` — every row: the barber records with their accounts,
 *   then the staff accounts linked to no record;
 * - `TEAM_PROFILES` or `TEAM_OFFERINGS` for everyone — the barber records
 *   only, with no account beside them and no role-only row: an editor of
 *   every barber's page needs the list of barbers, never who holds which
 *   role;
 * - neither — the `TEAM_MANAGE` refusal, and the transaction stops BEFORE
 *   its collection queries: a refused caller costs two document reads.
 *
 * Then every barber record, every roster and every service — and, for the
 * full list, every account holding a staff role;
 * `TeamRosterSystem.membersOf` derives the rows. Nothing is written.
 *
 * The answer: `{ members }` — ids, names, roles, shop days and counts; no
 * contact of anyone. A refusal answers `TEAM_UNAUTHENTICATED` or an
 * `ACCESS_*` code; a store failure answers as the read answers it.
 */

/** The verified caller — the call names nothing else. */
export type ListTeamCommand = TeamCaller;

export type ListTeamPorts = CommitPorts & ClockPorts;

/** How much of the team a caller may list. */
type Reach = {
  /** `false`: the barber records only — no account is read. */
  readonly withAccounts: boolean;
};

type Snapshot = {
  /** What the caller may list, or why nothing. */
  readonly reach: Result<Reach, AccessError>;
  readonly barbers: readonly Barber[];
  /** Every staff account — `null` when the caller may not see accounts. */
  readonly accounts: readonly User[] | null;
  readonly schedules: readonly BarberSchedule[];
  readonly services: readonly Service[];
};

/** The decision of a read: its answer, and no write. */
const NO_WRITES: readonly WriteOp[] = [];

/** The two capabilities that edit every barber's page — each, for everyone, lists the barber records. */
const RECORD_EDITORS = [
  StaffCapability.TeamProfiles,
  StaffCapability.TeamOfferings,
] as const;

/**
 * What the caller may list: every row for the team's manager, the barber
 * records for an editor of every barber's profile or offerings — else the
 * manager's refusal.
 */
function reachOf(
  facts: StaffCallerFacts,
  nowUtcMs: UtcEpochMs,
): Result<Reach, AccessError> {
  const admit = (staffCapability: StaffCapability) =>
    StaffAccessSystem.admit({
      staffCapability,
      staffTarget: StaffTarget.SHOP,
      ...facts,
      nowUtcMs,
    });
  const manager = admit(StaffCapability.TeamManage);
  if (manager.ok) return Result.ok({ withAccounts: true });
  for (const staffCapability of RECORD_EDITORS) {
    if (admit(staffCapability).ok) return Result.ok({ withAccounts: false });
  }
  return manager;
}

export const listTeam =
  (ports: ListTeamPorts) =>
  async (
    cmd: ListTeamCommand,
  ): Promise<
    Result<TeamCall.Listed, TeamError | AccessError | RepositoryError>
  > => {
    const admitted = admitTeamCaller(cmd);
    if (!admitted.ok) return admitted;
    const callerUserId = admitted.value;
    const nowUtcMs = ports.nowUtcMs();
    return ports.commit(
      async (tx): Promise<Snapshot> => {
        const reach = reachOf(
          await readStaffCaller(tx, callerUserId),
          nowUtcMs,
        );
        // A refused caller: nothing more is read.
        if (!reach.ok) {
          return {
            reach,
            barbers: [],
            accounts: null,
            schedules: [],
            services: [],
          };
        }
        const [barbers, accounts, schedules, services] = await Promise.all([
          tx.query<Barber>(TEAM_BARBERS),
          reach.value.withAccounts ? tx.query<User>(TEAM_STAFF_ACCOUNTS) : null,
          tx.query<BarberSchedule>(TEAM_ROSTERS),
          tx.query<Service>(TEAM_SERVICES),
        ]);
        return { reach, barbers, accounts, schedules, services };
      },
      ({ reach, ...facts }) =>
        reach.ok
          ? Result.ok({
              members: TeamRosterSystem.membersOf(facts),
              writes: NO_WRITES,
            })
          : reach,
    );
  };
