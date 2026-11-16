import {
  type Actor,
  AuditAction,
  BarberEdit,
  type BarberEditRequest,
  StaffTarget,
  type TeamBarberAction,
  type TeamCall,
  type WriteOp,
} from '@core/components';
import {
  type BarberId,
  defect,
  Result,
  StaffCapability,
  type UtcEpochMs,
} from '@core/primitives';
import {
  type AccessError,
  CatalogErrorCode,
  RepositoryError,
  TeamError,
} from '@core/errors';
import {
  type Barber,
  type BarberSchedule,
  Collections,
  type ShopLocation,
} from '@core/entities';
import type {
  ClockPorts,
  CommitPorts,
  DefaultLocationPorts,
  HashPorts,
} from '@core/ports';
import {
  EmploymentSystem,
  StaffAccessSystem,
  StaffAnalyticsSystem,
  TeamSystem,
  ZonedTimeSystem,
} from '@core/systems';
import {
  closeIfEnded,
  endOwedSessions,
  type CloseIfEndedPorts,
} from './close-barber-period.pipeline';
import {
  admitTeamCaller,
  readStaffCaller,
  type StaffCallerFacts,
  TEAM_LOCATIONS,
  type TeamAct,
  teamActor,
} from './team-caller.pipeline';

/**
 * `editBarber` — one part of one barber record, replaced whole (team
 * onboarding D5): the public profile, the shops, the working period, the
 * «Който и да е» flag or who may book them (`barberEdit`) — and the return
 * of a record that has left («Върни в екипа», D10). The caller gate
 * first, on the VERIFIED token (`admitTeamCaller`: any staff role). Then
 * ONE commit that reads `users/{caller}`, `settings/staffPermissions` and
 * `barbers/{id}` — and, for the shops, every location and the barber's
 * roster — and asks:
 *
 * - who may (`StaffAccessSystem.admit`, staff permissions P6):
 *   `TEAM_PROFILES` on the barber named for a profile — by default the
 *   content editor, the admin, or the barber whose account is linked to
 *   this very record — and `TEAM_MANAGE` on the shop for every other part
 *   — by default the admin alone. The STORED roles, block and link;
 * - the part's own decision (`TeamSystem.editProfile`, `setShops`, `setPeriod`,
 *   `setPool`, `setAccess`, `rehire`), which answers the WHOLE next record. «Today»
 *   for the shops is the default shop's wall clock (else the first shop's),
 *   derived once from the instant read before the transaction.
 *
 * The record is SET whole beside its ONE row — `TEAM_BARBER_PROFILE_` /
 * `SHOPS_` / `PERIOD_` / `POOL_` / `STATUS_CHANGED` — credited to the
 * caller over their stored roles (`TeamSystem.writesOf`). A save that
 * changes no stored field — and so the replay of one that landed — writes
 * no document and no row.
 *
 * A RETURN is the one act a record that has left takes
 * (`TeamSystem.rehire`): the same record, live again where the close said
 * a rehire returns, on a new working period — beside its
 * `TEAM_BARBER_STATUS_CHANGED` row, and with the week the barber last
 * worked standing again in the roster from the new start
 * (`EmploymentSystem.rosterWritesOnReturn`), all in the one commit. Its
 * account is not brought back: the owner links one again, as for anyone.
 *
 * «ОПИТАЙ ПАК» (`END_SESSIONS`) is the one act that writes nothing of the
 * record: for a record that has left it runs, after the gate's commit, the
 * revoke a close still owes (`endOwedSessions` — the step the daily job
 * retries each night), credited to the caller. Sessions that could not be
 * ended again are `TEAM_SESSIONS_NOT_ENDED`; a record that has not left
 * is `TEAM_BARBER_NOT_DEPARTED`; one that owes nothing is simply saved.
 *
 * A WORKING PERIOD WHOSE LAST DAY HAS ALREADY PASSED is closed at once
 * (team onboarding D10): after the period's own commit, the same close the
 * daily job runs (`closeIfEnded`) takes the record off the team, credited
 * to the caller. It cannot refuse the edit, which has landed; a close that
 * could not run is logged and the daily job catches it up.
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
  DefaultLocationPorts &
  CloseIfEndedPorts;

/** What the edit's commit leaves for the step after it. */
type Edited = {
  /** The record as the edit left it. */
  readonly barber: Barber;
  /** The caller, as the edit's row credits them. */
  readonly actor: Actor;
  readonly writes: readonly WriteOp[];
};

