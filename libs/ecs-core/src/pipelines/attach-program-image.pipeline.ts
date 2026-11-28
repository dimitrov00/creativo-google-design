import {
  type ProgramId,
  type ProgramImageCall,
  StoredObjectFacts,
} from '@core/components';
import { ClientOperationId, Result, type UserId } from '@core/primitives';
import {
  EngagementErrorCode,
  PipelineError,
  PipelineErrorCode,
} from '@core/errors';
import type {
  IdPorts,
  ProgramImageCallPorts,
  StagedUploadPorts,
} from '@core/ports';
import { ProgramImageSystem } from '@core/systems';

/**
 * `attachProgramImage` — the browser's half of a description's picture
 * (`docs/architecture/decisions/2026-11-27-rich-text-for-programs-and-posts.md`,
 * decision 4): the picture checked, staged under the signed-in account, and
 * handed to `addProgramImage` by its NAME.
 *
 * 1. **The picture** is one a description shows
 *    (`ProgramImageSystem.admitObject` — the server asks the same again) and
 *    one the browser could measure, since its id carries its size: else
 *    `ENGAGEMENT_PROGRAM_IMAGE_INVALID`, and nothing is uploaded.
 * 2. **Two names**, minted once: the staged file's and the act's.
 * 3. **The upload** to the account's own staging folder. A failure is the
 *    call's `PIPELINE_UNAVAILABLE`: worth trying again.
 * 4. **The call**, which answers the id the description names the picture by.
 *
 * Every failure answers as a `PipelineError`, so the editor words one kind
 * of refusal.
 */
export type AttachProgramImagePorts = StagedUploadPorts &
  ProgramImageCallPorts &
  IdPorts;

export type AttachProgramImageInput = {
  /** The signed-in account: the staging folder is its own. */
  readonly userId: UserId;
  readonly programId: ProgramId;
  readonly image: Blob;
  /** The picture's pixel size, as the browser measured it; `null` where it could not. */
  readonly mediaWidth: number | null;
  readonly mediaHeight: number | null;
};

export const attachProgramImage =
  (ports: AttachProgramImagePorts) =>
  async (
    input: AttachProgramImageInput,
  ): Promise<Result<ProgramImageCall.Added, PipelineError>> => {
    const { mediaWidth, mediaHeight } = input;
    const picture = ProgramImageSystem.admitObject(
      StoredObjectFacts.unmeasured(
        input.image.size,
        input.image.type.length === 0 ? null : input.image.type,
      ),
    );
    if (!picture.ok || mediaWidth === null || mediaHeight === null) {
      return Result.err(
        PipelineError.of(
          PipelineErrorCode.InvalidRequest,
          EngagementErrorCode.ProgramImageInvalid,
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
    return ports.addProgramImage({
      programId: input.programId,
      stagedName: stagedName.value,
      mediaWidth,
      mediaHeight,
      operationId: operationId.value,
    });
  };
