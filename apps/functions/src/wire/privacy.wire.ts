import { CustomerId, Result, StoredFields } from '@core/primitives';
import { PrivacyError } from '@core/errors';
import { Roles } from '@core/components';
import type { ClientPrivacyCommand } from '@core/pipelines';
import type { EdgeError } from '../edge';
import { callerKnownRoles, callerUserId } from '../lib/booking/caller-roles';
import { idOf, operationIdOf, payloadOf, type WireRequest } from './wire-read';

/**
 * THE PRIVACY CALLABLES' WIRE (audit-hardening Phase 3, WS-C / WS-D) — the
 * admin's data-subject requests: `exportClientData`, and the erasure's
 * read-only `previewClientErasure` and resumable `eraseClient`. The request
 * of all three is the call component `ClientPrivacyCall`
 * `{ customerId, operationId }`, decoded by ONE reading
 * (`decodeClientPrivacyCall`: the same gate and field rules) into the ONE
 * command both pipelines take (`ClientPrivacyCommand`). The answers are
 * the pipelines' own, `ClientPrivacyCall.Exported`, `.ErasurePreview` and
 * `.Erasure`, wired as they are (`exportJson` byte for byte); a refusal
 * leaves as itself (`refusalOf`) — the pipeline's `PRIVACY_*` struct, or
 * the Auth eraser's `PIPELINE_*` failure (its SDK code stays on the
 * server: the row names no field), a store failure thrown. The preview and
 * the erasure refuse alike.
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
 * The ONE reading of a privacy call — `exportClientData`'s,
 * `previewClientErasure`'s and `eraseClient`'s request alike: the verified
 * caller's gate before the payload, then the record's id and the act's own
 * id, both required (a retry of the same act sends the same `operationId`,
 * so a resumed erasure plans no second row).
 */
export function decodeClientPrivacyCall(
  request: WireRequest,
): Result<ClientPrivacyCommand, EdgeError> {
  // The caller's gate, answered before the payload is read.
  const callerUid = callerUserId(request);
  if (callerUid === null) return Result.err(PrivacyError.unauthenticated());
  if (!Roles.handlesClientPrivacy(callerKnownRoles(request))) {
    return Result.err(PrivacyError.forbidden());
  }
  const payload = payloadOf(request);
  const customerId = idOf(
    StoredFields.field(payload, 'customerId'),
    CustomerId.parse,
  );
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
