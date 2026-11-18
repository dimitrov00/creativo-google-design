import {
  AuditAction,
  StaffTarget,
  type TeamCall,
  type WriteOp,
} from '@core/components';
import {
  type BarberId,
  LogEvent,
  type OperationId,
  Result,
  StaffCapability,
  type UserId,
  type UtcEpochMs,
} from '@core/primitives';
import {
  type AccessError,
  type RepositoryError,
  TeamError,
} from '@core/errors';
import {
  type Barber,
  type BarberLink,
  Collections,
  type User,
} from '@core/entities';
import type {
  ClockPorts,
  CommitPorts,
  HashPorts,
  LogPorts,
  ReadTx,
  StoredObjectCopyPorts,
  StoredObjectDeletePorts,
} from '@core/ports';
import {
  BarberPhotoSystem,
  type BarberPhotoPlan,
  RoleAssignmentSystem,
  StaffAccessSystem,
  TeamSystem,
} from '@core/systems';
import {
  admitTeamCaller,
  readStaffCaller,
  type StaffCallerFacts,
  type TeamAct,
  teamActor,
} from './team-caller.pipeline';

/**
 * `setBarberPhoto` — a barber's ONE photo, replaced
 * (`docs/architecture/decisions/2026-11-15-one-photo-per-barber.md`). The
 * picture is one the caller staged under their own account
 * (`pending/{caller}/{name}`); the bytes never ride the call. The
 * caller gate first, on the VERIFIED token (`admitTeamCaller`: any staff
 * role). Then, in this order:
 *
 * 1. **Who may, before any object is touched.** One commit that writes
 *    nothing reads `users/{caller}`, `settings/staffPermissions` and
 *    `barbers/{id}` and asks `StaffAccessSystem.admit` for `TEAM_PROFILES`
 *    on the barber named — by default the content editor, the admin, or
 *    the barber whose account is linked to this very record. A record that
 *    is not there is `TEAM_BARBER_NOT_FOUND`; one that has left takes no
 *    photo. A record that already holds THIS act's photo answers at once:
 *    the replay of a call that landed.
 * 2. **The staged object.** It is there (else `TEAM_PHOTO_MISSING`) and is
 *    a picture the shop shows (`BarberPhotoSystem.admitObject`, else
 *    `TEAM_PHOTO_INVALID`).
 * 3. **The copy** into the barber's folder under `media/`, named after the
 *    act — before the record names it, so no reader follows a path to
 *    nothing.
 * 4. **The write**, ONE commit: the stored account judged again, the
 *    record with its photo (`TeamSystem.setPhoto`) set whole beside its
 *    ONE `TEAM_BARBER_PHOTO_CHANGED` row, credited to the caller. A refusal
 *    here deletes the copy step 3 made.
 * 5. **What follows a photo that landed**, each on its own and none able
 *    to undo it: the linked account's avatar rewritten with the same
 *    picture (so the two never differ — a failure logs
 *    `team.photo_mirror_failed` and the next photo repairs it), the staged
 *    upload deleted, and the photo it replaced deleted when it was one of
 *    the barber's own (a failure logs `team.photo_cleanup_failed`).
 *
 * The answer: `{ barberId }`.
 */

/** The call as the wire decoded it, with the verified caller. */
export type SetBarberPhotoCommand = TeamAct & {
  readonly barberId: BarberId;
  readonly stagedName: string;
  readonly mediaWidth: number;
  readonly mediaHeight: number;
};

export type SetBarberPhotoPorts = CommitPorts &
  ClockPorts &
  HashPorts &
  StoredObjectCopyPorts &
  StoredObjectDeletePorts &
  LogPorts;

type Snapshot = StaffCallerFacts & {
  readonly barber: Barber | null;
  /** The record's account lock; `null` when nobody is linked. */
  readonly link: BarberLink | null;
};

/** What the write leaves for the steps after it. */
type Landed = {
  /** The account linked to the record; `null` when there is none. */
  readonly linkedUserId: UserId | null;
  /** The photo the record held before, when it is one to delete. */
  readonly replacedPath: string | null;
};

type Refusal = TeamError | AccessError | RepositoryError;

/** The stored account against `TEAM_PROFILES` on the record, then the record with the photo. */
function decide(
  snapshot: Snapshot,
  cmd: SetBarberPhotoCommand,
  plan: BarberPhotoPlan,
  nowUtcMs: UtcEpochMs,
): Result<
  {
    /** The caller's stored account, as admitted. */
    readonly stored: User;
    readonly before: Barber;
    readonly after: Barber;
  },
  Refusal
> {
  const stored = StaffAccessSystem.admit({
    staffCapability: StaffCapability.TeamProfiles,
    staffTarget: StaffTarget.barbers([cmd.barberId]),
    caller: snapshot.caller,
    permissions: snapshot.permissions,
    nowUtcMs,
  });
  if (!stored.ok) return stored;
  const before = snapshot.barber;
  if (before === null) {
    return Result.err(TeamError.barberNotFound(cmd.barberId));
  }
  const after = TeamSystem.setPhoto(before, plan.media, cmd.operationId);
  return after.ok
    ? Result.ok({ stored: stored.value, before, after: after.value })
    : after;
}