type Snapshot = StaffCallerFacts & {
  readonly barber: Barber | null;
  /** Every location — read for a shops edit only, else none. */
  readonly shops: readonly ShopLocation[];
  /** The barber's roster — read for a shops edit and a return, else `null`. */
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
    // «Опитай пак» (END_SESSIONS) moves nothing in its commit, so no row is
    // written under this verb: the revoke's marker is its own status row.
    case BarberEdit.Access:
    case BarberEdit.Return:
    case BarberEdit.EndSessions:
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
    case BarberEdit.EndSessions:
      return TeamSystem.leaver(barber);
    case BarberEdit.Return:
      return TeamSystem.rehire(
        barber,
        cmd.barberStartsLocalDate,
        nowUtcMs,
        cmd.operationId,
      );
  }
}

export const editBarber =
  (ports: EditBarberPorts) =>
  async (
    cmd: EditBarberCommand,
  ): Promise<
    Result<TeamCall.Saved, TeamError | AccessError | RepositoryError>
  > => {
    const isProfile = cmd.barberEdit === BarberEdit.Profile;
    const admitted = admitTeamCaller(cmd);
    if (!admitted.ok) return admitted;
    const callerUserId = admitted.value;
    const readsShops = cmd.barberEdit === BarberEdit.Shops;
    // A return brings the week the barber last worked back with it.
    const readsRoster = readsShops || cmd.barberEdit === BarberEdit.Return;
    // Read once, before the transaction: `decide` may run more than once.
    const nowUtcMs = ports.nowUtcMs();
    const committed = await ports.commit(
      async (tx): Promise<Snapshot> => {
        const [facts, barber, shops, schedule] = await Promise.all([
          readStaffCaller(tx, callerUserId),
          tx.get<Barber>([Collections.Barbers, cmd.barberId]),
          readsShops ? tx.query<ShopLocation>(TEAM_LOCATIONS) : [],
          readsRoster
            ? tx.get<BarberSchedule>([
                Collections.BarberSchedules,
                cmd.barberId,
              ])
            : null,
        ]);
        return { ...facts, barber, shops, schedule };
      },
      (snapshot): Result<Edited, TeamError | AccessError | RepositoryError> => {
        const stored = StaffAccessSystem.admit({
          staffCapability: isProfile
            ? StaffCapability.TeamProfiles
            : StaffCapability.TeamManage,
          staffTarget: isProfile
            ? StaffTarget.barbers([cmd.barberId])
            : StaffTarget.SHOP,
          caller: snapshot.caller,
          permissions: snapshot.permissions,
          nowUtcMs,
        });
        if (!stored.ok) return stored;
        const before = snapshot.barber;
        if (before === null) {
          return Result.err(TeamError.barberNotFound(cmd.barberId));
        }
        const after = decide(cmd, before, snapshot, nowUtcMs, ports);
        if (!after.ok) return after;
        const actor = teamActor(callerUserId, stored.value);
        const record = TeamSystem.writesOf(
          {
            action: actionOf(cmd.barberEdit),
            before,
            after: after.value,
            actor,
            nowUtcMs,
            operationId: cmd.operationId,
          },
          ports.hash,
        );
        return Result.ok({
          barber: after.value,
          actor,
          writes:
            // The roster follows a return that is written — never a replay,
            // which plans nothing.
            cmd.barberEdit === BarberEdit.Return && record.length > 0
              ? [
                  ...record,
                  ...EmploymentSystem.rosterWritesOnReturn(
                    snapshot.schedule,
                    cmd.barberStartsLocalDate,
                    cmd.operationId,
                  ),
                ]
              : record,
        });
      },
    );
    if (!committed.ok) return committed;
    // A last day that had already passed: the record leaves now, not tonight.
    if (cmd.barberEdit === BarberEdit.Period) {
      await closeIfEnded(ports)(committed.value.barber, committed.value.actor);
    }
    // «Опитай пак»: the revoke a close still owes, tried now. Still owed
    // after it is the one refusal — the record has left either way.
    if (
      cmd.barberEdit === BarberEdit.EndSessions &&
      (await endOwedSessions(ports)(
        committed.value.barber,
        committed.value.actor,
      ))
    ) {
      return Result.err(TeamError.sessionsNotEnded(cmd.barberId));
    }
    return Result.ok({ barberId: cmd.barberId });
  };
