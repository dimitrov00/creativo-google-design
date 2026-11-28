import { type ProgramId, type ProgramImageCall, Roles } from '@core/components';
import {
  LogEvent,
  type OperationId,
  Result,
  type UserId,
} from '@core/primitives';
import { EngagementError, type RepositoryError } from '@core/errors';
import type {
  LogPorts,
  StoredObjectCopyPorts,
  StoredObjectDeletePorts,
  StoredObjectListPorts,
} from '@core/ports';
import { ProgramImageSystem } from '@core/systems';

/**
 * `addProgramImage` — a picture for a role's, a course's or an event's
 * description
 * (`docs/architecture/decisions/2026-11-27-rich-text-for-programs-and-posts.md`,
 * decision 4). The picture is one the caller staged under their own account
 * (`pending/{caller}/{name}`); the bytes never ride the call. No document
 * is read or written: a description names its pictures in its own text, and
 * the description is saved by the editor.
 *
 * 1. **Who may**, on the VERIFIED token: a signed-in session
 *    (`ENGAGEMENT_PROGRAM_IMAGE_UNAUTHENTICATED`) holding a role that writes
 *    the programs pages (`Roles.CATALOG` — the rules' `isCatalogManager()`;
 *    else `ENGAGEMENT_PROGRAM_IMAGE_FORBIDDEN`).
 * 2. **The plan** (`ProgramImageSystem.planOf`): the staged path, the
 *    picture's id — made from the act's name and the size measured — and
 *    its object under the description's folder.
 * 3. **A replay.** The object is already there: the act landed before, and
 *    answers its id again.
 * 4. **Room.** The folder holds fewer objects than it may
 *    (`ENGAGEMENT_PROGRAM_IMAGES_FULL`).
 * 5. **The staged object** is there (`…_IMAGE_MISSING`) and is a picture a
 *    description shows (`…_IMAGE_INVALID`).
 * 6. **The copy** into the folder, then the staged upload deleted — a
 *    failure to delete is logged (`program.image_cleanup_failed`), never
 *    the call's answer: the bucket's lifecycle rule removes it a day later.
 *
 * A picture no saved description names is removed by `sweepProgramImages`.
 */

/** The verified caller, as the wire read them off the token. */
export type ProgramImageCaller = {
  /** `null` for a call with no session. */
  readonly callerUserId: UserId | null;
  readonly callerRoles: Roles;
};

/** The call as the wire decoded it, with the verified caller. */
export type AddProgramImageCommand = ProgramImageCaller & {
  readonly programId: ProgramId;
  readonly stagedName: string;
  readonly mediaWidth: number;
  readonly mediaHeight: number;
  readonly operationId: OperationId;
};

export type AddProgramImagePorts = StoredObjectCopyPorts &
  StoredObjectDeletePorts &
  StoredObjectListPorts &
  LogPorts;

/**
 * The caller of `addProgramImage` — a uid whose claims hold a role that
 * writes the programs pages, or the refusal. The wire asks it before it
 * reads the payload; the pipeline asks it again.
 */
export function admitProgramImageCaller(
  caller: ProgramImageCaller,
): Result<
  UserId,
  | EngagementError.ProgramImageUnauthenticated
  | EngagementError.ProgramImageForbidden
> {
  if (caller.callerUserId === null) {
    return Result.err(EngagementError.programImageUnauthenticated());
  }
  return Roles.managesCatalog(caller.callerRoles)
    ? Result.ok(caller.callerUserId)
    : Result.err(EngagementError.programImageForbidden());
}

export const addProgramImage =
  (ports: AddProgramImagePorts) =>
  async (
    cmd: AddProgramImageCommand,
  ): Promise<
    Result<
      ProgramImageCall.Added,
      EngagementError.ProgramImageError | RepositoryError
    >
  > => {
    const admitted = admitProgramImageCaller(cmd);
    if (!admitted.ok) return admitted;
    const planned = ProgramImageSystem.planOf({
      callerUserId: admitted.value,
      programId: cmd.programId,
      operationId: cmd.operationId,
      stagedName: cmd.stagedName,
      mediaWidth: cmd.mediaWidth,
      mediaHeight: cmd.mediaHeight,
    });
    if (!planned.ok) return planned;
    const plan = planned.value;
    const added = Result.ok({ imageId: plan.imageId });

    // 3. A replay: the object is already there.
    const landed = await ports.statStoredObject(plan.mediaPath);
    if (!landed.ok) return landed;
    if (landed.value !== null) return added;

    // 4. Room in the folder.
    const listed = await ports.listStoredObjects(plan.folder);
    if (!listed.ok) return listed;
    if (!ProgramImageSystem.hasRoom(listed.value.length)) {
      return Result.err(EngagementError.programImagesFull());
    }

    // 5. The staged object.
    const staged = await ports.statStoredObject(plan.stagedPath);
    if (!staged.ok) return staged;
    if (staged.value === null) {
      return Result.err(EngagementError.programImageMissing());
    }
    const picture = ProgramImageSystem.admitObject(staged.value);
    if (!picture.ok) return picture;

    // 6. The copy, then the staged upload is nobody's.
    const copied = await ports.copyStoredObject(
      plan.stagedPath,
      plan.mediaPath,
    );
    if (!copied.ok) return copied;
    const deleted = await ports.deleteStoredObject(plan.stagedPath);
    if (!deleted.ok) {
      ports.log('warn', LogEvent.ProgramImageCleanupFailed, {
        path: plan.stagedPath,
        operationId: cmd.operationId,
        errorCode: deleted.error.errorCode,
      });
    }
    return added;
  };
