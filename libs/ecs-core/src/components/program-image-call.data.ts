import {
  type ClientOperationId,
  type CourseId,
  type EventId,
  type PositionId,
  ProgramImageId,
  Result,
} from '@core/primitives';
import type { PipelineError } from '@core/errors';
import { CallAnswer } from './call-answer.data';

/**
 * The thing a description belongs to, by its id — a role, a course or an
 * event. A description's document and its pictures' folder are both named
 * after it.
 */
export type ProgramId = PositionId | CourseId | EventId;

/**
 * `addProgramImage` on the wire
 * (`docs/architecture/decisions/2026-11-27-rich-text-for-programs-and-posts.md`,
 * decision 4): a picture for a description, taken from an upload the caller
 * staged under their own account. The bytes never ride the call.
 */
export const ProgramImageCall = {
  /** The answer: the picture's id, or nothing usable. */
  decodeAdded(raw: unknown): Result<ProgramImageCall.Added, PipelineError> {
    const answer = CallAnswer.read(raw);
    const imageId =
      answer === null
        ? null
        : CallAnswer.parsed(answer, 'imageId', ProgramImageId.parse);
    return imageId === null ? CallAnswer.unusable() : Result.ok({ imageId });
  },
} as const;

export namespace ProgramImageCall {
  export type Add = {
    /** The role, course or event whose description takes the picture. */
    readonly programId: ProgramId;
    /** The staged file's name under `pending/{caller}/`. */
    readonly stagedName: string;
    /** The picture's pixel size, as the browser measured it. */
    readonly mediaWidth: number;
    readonly mediaHeight: number;
    /** The act's name — the picture's id is made from it, so a replay names the same one. */
    readonly operationId: ClientOperationId;
  };
  /** The picture as a description names it. */
  export type Added = { readonly imageId: ProgramImageId };
}
