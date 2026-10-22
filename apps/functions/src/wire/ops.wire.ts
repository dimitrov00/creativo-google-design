import {
  type RepositoryError,
  Result,
  type RunBackfillRefusal,
  RunBackfillRefusalCode,
} from '@core/primitives';
import { Actor, type BackfillCall, Role } from '@core/components';
import { BackfillPlanSystem } from '@core/systems';
import type { RunBackfillCommand } from '@core/pipelines';
import type { EdgeError } from '../edge';
import { callerRoles, callerUserId } from '../lib/booking/caller-roles';
import { field, payloadOf, refusalOf, type WireRequest } from './wire-read';

/**
 * THE `runBackfill` CALLABLE'S WIRE (Phase 4a 4A-4) — flipped with the
 * runners that loop it (`verify:p0`): the request is the call component
 * `BackfillCall` `{ backfillJobName, backfillResume, cursor }`, the answer
 * one page, `BackfillCall.Page` (`runStartedAtUtcMs`, never an ISO text).
 *
 * - `backfillResume: true` continues wherever the job's progress document
 *   says (the request names no cursor); otherwise `cursor` is the page to
 *   start after, `null` = from the top (`BackfillPlanSystem.requestOf`
 *   validates it). A payload that names no job decodes to `request: null`,
 *   which the pipeline refuses — AFTER the stored-roles check, as today.
 * - No caller → `OPS_BACKFILL_UNAUTHENTICATED`, a token without `sysadmin`
 *   → `OPS_BACKFILL_FORBIDDEN`, answered here; the stored-roles refusal and
 *   a bad job leave as the pipeline's own.
 *
 * A store failure is no refusal: it is thrown, for the edge to track and
 * answer as the platform's bare INTERNAL.
 */

/**
 * The definition's platform timeout — the reserve the chunk in hand, the
 * closing sample and the audit row are never killed inside. The call's own
 * work budget (a share of the client's 70 s wait) is the edge's
 * (`callableEdge` with this as `timeoutSeconds`).
 */
export const RUN_BACKFILL_TIMEOUT_SECONDS = 540;

/** The call as the payload the system parses — `{ backfillJobName, cursor? }`, no cursor key to resume. */
function requestStruct(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') return raw;
  const backfillJobName = field(raw, 'backfillJobName');
  return field(raw, 'backfillResume') === true
    ? { backfillJobName }
    : { backfillJobName, cursor: field(raw, 'cursor') ?? null };
}

export function decodeRunBackfill(
  request: WireRequest,
): Result<RunBackfillCommand, EdgeError> {
  const uid = callerUserId(request);
  if (uid === null) {
    return Result.err({ errorCode: RunBackfillRefusalCode.Unauthenticated });
  }
  const roles = callerRoles(request);
  if (!roles.includes(Role.Sysadmin)) {
    return Result.err({ errorCode: RunBackfillRefusalCode.Forbidden });
  }
  return Result.ok({
    callerUserId: uid,
    actor: Actor.forCaller(uid, roles),
    request: BackfillPlanSystem.requestOf(requestStruct(payloadOf(request))),
  });
}

/** One page, as the pipeline answered it. */
export function encodeRunBackfillAnswer(
  page: BackfillCall.Page,
): BackfillCall.Page {
  return page;
}

/** The stored-roles refusal and a bad job leave as themselves (a store failure thrown). */
export function runBackfillRefusal(
  error: RunBackfillRefusal | RepositoryError,
): EdgeError {
  return refusalOf(error);
}
