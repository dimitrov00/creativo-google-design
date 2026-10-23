import { type GovernanceCall, parseImpersonationScope } from '@core/components';
import {
  ImpersonationSessionId,
  Result,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import { GovernanceError } from '@core/errors';
import {
  admitImpersonationCaller,
  type EndImpersonationCommand,
  type EndImpersonationError,
  type StartImpersonationCommand,
  type StartImpersonationError,
} from '@core/pipelines';
import type { EdgeError } from '../edge';
import { callerKnownRoles, callerUserId } from '../lib/booking/caller-roles';
import { field, payloadOf, refusalOf, type WireRequest } from './wire-read';

/**
 * THE IMPERSONATION CALLABLES' WIRE (Phase 4a 4A-3 (4)) — new with the
 * rules tightening that took the admin's direct write away
 * (`impersonationSessions` `allow write: if false`): the requests are the
 * call component `GovernanceCall` (`startImpersonation`) and
 * `GovernanceCall.End` (`endImpersonation`), the answers theirs, a refusal
 * its ecs-core struct.
 *
 * Both read the caller off the VERIFIED token FIRST — no session →
 * `GOVERNANCE_IMPERSONATION_UNAUTHENTICATED`, no admin role →
 * `GOVERNANCE_IMPERSONATION_FORBIDDEN` (`admitImpersonationCaller`, the
 * pipelines' own gate) — before the payload is read: a stranger learns
 * nothing about their asking. A start's structural faults (self, no
 * reason, no window) leave the pipeline as the FIRST of them — one flat
 * refusal per call, as every callable answers. No web caller exists yet
 * (4A-3 (4)).
 */

/**
 * A text field as sent — anything that is no string reads as none (`''`,
 * which every id's smart constructor and the reason's rule refuse), never
 * `String`-coerced into an id.
 */
function sentText(source: unknown, name: string): string {
  const value = field(source, name);
  return typeof value === 'string' ? value : '';
}

/** The caller's gate, answered before the payload is read. */
function gate(request: WireRequest): GovernanceError | null {
  const admitted = admitImpersonationCaller(
    callerUserId(request),
    callerKnownRoles(request),
  );
  return admitted.ok ? null : admitted.error;
}

export function decodeStartImpersonation(
  request: WireRequest,
): Result<StartImpersonationCommand, EdgeError> {
  const refused = gate(request);
  if (refused !== null) return Result.err(refused);
  const payload = payloadOf(request);
  const target = UserId.parse(sentText(payload, 'targetUserId'));
  if (!target.ok) return Result.err(target.error);
  const scope = parseImpersonationScope(
    sentText(payload, 'impersonationScope'),
  );
  if (!scope.ok) return Result.err(scope.error);
  const rawExpiry = field(payload, 'expiresAtUtcMs');
  const expiry =
    typeof rawExpiry === 'number' ? UtcEpochMs.of(rawExpiry) : null;
  if (expiry === null || !expiry.ok) {
    return Result.err(GovernanceError.impersonationInvalidExpiry());
  }
  return Result.ok({
    adminUserId: callerUserId(request),
    adminRoles: callerKnownRoles(request),
    targetUserId: target.value,
    impersonationScope: scope.value,
    reason: sentText(payload, 'reason'),
    expiresAtUtcMs: expiry.value,
  });
}

export function encodeStartImpersonationAnswer(
  answer: GovernanceCall.Started,
): GovernanceCall.Started {
  return { sessionId: answer.sessionId };
}

/** A start's refusal as itself — the pipeline already chose the first fault (a store failure thrown). */
export function startImpersonationRefusal(
  error: StartImpersonationError,
): EdgeError {
  return refusalOf(error);
}

export function decodeEndImpersonation(
  request: WireRequest,
): Result<EndImpersonationCommand, EdgeError> {
  const refused = gate(request);
  if (refused !== null) return Result.err(refused);
  const sessionId = ImpersonationSessionId.parse(
    sentText(payloadOf(request), 'sessionId'),
  );
  if (!sessionId.ok) return Result.err(sessionId.error);
  return Result.ok({
    sessionId: sessionId.value,
    adminUserId: callerUserId(request),
    adminRoles: callerKnownRoles(request),
  });
}

export function encodeEndImpersonationAnswer(
  answer: GovernanceCall.Ended,
): GovernanceCall.Ended {
  return {
    sessionId: answer.sessionId,
    impersonationEndReason: answer.impersonationEndReason,
  };
}

/** An end's refusal as itself (a store failure thrown). */
export function endImpersonationRefusal(
  error: EndImpersonationError,
): EdgeError {
  return refusalOf(error);
}
