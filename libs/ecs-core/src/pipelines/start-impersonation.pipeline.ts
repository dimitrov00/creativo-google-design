import {
  Actor,
  type GovernanceCall,
  type Role,
  Roles,
  WriteOp,
} from '@core/components';
import {
  defect,
  ImpersonationSessionId,
  LogEvent,
  type OperationId,
  Result,
  type UserId,
} from '@core/primitives';
import { GovernanceError, type StartImpersonationError } from '@core/errors';
import { Collections, type ImpersonationSession } from '@core/entities';
import type {
  ClockPorts,
  CommitPorts,
  HashPorts,
  IdPorts,
  TelemetryPorts,
} from '@core/ports';
import { AuditSystem, ImpersonationSystem } from '@core/systems';

/**
 * `startImpersonation` — an admin opens a time-bounded, audited session in
 * which they act as a user (blueprint §2.8; Phase 4a 4A-3 (4)). Since
 * Phase 4a the callables are the ONLY writers of `impersonationSessions`
 * (the rules refuse every client write), so the caller gate is today's
 * rule, `isAdmin()`, asked here BEFORE anything else: no verified caller →
 * `GOVERNANCE_IMPERSONATION_UNAUTHENTICATED`, a caller whose verified roles
 * hold no admin role (`Roles.isAdmin`, `Roles.ADMIN`) →
 * `GOVERNANCE_IMPERSONATION_FORBIDDEN`. Then `ImpersonationSystem.start` —
 * the structural invariants (no self-impersonation, a reason, an expiry
 * after the start) and its own staff gate — over a minted id and the
 * server's clock; a refused start leaves as the FIRST of its faults, one
 * flat refusal per call (Law 7.5). Then ONE commit of two `Create`s: the
 * flat `ACTIVE` body, and its audit row (audit-hardening WS-3, DEP-12 —
 * `AuditSystem.planImpersonationStarted`: credited to the caller as
 * `Actor.forCaller` sees them (RU-13: the sysadmin is STAFF, never the
 * owner), naming the call's transport operation id, never the reason) under
 * `hash(idBasis)` — the row lands with the session or not at all, and is
 * never TTL'd. The functions TTL adapter stamps the session's `purgeAt`
 * (`expiresAtUtcMs` + 30 d, runbook §2.1). Nothing is read.
 */

export type StartImpersonationPorts = CommitPorts &
  ClockPorts &
  IdPorts &
  HashPorts &
  TelemetryPorts;

/** The call (`GovernanceCall`) & the verified caller — never the payload's. */
export type StartImpersonationCommand = GovernanceCall & {
  /** The verified session's uid; `null` without one. */
  readonly adminUserId: UserId | null;
  /** The verified token's roles. */
  readonly adminRoles: readonly Role[];
  /**
   * The call's transport operation id (WS-4.1, RU-21) — optional on the
   * wire: absent or malformed is `null`, never refused.
   */
  readonly operationId: OperationId | null;
};

/** The caller as both impersonation callables gate it — a verified admin, or the refusal. */
export function admitImpersonationCaller(
  adminUserId: UserId | null,
  adminRoles: readonly Role[],
): Result<UserId, GovernanceError> {
  if (adminUserId === null) {
    return Result.err(GovernanceError.impersonationUnauthenticated());
  }
  return Roles.isAdmin(adminRoles)
    ? Result.ok(adminUserId)
    : Result.err(GovernanceError.impersonationForbidden(adminUserId));
}

/** Where one session lives. */
export function impersonationSessionPath(
  sessionId: ImpersonationSessionId,
): readonly string[] {
  return [Collections.ImpersonationSessions, sessionId];
}

export const startImpersonation =
  (ports: StartImpersonationPorts) =>
  async (
    cmd: StartImpersonationCommand,
  ): Promise<Result<GovernanceCall.Started, StartImpersonationError>> => {
    const admitted = admitImpersonationCaller(cmd.adminUserId, cmd.adminRoles);
    if (!admitted.ok) {
      ports.log('info', LogEvent.ImpersonationStartRefused, {
        errorCode: admitted.error.errorCode,
      });
      return admitted;
    }
    const started = ImpersonationSystem.start({
      id: ImpersonationSessionId.of(ports.nextId()),
      adminUserId: admitted.value,
      adminRoles: cmd.adminRoles,
      targetUserId: cmd.targetUserId,
      impersonationScope: cmd.impersonationScope,
      reason: cmd.reason,
      startedAtUtcMs: ports.nowUtcMs(),
      expiresAtUtcMs: cmd.expiresAtUtcMs,
    });
    if (!started.ok) {
      return Result.err(
        started.error[0] ?? defect('a refused start names its faults'),
      );
    }
    const session: ImpersonationSession = started.value;
    const { id, ...body } = session;
    const actor = Actor.forCaller(admitted.value, cmd.adminRoles);
    const committed = await ports.commit(
      async () => null,
      (): Result<{ readonly writes: readonly WriteOp[] }, never> =>
        Result.ok({
          writes: [
            WriteOp.create(impersonationSessionPath(id), body),
            ...AuditSystem.createsOf(
              [
                AuditSystem.planImpersonationStarted(
                  session,
                  actor,
                  cmd.operationId,
                ),
              ],
              ports.hash,
            ),
          ],
        }),
    );
    if (!committed.ok) return committed;
    ports.log('info', LogEvent.ImpersonationStarted, {
      sessionId: id,
      adminUserId: session.adminUserId,
      targetUserId: session.targetUserId,
    });
    return Result.ok({ sessionId: id });
  };
