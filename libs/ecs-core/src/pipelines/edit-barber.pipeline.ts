import {
  AuditAction,
  BarberEdit,
  type BarberEditRequest,
  type TeamBarberAction,
  type TeamCall,
  type WriteOp,
} from '@core/components';
import {
  type BarberId,
  defect,
  Result,
  type UtcEpochMs,
} from '@core/primitives';
import { CatalogErrorCode, RepositoryError, TeamError } from '@core/errors';
import {
  type Barber,
  type BarberSchedule,
  Collections,
  type ShopLocation,
  type User,
} from '@core/entities';
import type {
  ClockPorts,
  CommitPorts,
  DefaultLocationPorts,
  HashPorts,
} from '@core/ports';
import {
  StaffAnalyticsSystem,
  TeamSystem,
  ZonedTimeSystem,
} from '@core/systems';
import {
  admitTeamCaller,
  admitTeamStaffCaller,
  TEAM_LOCATIONS,
  type TeamAct,
  teamActor,
} from './team-caller.pipeline';

/**
 * `editBarber` — one part of one barber record, replaced whole (team
 * onboarding D5): the public profile, the shops, the working period, the
 * «Който и да е» flag or who may book them (`barberEdit`). The caller gate
 * first, on the VERIFIED token: a profile is any staff account's to ask
 * for (`admitTeamStaffCaller`), every other part the team manager's
 * (`admitTeamCaller`). Then ONE commit that reads `users/{caller}` and
 * `barbers/{id}` — and, for the shops, every location and the barber's
 * roster — and asks `TeamSystem`:
 *
 * - who may: `admitProfileEdit` for a profile (the content editor, the
 *   admin, or the barber whose account is linked to this very record),
 *   `admit` for the rest — the STORED roles, block and link;
 * - the part's own decision (`editProfile`, `setShops`, `setPeriod`,
 *   `setPool`, `setAccess`), which answers the WHOLE next record. «Today»
 *   for the shops is the default shop's wall clock (else the first shop's),
 *   derived once from the instant read before the transaction.
 *
 * The record is SET whole beside its ONE row — `TEAM_BARBER_PROFILE_` /
 * `SHOPS_` / `PERIOD_` / `POOL_` / `STATUS_CHANGED` — credited to the
 * caller over their stored roles (`TeamSystem.writesOf`). A save that
 * changes no stored field — and so the replay of one that landed — writes
 * no document and no row.
 *
 * The answer: `{ barberId }`. An id with no record is
 * `TEAM_BARBER_NOT_FOUND`, asked only after the caller is admitted.
 */

/** The call as the wire decoded it, with the verified caller. */
export type EditBarberCommand = BarberEditRequest &
  TeamAct & {
    readonly barberId: BarberId;
  };

export type EditBarberPorts = CommitPorts &
  ClockPorts &
  HashPorts &
  DefaultLocationPorts;

type Snapshot = {
  readonly caller: User | null;
  readonly barber: Barber | null;
  /** Every location — read for a shops edit only, else none. */
  readonly shops: readonly ShopLocation[];
  /** The barber's roster — read for a shops edit only, else `null`. */
  readonly schedule: BarberSchedule | null;
};

/** The row's verb for each part. */
function actionOf(barberEdit: BarberEdit): TeamBarberAction {
  switch (barberEdit) {
    case BarberEdit.Profile:
      return AuditAction.TeamBarberProfileChanged;
    case BarberEdit.Shops:
      return AuditAction.TeamBarberShopsChanged;
    case BarberEdit.Period:
      return AuditAction.TeamBarberPeriodChanged;
    case BarberEdit.Pool:
      return AuditAction.TeamBarberPoolChanged;
    case BarberEdit.Access:
      return AuditAction.TeamBarberStatusChanged;
    default:
      return defect(`no audit verb for the edit ${String(barberEdit)}`);
  }
}

