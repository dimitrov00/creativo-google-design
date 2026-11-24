import {
  Actor,
  type GovernanceCall,
  ImpersonationScope,
  type ReadAsClaims,
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
  Tag,
  type UserId,
} from '@core/primitives';
import {
  GovernanceError,
  GovernanceErrorCode,
  type StartImpersonationError,
} from '@core/errors';
import {
  Collections,
  type ImpersonationSession,
  type User,
} from '@core/entities';
import type {
  ClockPorts,
  CommitPorts,
  HashPorts,
  IdPorts,
  ReadAsTokenPorts,
  TelemetryPorts,
  TenantPorts,
} from '@core/ports';
import {
  AuditSystem,
  ImpersonationSystem,
  RegistrationSystem,
} from '@core/systems';

/**
 * `startImpersonation` — SUPPORT opens a time-bounded, audited, read-only
 * session in which it sees the app as a user (blueprint §2.8; Phase 4a
 * 4A-3 (4); the read-as of OR-24, docs/designs/support-read-as.md). The
 * callables are the ONLY writers of `impersonationSessions` (the rules
 * refuse every client write), so the caller gate is asked here BEFORE
 * anything else: no verified caller →
 * `GOVERNANCE_IMPERSONATION_UNAUTHENTICATED`, a caller whose verified roles
 * hold no support role (`Roles.runsReadAs`, `Roles.SUPPORT` — the sysadmin
 * alone, owner ruling 2026-11-24) → `GOVERNANCE_IMPERSONATION_FORBIDDEN`. Then `ImpersonationSystem.start` —
 * the structural invariants (no self-impersonation, a reason, an expiry
 * after the start) and its own staff gate — over a minted id and the
 * server's clock; a refused start leaves as the FIRST of its faults, one
 * flat refusal per call (Law 7.5). Then ONE commit (Law 4: the transaction
 * is the sandwich) that reads the target's `users/{uid}` — the ONE read —
 * and asks `ImpersonationSystem.admitTarget` (security hardening S-RU-5):
 * an absent, `ERASED` or never-registered target is refused with its code
 * and nothing is written (an erasure committing meanwhile is serialised by
 * the transaction); a `BLOCKED` one is admitted. An admitted target's plan
 * is two `Create`s: the flat `ACTIVE` body, and its audit row
 * (audit-hardening WS-3, DEP-12 —
 * `AuditSystem.planImpersonationStarted`: credited to the caller as
 * `Actor.forCaller` sees them (RU-13: the sysadmin is STAFF, never the
 * owner), naming the call's transport operation id, never the reason) under
 * `hash(idBasis)` — the row lands with the session or not at all, and is
 * never TTL'd. The functions TTL adapter stamps the session's `purgeAt`
 * (`expiresAtUtcMs` + 30 d, runbook §2.1). Every governance refusal
 * logs the one `impersonation.start.refused` line with its code; a store
 * failure answers as the commit answers it.
 *
 * THE TOKEN. The commit hands back the target's stored account it judged;
 * after it lands, the target's own claims (`RegistrationSystem.claimsFor`,
 * the claims their own sign-in carries, on the tenant) and the four
 * read-as claims are minted into ONE custom token whose uid is the target
 * (`mintReadAsToken`). Minting after the commit is deliberate: a session
 * row with no token is harmless — nothing can sign in with it, and it
 * expires — while a token with no row would be an unaudited session. Auth
 * failing to mint answers as the port answers it.
 */

export type StartImpersonationPorts = CommitPorts &
  ClockPorts &
  IdPorts &
  HashPorts &
  TenantPorts &
  ReadAsTokenPorts &
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

/** The caller as both impersonation callables gate it — the verified support account, or the refusal. */
export function admitImpersonationCaller(
  adminUserId: UserId | null,
  adminRoles: readonly Role[],
): Result<UserId, GovernanceError> {
  if (adminUserId === null) {
    return Result.err(GovernanceError.impersonationUnauthenticated());
  }
  return Roles.runsReadAs(adminRoles)
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
    const tenant = await ports.loadTenant();
    if (!tenant.ok) return tenant;
    const actor = Actor.forCaller(admitted.value, cmd.adminRoles);
    const committed = await ports.commit(
      (tx) => tx.get<User>([Collections.Users, session.targetUserId]),
      (
        stored,
      ): Result<
        { readonly target: User; readonly writes: readonly WriteOp[] },
        GovernanceError
      > => {
        const target = ImpersonationSystem.admitTarget(
          stored,
          session.targetUserId,
        );
        if (!target.ok) return target;
        return Result.ok({
          target: target.value,
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
        });
      },
    );
    if (!committed.ok) {
      if (Tag.has(GovernanceErrorCode, committed.error.errorCode)) {
        ports.log('info', LogEvent.ImpersonationStartRefused, {
          errorCode: committed.error.errorCode,
        });
      }
      return committed;
    }
    ports.log('info', LogEvent.ImpersonationStarted, {
      sessionId: id,
      adminUserId: session.adminUserId,
      targetUserId: session.targetUserId,
    });
    const target = committed.value.target;
    const readAs: ReadAsClaims = {
      readAsSessionId: id,
      readAsByUserId: session.adminUserId,
      readAsScope: ImpersonationScope.Read,
      readAsExpiresAtUtcMs: session.expiresAtUtcMs,
    };
    const customToken = await ports.mintReadAsToken(
      session.targetUserId,
      RegistrationSystem.claimsFor(
        target.registrationState,
        target.roles,
        tenant.value,
      ),
      readAs,
    );
    if (!customToken.ok) return customToken;
    return Result.ok({ sessionId: id, customToken: customToken.value });
  };
