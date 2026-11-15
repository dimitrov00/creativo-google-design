import {
  type Actor,
  AuditAction,
  type MediaRef,
  type WriteOp,
} from '@core/components';
import {
  type BarberId,
  LogEvent,
  OperationId,
  Result,
  type UserId,
  type UtcEpochMs,
} from '@core/primitives';
import type { RepositoryError, TeamError } from '@core/errors';
import { type Barber, Collections } from '@core/entities';
import type {
  CommitPorts,
  HashPorts,
  IdPorts,
  LogPorts,
  StoredObjectCopyPorts,
  StoredObjectDeletePorts,
} from '@core/ports';
import { BarberPhotoSystem, TeamSystem } from '@core/systems';

/**
 * `reconcileBarberPhoto` — one photo for a barber and the account just
 * linked to their record (decision F6 of
 * `docs/architecture/decisions/2026-11-15-one-photo-per-barber.md`). Run by
 * `setRoles` after a link is written, on the server's own credentials:
 *
 * - **The record has a photo** → the account's avatar is rewritten with it.
 * - **The record has none, and the account has an avatar the shop shows
 *   whose size is known** (`BarberPhotoSystem.adoptionOf`) → the avatar is
 *   copied into the barber's folder under a fresh name, and ONE commit sets
 *   the record's photo beside a `TEAM_BARBER_PHOTO_CHANGED` row credited to
 *   whoever made the link. The taking is an act of its own: the fresh name
 *   is the object's and the row's. A record that took a photo in the meantime, or
 *   has left, is left as it is, and the copy is deleted.
 * - **Neither** → nothing: the record stays without a photo.
 *
 * It answers nothing and refuses nothing: the link is already written, and
 * a photo that could not follow it is logged (`team.photo_mirror_failed`,
 * `team.photo_cleanup_failed`) and repaired by the next photo set.
 */

export type ReconcileBarberPhotoPorts = CommitPorts &
  HashPorts &
  IdPorts &
  StoredObjectCopyPorts &
  StoredObjectDeletePorts &
  LogPorts;

/** The link just written, and who wrote it. */
export type BarberPhotoLink = {
  readonly barberId: BarberId;
  readonly linkedUserId: UserId;
  /** The record's photo, as the link's own commit read it; `null` for none. */
  readonly recordPhotoPath: string | null;
  /** Whoever made the link — credited when the record takes the account's avatar. */
  readonly actor: Actor;
  readonly nowUtcMs: UtcEpochMs;
};

type Refusal = TeamError | RepositoryError;

export const reconcileBarberPhoto =
  (ports: ReconcileBarberPhotoPorts) =>
  async (link: BarberPhotoLink): Promise<void> => {
    const { barberId, linkedUserId } = link;
    const avatarPath = BarberPhotoSystem.accountAvatarPathOf(linkedUserId);
    const failed = (errorCode: string): void =>
      ports.log('error', LogEvent.TeamPhotoMirrorFailed, {
        barberId,
        linkedUserId,
        errorCode,
      });

    // The record has a photo: the account takes it.
    if (link.recordPhotoPath !== null) {
      const mirrored = await ports.copyStoredObject(
        link.recordPhotoPath,
        avatarPath,
      );
      if (!mirrored.ok) failed(mirrored.error.errorCode);
      return;
    }

    // The record has none: it takes the account's avatar, when there is one to take.
    const avatar = await ports.statStoredObject(avatarPath);
    if (!avatar.ok) return failed(avatar.error.errorCode);
    if (avatar.value === null) return;
    // The taking's own name: the copy's, and its row's.
    const act = OperationId.parse(ports.nextId());
    if (!act.ok) return failed(act.error.errorCode);
    const media = BarberPhotoSystem.adoptionOf(
      barberId,
      act.value,
      avatar.value,
    );
    if (media === null) return;
    const copied = await ports.copyStoredObject(avatarPath, media.mediaPath);
    if (!copied.ok) return failed(copied.error.errorCode);
    const taken = await ports.commit(
      (tx) => tx.get<Barber>([Collections.Barbers, barberId]),
      (
        before,
      ): Result<
        { readonly taken: boolean; readonly writes: readonly WriteOp[] },
        Refusal
      > => adopt(before, media, link, act.value, ports.hash),
    );
    if (!taken.ok) failed(taken.error.errorCode);
    // A copy the record does not name is nobody's.
    if (!taken.ok || !taken.value.taken) {
      const deleted = await ports.deleteStoredObject(media.mediaPath);
      if (!deleted.ok) {
        ports.log('warn', LogEvent.TeamPhotoCleanupFailed, {
          path: media.mediaPath,
          operationId: act.value,
          errorCode: deleted.error.errorCode,
        });
      }
    }
  };

/**
 * The record with the account's avatar as its photo — unless it is gone,
 * has left, or took a photo of its own since it was read: then nothing.
 */
function adopt(
  before: Barber | null,
  media: MediaRef,
  link: BarberPhotoLink,
  operationId: OperationId,
  hash: (input: string) => string,
): Result<
  { readonly taken: boolean; readonly writes: readonly WriteOp[] },
  Refusal
> {
  if (before === null || before.avatarMediaPath !== null) {
    return Result.ok({ taken: false, writes: [] });
  }
  const after = TeamSystem.setPhoto(before, media, operationId);
  if (!after.ok) return Result.ok({ taken: false, writes: [] });
  return Result.ok({
    taken: true,
    writes: TeamSystem.writesOf(
      {
        action: AuditAction.TeamBarberPhotoChanged,
        before,
        after: after.value,
        actor: link.actor,
        nowUtcMs: link.nowUtcMs,
        operationId,
      },
      hash,
    ),
  });
}
