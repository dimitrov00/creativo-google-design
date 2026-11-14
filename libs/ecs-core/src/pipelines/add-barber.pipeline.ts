import {
  AuditAction,
  StaffTarget,
  type TeamCall,
  type WriteOp,
} from '@core/components';
import { BarberId, Result, StaffCapability } from '@core/primitives';
import {
  type AccessError,
  type RepositoryError,
  TeamError,
} from '@core/errors';
import { type Barber, Collections, type ShopLocation } from '@core/entities';
import type { ClockPorts, CommitPorts, HashPorts } from '@core/ports';
import {
  type AddBarberInput,
  StaffAccessSystem,
  TeamSystem,
} from '@core/systems';
import {
  admitTeamCaller,
  readStaffCaller,
  type StaffCallerFacts,
  TEAM_BARBERS,
  TEAM_LOCATIONS,
  type TeamAct,
  teamActor,
} from './team-caller.pipeline';

/**
 * `addBarber` — «Добави»: a new barber record, as a `DRAFT` (team
 * onboarding D5, `docs/designs/team-onboarding.md`). The caller gate first,
 * on the VERIFIED token (`admitTeamCaller`: any staff role). Then ONE
 * commit (Law 4: the transaction is the sandwich) that reads
 * `users/{caller}` and `settings/staffPermissions`, the record the act
 * names, every shop and every barber record, and asks
 * `StaffAccessSystem.admit` — `TEAM_MANAGE` on the shop, judged on the
 * STORED roles and block against the owner's cells (staff permissions P6;
 * by default the admin alone) — and `TeamSystem.add`.
 *
 * **The act's id IS the record's id** (`barbers/{operationId}`), as a
 * booking attempt's is the appointment's: a double tap or a retried call
 * finds the record its first run wrote and writes nothing — one sheet, one
 * record. A new record is SET whole beside its ONE `TEAM_BARBER_ADDED` row
 * (`TeamSystem.writesOf`), credited to the caller over their stored roles;
 * the row lands with the record or not at all, and the governed trigger
 * plans none for a write that stamped its operation.
 *
 * The answer: `{ barberId }`. A refusal commits nothing; a store failure
 * answers as the commit answers it.
 */

/** The call as the wire decoded it, with the verified caller. */
export type AddBarberCommand = AddBarberInput & TeamAct;

export type AddBarberPorts = CommitPorts & ClockPorts & HashPorts;

type Snapshot = StaffCallerFacts & {
  readonly existing: Barber | null;
  readonly shops: readonly ShopLocation[];
  readonly barbers: readonly Barber[];
};

export const addBarber =
  (ports: AddBarberPorts) =>
  async (
    cmd: AddBarberCommand,
  ): Promise<
    Result<TeamCall.Saved, TeamError | AccessError | RepositoryError>
  > => {
    const admitted = admitTeamCaller(cmd);
    if (!admitted.ok) return admitted;
    const callerUserId = admitted.value;
    const parsed = BarberId.parse(cmd.operationId);
    if (!parsed.ok) return Result.err(TeamError.invalidInput('operationId'));
    const barberId = parsed.value;
    // Read once, before the transaction: `decide` may run more than once.
    const nowUtcMs = ports.nowUtcMs();
    const committed = await ports.commit(
      async (tx): Promise<Snapshot> => {
        const [facts, existing, shops, barbers] = await Promise.all([
          readStaffCaller(tx, callerUserId),
          tx.get<Barber>([Collections.Barbers, barberId]),
          tx.query<ShopLocation>(TEAM_LOCATIONS),
          tx.query<Barber>(TEAM_BARBERS),
        ]);
        return { ...facts, existing, shops, barbers };
      },
      ({
        caller,
        permissions,
        existing,
        shops,
        barbers,
      }): Result<
        { readonly writes: readonly WriteOp[] },
        TeamError | AccessError
      > => {
        const stored = StaffAccessSystem.admit({
          staffCapability: StaffCapability.TeamManage,
          staffTarget: StaffTarget.SHOP,
          caller,
          permissions,
          nowUtcMs,
        });
        if (!stored.ok) return stored;
        // The replay: this act already wrote its record.
        if (existing !== null) return Result.ok({ writes: [] });
        const added = TeamSystem.add(cmd, {
          barberId,
          listedShops: shops,
          barberCount: barbers.length,
          nowUtcMs,
          operationId: cmd.operationId,
        });
        if (!added.ok) return added;
        return Result.ok({
          writes: TeamSystem.writesOf(
            {
              action: AuditAction.TeamBarberAdded,
              before: null,
              after: added.value,
              actor: teamActor(callerUserId, stored.value),
              nowUtcMs,
              operationId: cmd.operationId,
            },
            ports.hash,
          ),
        });
      },
    );
    return committed.ok ? Result.ok({ barberId }) : committed;
  };
