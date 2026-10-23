import {
  type GovernanceCall,
  isAdmin,
  type Role,
  WriteOp,
} from '@core/components';
import {
  defect,
  ImpersonationSessionId,
  Result,
  type UserId,
} from '@core/primitives';
import { GovernanceError, type RepositoryError } from '@core/errors';
import { Collections, type ImpersonationSession } from '@core/entities';
import type {
  ClockPorts,
  CommitPorts,
  IdPorts,
  TelemetryPorts,
} from '@core/ports';
import { ImpersonationSystem } from '@core/systems';

/**
 * `startImpersonation` — an admin opens a time-bounded, audited session in
 * which they act as a user (blueprint §2.8; Phase 4a 4A-3 (4)). Since
 * Phase 4a the callables are the ONLY writers of `impersonationSessions`
 * (the rules refuse every client write), so the caller gate is today's
 * rule, `isAdmin()`, asked here BEFORE anything else: no verified caller →
 * `GOVERNANCE_IMPERSONATION_UNAUTHENTICATED`, a caller whose verified roles
 * hold no admin role (`isAdmin`, `ADMIN_ROLES`) →
 * `GOVERNANCE_IMPERSONATION_FORBIDDEN`. Then `ImpersonationSystem.start` —
 * the structural invariants (no self-impersonation, a reason, an expiry
 * after the start) and its own staff gate — over a minted id and the
 * server's clock; a refused start leaves as the FIRST of its faults, one
 * flat refusal per call (Law 7.5). Then ONE `Create` of the flat `ACTIVE`
 * body. The functions TTL adapter stamps its `purgeAt`
 * (`expiresAtUtcMs` + 30 d, runbook §2.1). Nothing is read.
 */

export type StartImpersonationPorts = CommitPorts &
  ClockPorts &
  IdPorts &
  TelemetryPorts;

/** The call (`GovernanceCall`) & the verified caller — never the payload's. */
export type StartImpersonationCommand = GovernanceCall & {
  /** The verified session's uid; `null` without one. */
  readonly adminUserId: UserId | null;
  /** The verified token's roles. */
  readonly adminRoles: readonly Role[];
};

export type StartImpersonationError = GovernanceError | RepositoryError;

/** The caller as both impersonation callables gate it — a verified admin, or the refusal. */
export function admitImpersonationCaller(
  adminUserId: UserId | null,
  adminRoles: readonly Role[],
): Result<UserId, GovernanceError> {
  if (adminUserId === null) {
    return Result.err(GovernanceError.impersonationUnauthenticated());
  }
  return isAdmin(adminRoles)
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
      ports.log('info', 'impersonation.start.refused', {
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
    const committed = await ports.commit(
      async () => null,
      (): Result<{ readonly writes: readonly WriteOp[] }, never> =>
        Result.ok({
          writes: [WriteOp.create(impersonationSessionPath(id), body)],
        }),
    );
    if (!committed.ok) return committed;
    ports.log('info', 'impersonation.started', {
      sessionId: id,
      adminUserId: session.adminUserId,
      targetUserId: session.targetUserId,
    });
    return Result.ok({ sessionId: id });
  };
