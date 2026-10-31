import {
  ImpersonationSessionId,
  Result,
  StoredFields,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import { GovernanceError } from '@core/errors';
import { ImpersonationLifecycle, Roles } from '@core/components';
import {
  admitImpersonationCaller,
  admitRolesCaller,
  type EndImpersonationCommand,
  type SetRolesCommand,
  type StartImpersonationCommand,
} from '@core/pipelines';
import type { EdgeError } from '../edge';
import { callerKnownRoles, callerUserId } from '../lib/booking/caller-roles';
import { operationIdOf, payloadOf, type WireRequest } from './wire-read';

/**
 * THE IMPERSONATION CALLABLES' WIRE (Phase 4a 4A-3 (4)) — new with the
 * rules tightening that took the admin's direct write away
 * (`impersonationSessions` `allow write: if false`): the requests are the
 * call component `GovernanceCall` (`startImpersonation`) and
 * `GovernanceCall.End` (`endImpersonation`); each pipeline answers the call
 * component's answer itself (`GovernanceCall.Started` / `.Ended`, wired as
 * it is), and a refusal leaves as its ecs-core struct (`refusalOf`: a store
 * failure thrown).
 *
 * Both read the caller off the VERIFIED token FIRST — no session →
 * `GOVERNANCE_IMPERSONATION_UNAUTHENTICATED`, no admin role →
 * `GOVERNANCE_IMPERSONATION_FORBIDDEN` (`admitImpersonationCaller`, the
 * pipelines' own gate) — before the payload is read: a stranger learns
 * nothing about their asking. A start's structural faults (self, no
 * reason, no window) leave the pipeline as the FIRST of them — one flat
 * refusal per call, as every callable answers. No web caller exists yet
 * (4A-3 (4)).
 *
 * `setRoles` (security hardening S-WS-E) rides the same wire: its request is
 * `RolesCall`, its answer `RolesCall.Changed`, and its caller is read off the
 * verified token first through its own pipeline's gate
 * (`admitRolesCaller`: no session → `GOVERNANCE_ROLES_UNAUTHENTICATED`,
 * claims holding no `Roles.ASSIGN` role → `GOVERNANCE_ROLES_FORBIDDEN`)
 * before the payload is read.
 */

/**
 * A text field as sent — anything that is no string reads as none (`''`,
 * which every id's smart constructor and the reason's rule refuse), never
 * `String`-coerced into an id.
 */
function sentText(source: unknown, name: string): string {
  const value = StoredFields.field(source, name);
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
  const scope = ImpersonationLifecycle.parseScope(
    sentText(payload, 'impersonationScope'),
  );
  if (!scope.ok) return Result.err(scope.error);
  const rawExpiry = StoredFields.field(payload, 'expiresAtUtcMs');
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
    // The transport id, OPTIONAL (RU-21): absent or malformed is none.
    operationId: operationIdOf(payload, 'operationId'),
  });
}

export function decodeEndImpersonation(
  request: WireRequest,
): Result<EndImpersonationCommand, EdgeError> {
  const refused = gate(request);
  if (refused !== null) return Result.err(refused);
  const payload = payloadOf(request);
  const sessionId = ImpersonationSessionId.parse(
    sentText(payload, 'sessionId'),
  );
  if (!sessionId.ok) return Result.err(sessionId.error);
  return Result.ok({
    sessionId: sessionId.value,
    adminUserId: callerUserId(request),
    adminRoles: callerKnownRoles(request),
    // The transport id, OPTIONAL (RU-21): absent or malformed is none.
    operationId: operationIdOf(payload, 'operationId'),
  });
}

export function decodeSetRoles(
  request: WireRequest,
): Result<SetRolesCommand, EdgeError> {
  const admitted = admitRolesCaller(
    callerUserId(request),
    callerKnownRoles(request),
  );
  if (!admitted.ok) return admitted;
  const payload = payloadOf(request);
  const target = UserId.parse(sentText(payload, 'targetUserId'));
  if (!target.ok) return Result.err(target.error);
  // The requested set as sent: an array whose every entry is a `Role` value,
  // in the order given — the system deduplicates and orders it, and refuses
  // an empty set or the sysadmin; anything else is GOVERNANCE_ROLES_INVALID.
  const roles: unknown = StoredFields.field(payload, 'roles');
  if (!Array.isArray(roles) || !roles.every(Roles.isRole)) {
    return Result.err(GovernanceError.rolesInvalid());
  }
  return Result.ok({
    adminUserId: admitted.value,
    adminRoles: callerKnownRoles(request),
    targetUserId: target.value,
    roles,
    // The transport id, OPTIONAL (RU-21): absent or malformed is none.
    operationId: operationIdOf(payload, 'operationId'),
  });
}