export const setBarberPhoto =
  (ports: SetBarberPhotoPorts) =>
  async (
    cmd: SetBarberPhotoCommand,
  ): Promise<Result<TeamCall.Saved, Refusal>> => {
    const admitted = admitTeamCaller(cmd);
    if (!admitted.ok) return admitted;
    const callerUserId = admitted.value;
    const planned = BarberPhotoSystem.planOf({
      callerUserId,
      barberId: cmd.barberId,
      operationId: cmd.operationId,
      stagedName: cmd.stagedName,
      mediaWidth: cmd.mediaWidth,
      mediaHeight: cmd.mediaHeight,
    });
    if (!planned.ok) return planned;
    const plan = planned.value;
    const saved = Result.ok({ barberId: cmd.barberId });
    // Read once, before the transactions: `decide` may run more than once.
    const nowUtcMs = ports.nowUtcMs();
    const read = async (tx: ReadTx): Promise<Snapshot> => {
      const [facts, barber, link] = await Promise.all([
        readStaffCaller(tx, callerUserId),
        tx.get<Barber>([Collections.Barbers, cmd.barberId]),
        tx.get<BarberLink>(RoleAssignmentSystem.lockPathOf(cmd.barberId)),
      ]);
      return { ...facts, barber, link };
    };

    // 1. Who may — and whether this act already landed. Nothing is written.
    const asked = await ports.commit(
      read,
      (
        snapshot,
      ): Result<
        { readonly held: boolean; readonly writes: readonly WriteOp[] },
        Refusal
      > => {
        const decided = decide(snapshot, cmd, plan, nowUtcMs);
        return decided.ok
          ? Result.ok({
              held: BarberPhotoSystem.isHeld(decided.value.before, plan.media),
              writes: [],
            })
          : decided;
      },
    );
    if (!asked.ok) return asked;
    if (asked.value.held) return saved;

    // 2. The staged object.
    const staged = await ports.statStoredObject(plan.stagedPath);
    if (!staged.ok) return staged;
    if (staged.value === null) return Result.err(TeamError.photoMissing());
    const picture = BarberPhotoSystem.admitObject(staged.value);
    if (!picture.ok) return picture;

    // 3. The copy, before the record names it.
    const copied = await ports.copyStoredObject(
      plan.stagedPath,
      plan.media.mediaPath,
    );
    if (!copied.ok) return copied;

    // 4. The write.
    const committed = await ports.commit(
      read,
      (
        snapshot,
      ): Result<Landed & { readonly writes: readonly WriteOp[] }, Refusal> => {
        const decided = decide(snapshot, cmd, plan, nowUtcMs);
        if (!decided.ok) return decided;
        const { stored, before, after } = decided.value;
        return Result.ok({
          linkedUserId:
            snapshot.link === null ? null : snapshot.link.linkedUserId,
          replacedPath: BarberPhotoSystem.replacedPathOf(before, after),
          writes: TeamSystem.writesOf(
            {
              action: AuditAction.TeamBarberPhotoChanged,
              before,
              after,
              actor: teamActor(callerUserId, stored),
              nowUtcMs,
              operationId: cmd.operationId,
            },
            ports.hash,
          ),
        });
      },
    );
    if (!committed.ok) {
      // The record names no such object: the copy is nobody's.
      await discard(ports, plan.media.mediaPath, cmd.operationId);
      return committed;
    }

    // 5. What follows a photo that landed.
    const { linkedUserId, replacedPath } = committed.value;
    if (linkedUserId !== null) {
      const mirrored = await ports.copyStoredObject(
        plan.media.mediaPath,
        BarberPhotoSystem.accountAvatarPathOf(linkedUserId),
      );
      if (!mirrored.ok) {
        ports.log('error', LogEvent.TeamPhotoMirrorFailed, {
          barberId: cmd.barberId,
          linkedUserId,
          errorCode: mirrored.error.errorCode,
        });
      }
    }
    await discard(ports, plan.stagedPath, cmd.operationId);
    if (replacedPath !== null) {
      await discard(ports, replacedPath, cmd.operationId);
    }
    return saved;
  };

/** One object nothing names any more, deleted — a failure is logged, never the call's answer. */
async function discard(
  ports: StoredObjectDeletePorts & LogPorts,
  path: string,
  operationId: OperationId,
): Promise<void> {
  const deleted = await ports.deleteStoredObject(path);
  if (!deleted.ok) {
    ports.log('warn', LogEvent.TeamPhotoCleanupFailed, {
      path,
      operationId,
      errorCode: deleted.error.errorCode,
    });
  }
}
