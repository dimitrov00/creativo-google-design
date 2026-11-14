import {
  OfferingsEdit,
  type OfferingsRequest,
  StaffTarget,
  type TeamCall,
  type WriteOp,
} from '@core/components';
import { type BarberId, Result, StaffCapability } from '@core/primitives';
import {
  type AccessError,
  type RepositoryError,
  TeamError,
} from '@core/errors';
import { type Barber, Collections, type Service } from '@core/entities';
import type { ClockPorts, CommitPorts, HashPorts } from '@core/ports';
import {
  type OfferingChange,
  OfferingEditSystem,
  StaffAccessSystem,
  TeamSystem,
} from '@core/systems';
import {
  admitTeamCaller,
  readStaffCaller,
  type StaffCallerFacts,
  TEAM_SERVICES,
  type TeamAct,
  teamActor,
} from './team-caller.pipeline';

/**
 * `setBarberOfferings` — a barber's services and prices, saved as ONE act
 * (team onboarding D5, D6): the editor's complete list (`SET` — a service
 * left out is no longer theirs), or «Копирай цените от» (`COPY` — a
 * colleague's terms on every service that colleague performs, a one-time
 * snapshot; what the barber performs beside those is left alone). The
 * caller gate first, on the VERIFIED token (`admitTeamCaller`: any staff
 * role).
 *
 * Then ONE commit that reads `users/{caller}`, `settings/staffPermissions`,
 * `barbers/{id}`, every service — the matrix lives on them
 * (`Service.offerings`) — and, for a copy, the colleague's record, and
 * asks `StaffAccessSystem.admit` — `TEAM_OFFERINGS` on the barber named,
 * judged on the STORED roles, block and link against the owner's cells
 * (staff permissions P6, O8). Prices are the owner's by default: no level
 * has the capability until the owner gives it, and a barber may be given
 * it for their own list only. Then `TeamSystem.editable` (a record that
 * has left takes no edit) and `OfferingEditSystem.plan` / `.copied`. Only the services whose
 * list really changes are written — `offerings` at the root, stamped with
 * the act — beside ONE `TEAM_BARBER_OFFERINGS_CHANGED` row on the barber,
 * credited to the caller over their stored roles
 * (`OfferingEditSystem.writesOf`); the row lands with the writes or not at
 * all, and the governed trigger plans none for a write that stamped its
 * operation. A save that changes nothing — and so the replay of one that
 * landed — writes no document and no row.
 *
 * The answer: `{ barberId }`. An id with no record is
 * `TEAM_BARBER_NOT_FOUND` (the barber's, or the colleague's), asked only
 * after the caller is admitted.
 */

/** The call as the wire decoded it, with the verified caller. */
export type SetBarberOfferingsCommand = OfferingsRequest &
  TeamAct & {
    readonly barberId: BarberId;
  };

export type SetBarberOfferingsPorts = CommitPorts & ClockPorts & HashPorts;

type Snapshot = StaffCallerFacts & {
  readonly barber: Barber | null;
  /** The colleague copied from — read for a copy only, else `null`. */
  readonly source: Barber | null;
  readonly services: readonly Service[];
};

/** The per-service changes the request comes to, or its refusal. */
function changesOf(
  cmd: SetBarberOfferingsCommand,
  snapshot: Snapshot,
): Result<readonly OfferingChange[], TeamError> {
  if (cmd.offeringsEdit === OfferingsEdit.Set) {
    return OfferingEditSystem.plan(
      snapshot.services,
      cmd.barberId,
      cmd.offerings,
    );
  }
  return snapshot.source === null
    ? Result.err(TeamError.barberNotFound(cmd.copyFromBarberId))
    : Result.ok(
        OfferingEditSystem.copied(
          snapshot.services,
          cmd.copyFromBarberId,
          cmd.barberId,
        ),
      );
}

export const setBarberOfferings =
  (ports: SetBarberOfferingsPorts) =>
  async (
    cmd: SetBarberOfferingsCommand,
  ): Promise<
    Result<TeamCall.Saved, TeamError | AccessError | RepositoryError>
  > => {
    const admitted = admitTeamCaller(cmd);
    if (!admitted.ok) return admitted;
    const callerUserId = admitted.value;
    const copyFrom =
      cmd.offeringsEdit === OfferingsEdit.Copy ? cmd.copyFromBarberId : null;
    // Read once, before the transaction: `decide` may run more than once.
    const nowUtcMs = ports.nowUtcMs();
    const committed = await ports.commit(
      async (tx): Promise<Snapshot> => {
        const [facts, barber, source, services] = await Promise.all([
          readStaffCaller(tx, callerUserId),
          tx.get<Barber>([Collections.Barbers, cmd.barberId]),
          copyFrom === null
            ? null
            : tx.get<Barber>([Collections.Barbers, copyFrom]),
          tx.query<Service>(TEAM_SERVICES),
        ]);
        return { ...facts, barber, source, services };
      },
      (
        snapshot,
      ): Result<
        { readonly writes: readonly WriteOp[] },
        TeamError | AccessError
      > => {
        const stored = StaffAccessSystem.admit({
          staffCapability: StaffCapability.TeamOfferings,
          staffTarget: StaffTarget.barbers([cmd.barberId]),
          caller: snapshot.caller,
          permissions: snapshot.permissions,
          nowUtcMs,
        });
        if (!stored.ok) return stored;
        if (snapshot.barber === null) {
          return Result.err(TeamError.barberNotFound(cmd.barberId));
        }
        const editable = TeamSystem.editable(snapshot.barber);
        if (!editable.ok) return editable;
        const changes = changesOf(cmd, snapshot);
        if (!changes.ok) return changes;
        return Result.ok({
          writes: OfferingEditSystem.writesOf(
            {
              barberId: cmd.barberId,
              changes: changes.value,
              copiedFromBarberId: copyFrom,
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
