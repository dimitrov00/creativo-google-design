import { CustomerId, Result } from '@core/primitives';
import {
  type PipelineError,
  PrivacyError,
  type RepositoryError,
} from '@core/errors';
import { type ClientPrivacyCall, ErasureCensus, Roles } from '@core/components';
import type {
  EraseClientCommand,
  ExportClientDataCommand,
} from '@core/pipelines';
import type { EdgeError } from '../edge';
import { callerKnownRoles, callerUserId } from '../lib/booking/caller-roles';
import {
  field,
  idOf,
  operationIdOf,
  payloadOf,
  refusalOf,
  type WireRequest,
} from './wire-read';

/**
 * THE PRIVACY CALLABLES' WIRE (audit-hardening Phase 3, WS-C / WS-D) — the
 * admin's data-subject requests: `exportClientData`, and the erasure's
 * read-only `previewClientErasure` and resumable `eraseClient`. The request
 * of all three is the call component `ClientPrivacyCall`
 * `{ customerId, operationId }`, decoded by ONE reading (the same gate and
 * field rules); the answers are `ClientPrivacyCall.Exported`,
 * `.ErasurePreview` and `.Erasure`; a refusal leaves as its `PRIVACY_*`
 * struct (a store failure thrown).
 *
 * The caller is read off the VERIFIED token FIRST — no session →
 * `PRIVACY_UNAUTHENTICATED`, a token whose roles are not the shop's admin
 * (`Roles.handlesClientPrivacy`, `Roles.PRIVACY`: the sysadmin is not
 * enough, P3-RU-13) → `PRIVACY_FORBIDDEN` — before the payload is read: a
 * stranger learns nothing about the person they asked for. The pipeline
 * then re-reads the caller's STORED roles (an export of a person's data
 * trusts no stale claim).
 *
 * Both payload fields are REQUIRED: the record's id through its smart
 * constructor, the act's own id through the client-minted key's guard (a
 * retry of the same act sends the same id, so a replay answers what the
 * first call did) — a missing or malformed one is
 * `PRIVACY_INVALID_INPUT` naming the field, never its value.
 */

/**
 * The erasure's budget: the platform timeout `eraseClient` deploys with
 * (the `RUN_BACKFILL_TIMEOUT_SECONDS` idiom) — the edge budgets the call's
 * work by it (`WorkBudgetSystem.callableBudgetMs(540)`, 49 s under the
 * client's 70 s wait), so the two can never disagree; a call that runs out
 * answers `erasureDone: false` and the browser loop calls again.
 */
export const ERASE_CLIENT_TIMEOUT_SECONDS = 540;

/**
 * The ONE reading of a privacy call: the verified caller's gate before the
 * payload, then the record's id and the act's own id, both required.
 */
function decodePrivacyCall(
  request: WireRequest,
): Result<ExportClientDataCommand, EdgeError> {
  // The caller's gate, answered before the payload is read.
  const callerUid = callerUserId(request);
  if (callerUid === null) return Result.err(PrivacyError.unauthenticated());
  if (!Roles.handlesClientPrivacy(callerKnownRoles(request))) {
    return Result.err(PrivacyError.forbidden());
  }
  const payload = payloadOf(request);
  const customerId = idOf(field(payload, 'customerId'), CustomerId.parse);
  if (customerId === null) {
    return Result.err(PrivacyError.invalidInput('customerId'));
  }
  const operationId = operationIdOf(payload, 'operationId');
  if (operationId === null) {
    return Result.err(PrivacyError.invalidInput('operationId'));
  }
  return Result.ok({
    callerUserId: callerUid,
    callerRoles: callerKnownRoles(request),
    customerId,
    operationId,
  });
}

/** `exportClientData`'s request — the privacy call, read once. */
export function decodeExportClientData(
  request: WireRequest,
): Result<ExportClientDataCommand, EdgeError> {
  return decodePrivacyCall(request);
}

/** `previewClientErasure`'s request — the same call, the same gate and fields. */
export function decodePreviewClientErasure(
  request: WireRequest,
): Result<EraseClientCommand, EdgeError> {
  return decodePrivacyCall(request);
}

/**
 * `eraseClient`'s request — the same call: a retry of the same act sends
 * the same `operationId`, so a resumed erasure plans no second row.
 */
export function decodeEraseClient(
  request: WireRequest,
): Result<EraseClientCommand, EdgeError> {
  return decodePrivacyCall(request);
}

/** The bundle and its counts, as the pipeline answered them — `exportJson` byte for byte. */
export function encodeExportClientDataAnswer(
  answer: ClientPrivacyCall.Exported,
): ClientPrivacyCall.Exported {
  return {
    clientExportVersion: answer.clientExportVersion,
    exportedCustomerId: answer.exportedCustomerId,
    exportedAtUtcMs: answer.exportedAtUtcMs,
    exportDocumentCount: answer.exportDocumentCount,
    exportByteCount: answer.exportByteCount,
    exportJson: answer.exportJson,
  };
}

/** A refusal as itself — the pipeline's `PRIVACY_*` struct (a store failure thrown). */
export function exportClientDataRefusal(
  error: PrivacyError | RepositoryError,
): EdgeError {
  return refusalOf(error);
}

/**
 * The preview as the pipeline answered it: the record's tag, the sibling
 * walk-in records' ids and the eleven census counts — nothing else
 * (`ErasureCensus.countsOf`).
 */
export function encodeErasurePreviewAnswer(
  answer: ClientPrivacyCall.ErasurePreview,
): ClientPrivacyCall.ErasurePreview {
  return {
    erasureStatus: answer.erasureStatus,
    erasureSiblingCustomerIds: answer.erasureSiblingCustomerIds,
    ...ErasureCensus.countsOf(answer),
  };
}

/** One erasure call's outcome: the record's tag, whether it is done and the residue census — nothing else. */
export function encodeEraseClientAnswer(
  answer: ClientPrivacyCall.Erasure,
): ClientPrivacyCall.Erasure {
  return {
    erasureStatus: answer.erasureStatus,
    erasureDone: answer.erasureDone,
    ...ErasureCensus.countsOf(answer),
  };
}

/**
 * An erasure refusal as itself — the pipeline's `PRIVACY_*` struct, or the
 * Auth eraser's `PIPELINE_*` failure (its SDK code stays on the server: the
 * row names no field); a store failure thrown. The preview and the erasure
 * refuse alike.
 */
export function eraseClientRefusal(
  error: PrivacyError | RepositoryError | PipelineError,
): EdgeError {
  return refusalOf(error);
}
