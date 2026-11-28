import type { LocalizedText } from '@core/components';
import { EngagementError } from '@core/errors';
import {
  type AddProgramImageCommand,
  admitProgramImageCaller,
  type ProgramImageCaller,
  type SweepProgramImagesCommand,
} from '@core/pipelines';
import { Result, StoredFields } from '@core/primitives';
import { ProgramImageSystem } from '@core/systems';
import type { EdgeError } from '../edge';
import { callerKnownRoles, callerUserId } from '../lib/booking/caller-roles';
import type { DocumentWriteEvent } from './triggers.wire';
import { operationIdOf, payloadOf, type WireRequest } from './wire-read';

/**
 * THE PROGRAMS PICTURES' WIRE
 * (`docs/architecture/decisions/2026-11-27-rich-text-for-programs-and-posts.md`,
 * decision 4) — `addProgramImage`, and the event the sweep of a
 * description's folder reads. The caller and their roles come off the
 * VERIFIED token, never the payload, and the token gate is asked before the
 * payload is read. Every field is re-read; the first unreadable one is
 * named (`ENGAGEMENT_PROGRAM_IMAGE_INVALID_INPUT`).
 */

const invalid = (field: string) =>
  Result.err(EngagementError.programImageInvalidInput(field));

/** The verified caller, as the pipeline's gate reads them. */
function callerOf(request: WireRequest): ProgramImageCaller {
  return {
    callerUserId: callerUserId(request),
    callerRoles: callerKnownRoles(request),
  };
}

/**
 * `addProgramImage` `{ programId, stagedName, mediaWidth, mediaHeight,
 * operationId }` → `{ imageId }` — a token whose roles write the programs
 * pages. The staged file is read under the VERIFIED caller's own folder:
 * the payload names a file, never a path.
 */
export function decodeAddProgramImage(
  request: WireRequest,
): Result<AddProgramImageCommand, EdgeError> {
  const caller = callerOf(request);
  const admitted = admitProgramImageCaller(caller);
  if (!admitted.ok) return admitted;
  const payload = payloadOf(request);
  const programId = ProgramImageSystem.programIdOf(
    StoredFields.field(payload, 'programId'),
  );
  if (programId === null) return invalid('programId');
  const operationId = operationIdOf(payload, 'operationId');
  if (operationId === null) return invalid('operationId');
  const stagedName = StoredFields.field(payload, 'stagedName');
  if (typeof stagedName !== 'string') return invalid('stagedName');
  const mediaWidth = StoredFields.field(payload, 'mediaWidth');
  if (typeof mediaWidth !== 'number') return invalid('mediaWidth');
  const mediaHeight = StoredFields.field(payload, 'mediaHeight');
  if (typeof mediaHeight !== 'number') return invalid('mediaHeight');
  return Result.ok({
    ...caller,
    programId,
    operationId,
    stagedName,
    mediaWidth,
    mediaHeight,
  });
}

/** A stored description's text: both languages strings, else `undefined` (unreadable). */
function bodyOf(data: {
  readonly [field: string]: unknown;
}): LocalizedText | undefined {
  const body = StoredFields.field(data, 'body');
  const bg = StoredFields.field(body, 'bg');
  const en = StoredFields.field(body, 'en');
  return typeof bg === 'string' && typeof en === 'string'
    ? { bg, en }
    : undefined;
}

/**
 * A description's write as the sweep reads it: whose folder, and the text
 * as it now stands — `null` when the document was removed. `null` for a
 * write there is nothing to sweep after: an id that names no folder, or a
 * stored text that cannot be read (its pictures are then left alone).
 */
export function decodeSweepProgramImagesEvent(
  event: DocumentWriteEvent<{ readonly docId: string }>,
): SweepProgramImagesCommand | null {
  const programId = ProgramImageSystem.programIdOf(event.params.docId);
  if (programId === null) return null;
  const after = event.data?.after;
  const data = after?.exists === true ? after.data() : undefined;
  if (data === undefined) return { programId, body: null };
  const body = bodyOf(data);
  return body === undefined ? null : { programId, body };
}
