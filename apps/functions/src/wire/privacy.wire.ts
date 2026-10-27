import { CustomerId, Result } from '@core/primitives';
import { PrivacyError, type RepositoryError } from '@core/errors';
import { type ClientPrivacyCall, Roles } from '@core/components';
import type { ExportClientDataCommand } from '@core/pipelines';
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
 * THE PRIVACY CALLABLES' WIRE (audit-hardening Phase 3, WS-C) — the
 * admin's data-subject requests: `exportClientData` (the erasure adds its
 * own decoders here). The request is the call component
 * `ClientPrivacyCall` `{ customerId, operationId }`, the answer
 * `ClientPrivacyCall.Exported`, a refusal its `PRIVACY_*` struct.
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

export function decodeExportClientData(
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