/** The part's decision: the whole next record, or the refusal. */
function decide(
  cmd: EditBarberCommand,
  barber: Barber,
  snapshot: Snapshot,
  nowUtcMs: UtcEpochMs,
  ports: DefaultLocationPorts,
): Result<Barber, TeamError | RepositoryError> {
  switch (cmd.barberEdit) {
    case BarberEdit.Profile:
      return TeamSystem.editProfile(barber, cmd, cmd.operationId);
    case BarberEdit.Shops: {
      const clock = StaffAnalyticsSystem.clockLocationOf(
        snapshot.shops,
        ports.defaultLocationId,
      );
      // No shop at all is a broken deployment, not a refusal of this save.
      if (clock === null) {
        return Result.err(
          RepositoryError.readFailed(
            `${Collections.Locations}/${ports.defaultLocationId}`,
            CatalogErrorCode.LocationZoneUnknown,
          ),
        );
      }
      return TeamSystem.setShops(
        barber,
        cmd.locationIds,
        {
          listedShops: snapshot.shops,
          schedule: snapshot.schedule,
          today: ZonedTimeSystem.shopNow(nowUtcMs, clock.timeZone).localDate,
        },
        cmd.operationId,
      );
    }
    case BarberEdit.Period:
      return TeamSystem.setPeriod(
        barber,
        cmd.barberStartsLocalDate,
        cmd.barberLastWorkingLocalDate,
        cmd.operationId,
      );
    case BarberEdit.Pool:
      return TeamSystem.setPool(
        barber,
        cmd.barberJoinsAnyPool,
        cmd.operationId,
      );
    case BarberEdit.Access:
      return TeamSystem.setAccess(
        barber,
        cmd.barberStatus,
        nowUtcMs,
        cmd.operationId,
      );
  }
}

export const editBarber =
  (ports: EditBarberPorts) =>
  async (
    cmd: EditBarberCommand,
  ): Promise<Result<TeamCall.Saved, TeamError | RepositoryError>> => {
    const isProfile = cmd.barberEdit === BarberEdit.Profile;
    const admitted = isProfile
      ? admitTeamStaffCaller(cmd)
      : admitTeamCaller(cmd);
    if (!admitted.ok) return admitted;
    const callerUserId = admitted.value;
    const readsShops = cmd.barberEdit === BarberEdit.Shops;
    // Read once, before the transaction: `decide` may run more than once.
    const nowUtcMs = ports.nowUtcMs();
    const committed = await ports.commit(
      async (tx): Promise<Snapshot> => {
        const [caller, barber, shops, schedule] = await Promise.all([
          tx.get<User>([Collections.Users, callerUserId]),
          tx.get<Barber>([Collections.Barbers, cmd.barberId]),
          readsShops ? tx.query<ShopLocation>(TEAM_LOCATIONS) : [],
          readsShops
            ? tx.get<BarberSchedule>([
                Collections.BarberSchedules,
                cmd.barberId,
              ])
            : null,
        ]);
        return { caller, barber, shops, schedule };
      },
      (
        snapshot,
      ): Result<
        { readonly writes: readonly WriteOp[] },
        TeamError | RepositoryError
      > => {
        const stored = isProfile
          ? TeamSystem.admitProfileEdit(snapshot.caller, cmd.barberId, nowUtcMs)
          : TeamSystem.admit(snapshot.caller, nowUtcMs);
        if (!stored.ok) return stored;
        const before = snapshot.barber;
        if (before === null) {
          return Result.err(TeamError.barberNotFound(cmd.barberId));
        }
        const after = decide(cmd, before, snapshot, nowUtcMs, ports);
        if (!after.ok) return after;
        return Result.ok({
          writes: TeamSystem.writesOf(
            {
              action: actionOf(cmd.barberEdit),
              before,
              after: after.value,
              actor: teamActor(callerUserId, stored.value),
              nowUtcMs,
              operationId: cmd.operationId,
            },
            ports.hash,
          ),
        });
      },
    );
    return committed.ok ? Result.ok({ barberId: cmd.barberId }) : committed;
  };
