import {
  AuditAction,
  type DocPath,
  StaffLink,
  type TeamCall,
  WriteOp,
} from '@core/components';
import { type BarberId, Result } from '@core/primitives';
import { type RepositoryError, TeamError } from '@core/errors';
import {
  BARBER_LINK_DOC,
  type Barber,
  type BarberLink,
  type BarberSchedule,
  Collections,
  type Service,
  Subcollections,
  type User,
} from '@core/entities';
import type { ClockPorts, CommitPorts, HashPorts } from '@core/ports';
import { OfferingEditSystem, TeamSystem } from '@core/systems';
import {
  admitTeamCaller,
  TEAM_SERVICES,
  type TeamAct,
  teamActor,
} from './team-caller.pipeline';

/**
 * `deleteDraftBarber` — «Изтрий»: a record that never went live, removed
 * with everything that names it (team onboarding D10). The caller gate
 * first, on the VERIFIED token (`admitTeamCaller`). Then ONE commit that
 * reads `users/{caller}`, `barbers/{id}`, its roster, its account lock
 * (`barbers/{id}/restricted/link`) and every service — then the account
 * the lock names — and asks `TeamSystem.admit` and `TeamSystem.removable`
 * (only a `DRAFT`; a record that has been live is `TEAM_NOT_DRAFT` — it
 * leaves through «Напускане», and its history stays).
 *
 * One plan, all or nothing:
 *
 * - the record removed beside its ONE `TEAM_BARBER_DELETED` row, credited
 *   to the caller (`TeamSystem.writesOf`);
 * - its roster removed, when it has one;
 * - its lock removed, and the linked account's `linkedBarberId` cleared
 *   when it still names this record — the account keeps its roles and
 *   reads as "barber, not linked" (the profile trigger audits that write);
 * - its offering dropped from every service that lists it
 *   (`OfferingEditSystem.plan` with no entries).
 *
 * The answer: `{ barberId }`. An id with no record is
 * `TEAM_BARBER_NOT_FOUND` — so is the second of two taps.
 */

/** The call as the wire decoded it, with the verified caller. */
export type DeleteDraftBarberCommand = TeamAct & {
  readonly barberId: BarberId;
};

export type DeleteDraftBarberPorts = CommitPorts & ClockPorts & HashPorts;

type Snapshot = {
  readonly caller: User | null;
  readonly barber: Barber | null;
  readonly schedule: BarberSchedule | null;
  readonly lock: BarberLink | null;
  /** The account the lock names — `null` with no lock, or no such account. */
  readonly linked: User | null;
  readonly services: readonly Service[];
};

/** `barbers/{barberId}/restricted/link` — the record's account lock. */
function lockPath(barberId: BarberId): DocPath {
  return [
    Collections.Barbers,
    barberId,
    Subcollections.Restricted,
    BARBER_LINK_DOC,
  ];
}

/** What goes with the record: its roster, its lock and link, its offerings. */
function dependentWrites(
  barberId: BarberId,
  snapshot: Snapshot,
): Result<readonly WriteOp[], TeamError> {
  const writes: WriteOp[] = [];
  if (snapshot.schedule !== null) {
    writes.push(WriteOp.remove([Collections.BarberSchedules, barberId]));
  }
  if (snapshot.lock !== null) writes.push(WriteOp.remove(lockPath(barberId)));
  const linked = snapshot.linked;
  if (linked !== null && StaffLink.of(linked).linkedBarberId === barberId) {
    writes.push(
      WriteOp.update([Collections.Users, linked.id], { linkedBarberId: null }),
    );
  }
  const dropped = OfferingEditSystem.plan(snapshot.services, barberId, []);
  if (!dropped.ok) return dropped;
  for (const change of dropped.value) {
    writes.push(
      WriteOp.update([Collections.Services, change.serviceId], {
        offerings: change.offerings,
      }),
    );
  }
  return Result.ok(writes);
}

export const deleteDraftBarber =
  (ports: DeleteDraftBarberPorts) =>
  async (
    cmd: DeleteDraftBarberCommand,
  ): Promise<Result<TeamCall.Saved, TeamError | RepositoryError>> => {
    const admitted = admitTeamCaller(cmd);
    if (!admitted.ok) return admitted;
    const callerUserId = admitted.value;
    // Read once, before the transaction: `decide` may run more than once.
    const nowUtcMs = ports.nowUtcMs();
    const committed = await ports.commit(
      async (tx): Promise<Snapshot> => {
        const [caller, barber, schedule, lock, services] = await Promise.all([
          tx.get<User>([Collections.Users, callerUserId]),
          tx.get<Barber>([Collections.Barbers, cmd.barberId]),
          tx.get<BarberSchedule>([Collections.BarberSchedules, cmd.barberId]),
          tx.get<BarberLink>(lockPath(cmd.barberId)),
          tx.query<Service>(TEAM_SERVICES),
        ]);
        const linked =
          lock === null
            ? null
            : await tx.get<User>([Collections.Users, lock.linkedUserId]);
        return { caller, barber, schedule, lock, linked, services };
      },
      (
        snapshot,
      ): Result<{ readonly writes: readonly WriteOp[] }, TeamError> => {
        const stored = TeamSystem.admit(snapshot.caller, nowUtcMs);
        if (!stored.ok) return stored;
        if (snapshot.barber === null) {
          return Result.err(TeamError.barberNotFound(cmd.barberId));
        }
        const draft = TeamSystem.removable(snapshot.barber);
        if (!draft.ok) return draft;
        const dependents = dependentWrites(cmd.barberId, snapshot);
        if (!dependents.ok) return dependents;
        return Result.ok({
          writes: [
            ...TeamSystem.writesOf(
              {
                action: AuditAction.TeamBarberDeleted,
                before: draft.value,
                after: null,
                actor: teamActor(callerUserId, stored.value),
                nowUtcMs,
                operationId: cmd.operationId,
              },
              ports.hash,
            ),
            ...dependents.value,
          ],
        });
      },
    );
    return committed.ok ? Result.ok({ barberId: cmd.barberId }) : committed;
  };
