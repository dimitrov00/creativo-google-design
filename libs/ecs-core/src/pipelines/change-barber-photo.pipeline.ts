import type { TeamCall } from '@core/components';
import {
  type BarberId,
  ClientOperationId,
  Result,
  type UserId,
} from '@core/primitives';
import { PipelineError, PipelineErrorCode, TeamErrorCode } from '@core/errors';
import type {
  BarberPhotoCallPorts,
  IdPorts,
  StagedUploadPorts,
} from '@core/ports';
import { BarberPhotoSystem } from '@core/systems';

/**
 * `changeBarberPhoto` — the browser's half of a barber's ONE photo
 * (`docs/architecture/decisions/2026-11-15-one-photo-per-barber.md`): the
 * picture checked, staged under the signed-in account, and handed to
 * `setBarberPhoto` by its NAME.
 *
 * 1. **The picture** is one the shop shows (`BarberPhotoSystem.admitObject`
 *    — the server asks the same again): else `TEAM_PHOTO_INVALID`, and
 *    nothing is uploaded.
 * 2. **Two names**, minted once: the staged file's and the act's. The act's
 *    is the new photo object's on the server, so a retried call names the
 *    same one.
 * 3. **The upload** to the account's own staging folder. A failure is the
 *    call's `PIPELINE_UNAVAILABLE`: worth trying again.
 * 4. **The call.** The server judges who may, copies the picture into the
 *    shop's media and onto the linked account's avatar, and deletes the
 *    staged file.
 *
 * Every failure answers as a `PipelineError`, so the screen words one
 * kind of refusal.
 */

export type ChangeBarberPhotoPorts = StagedUploadPorts &
  BarberPhotoCallPorts &
  IdPorts;

/** What the member's page hands over: whose picture, and the picture as the browser sized it. */
export type ChangeBarberPhotoInput = {
  /** The signed-in account: the staging folder is its own. */
  readonly userId: UserId;
  readonly barberId: BarberId;
  readonly image: Blob;
  /** The picture's pixel size, as the browser measured it. */
  readonly mediaWidth: number;
  readonly mediaHeight: number;
};

export const changeBarberPhoto =
  (ports: ChangeBarberPhotoPorts) =>
  async (
    input: ChangeBarberPhotoInput,
  ): Promise<Result<TeamCall.Saved, PipelineError>> => {
    const picture = BarberPhotoSystem.admitObject({
      contentType: input.image.type.length === 0 ? null : input.image.type,
      sizeBytes: input.image.size,
    });
    if (!picture.ok) {
      return Result.err(
        PipelineError.of(
          PipelineErrorCode.InvalidRequest,
          TeamErrorCode.PhotoInvalid,
          null,
          null,
        ),
      );
    }
    const stagedName = ClientOperationId.parse(ports.nextId());
    const operationId = ClientOperationId.parse(ports.nextId());
    if (!stagedName.ok || !operationId.ok) {
      return Result.err(PipelineError.bare(PipelineErrorCode.InvalidRequest));
    }
    const staged = await ports.stageUpload(
      input.userId,
      stagedName.value,
      input.image,
    );
    if (!staged.ok) {
      return Result.err(PipelineError.bare(PipelineErrorCode.Unavailable));
    }
    return ports.setBarberPhoto({
      barberId: input.barberId,
      stagedName: stagedName.value,
      mediaWidth: input.mediaWidth,
      mediaHeight: input.mediaHeight,
      operationId: operationId.value,
    });
  };
