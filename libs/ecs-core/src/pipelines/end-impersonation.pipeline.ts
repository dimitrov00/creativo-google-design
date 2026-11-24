import {
  Actor,
  type GovernanceCall,
  ImpersonationStatus,
  type ReadAsClaims,
  type Role,
  WriteOp,
} from '@core/components';
import {
  defect,
  LogEvent,
  type OperationId,
  Result,
  type UserId,
} from '@core/primitives';
import { type EndImpersonationError, GovernanceError } from '@core/errors';
import type { ImpersonationSession } from '@core/entities';
import type {
  ClockPorts,
  CommitPorts,
  HashPorts,
  TelemetryPorts,
} from '@core/ports';
import { AuditSystem, ImpersonationSystem } from '@core/systems';
import {
  admitImpersonationCaller,
  impersonationSessionPath,
} from './start-impersonation.pipeline';

/**
 * `endImpersonation` — support closes a session (blueprint §2.8; Phase 4a
 * 4A-3 (4)), asked BEFORE any read, by one of two callers:
 * - the support account from its own session, on the SAME gate as the
 *   start: no verified caller → `GOVERNANCE_IMPERSONATION_UNAUTHENTICATED`,
 *   no support role → `GOVERNANCE_IMPERSONATION_FORBIDDEN`;
 * - the read-as session itself (its «Край», OR-24), under its own token —
 *   it may end THAT session and no other (another id →
 *   `GOVERNANCE_IMPERSONATION_FORBIDDEN`), credited to the support account
 *   the token names, as `Actor.impersonator`.
 * (`ImpersonationSystem.endByAdmin` checks neither roles nor ownership, so
 * without the gate any signed-in caller holding a session id could end a
 * session.) Then ONE
 * transaction reads the session by id — absent →
 * `GOVERNANCE_END_IMPERSONATION_NOT_FOUND` — and `endByAdmin` ends it on the
 * server's clock: `EXPIRED` when its window had lapsed, `ADMIN_ENDED` by the
 * caller otherwise, `ALREADY_ENDED` when the first end won.
 *
 * The plan is ONE `Set` of the whole ENDED body, never a field transition:
 * the functions TTL adapter stamps `purgeAt` only on a `Set`/`Create`, and
 * the end re-stamps it to `endedAtUtcMs` + 30 d (runbook §2.1); a `Set` of
 * the ended variant also replaces every field the active one held. Beside
 * it, in the same commit, the end's audit row (audit-hardening WS-3,
 * DEP-12 — `AuditSystem.planImpersonationEnded`: `ADMIN_ENDED` or
 * `EXPIRED`, credited as `Actor.forCaller` sees the caller, RU-13, naming
 * the call's operation id) under `hash(idBasis)`. A second end is refused
 * by `endByAdmin` before any plan is built — no row, no tripwire.
 */

export type EndImpersonationPorts = CommitPorts &
  ClockPorts &
  HashPorts &
  TelemetryPorts;

/** The call (`GovernanceCall.End`) & the verified caller — the start's shape. */
export type EndImpersonationCommand = GovernanceCall.End & {
  /** The verified session's uid; `null` without one. */
  readonly adminUserId: UserId | null;
  /** The verified token's roles. */
  readonly adminRoles: readonly Role[];
  /**
   * The verified token's read-as claims (`ReadAsClaims.fromToken`) — `null`
   * on a plain session. Under a read-as the uid is the TARGET's.
   */
  readonly readAs: ReadAsClaims | null;
  /**
   * The call's transport operation id (WS-4.1, RU-21) — optional on the
   * wire: absent or malformed is `null`, never refused.
   */
  readonly operationId: OperationId | null;
};

/** Who ends the session, and how the audit row credits them. */
type EndCaller = { readonly endedBy: UserId; readonly actor: Actor };

/**
 * The end's caller: a read-as session ending ITSELF (credited to the
 * support account its token names, as an impersonator), or the support
 * account through {@link admitImpersonationCaller}.
 */
export function admitEndCaller(
  cmd: EndImpersonationCommand,
): Result<EndCaller, GovernanceError> {
  const readAs = cmd.readAs;
  if (readAs !== null) {
    if (cmd.adminUserId === null) {
      return Result.err(GovernanceError.impersonationUnauthenticated());
    }
    if (readAs.readAsSessionId !== cmd.sessionId) {
      return Result.err(
        GovernanceError.impersonationForbidden(cmd.adminUserId),
      );
    }
    return Result.ok({
      endedBy: readAs.readAsByUserId,
      actor: Actor.impersonator(
        readAs.readAsByUserId,
        cmd.adminUserId,
        readAs.readAsSessionId,
        readAs.readAsScope,
      ),
    });
  }
  const admitted = admitImpersonationCaller(cmd.adminUserId, cmd.adminRoles);
  if (!admitted.ok) return admitted;
  return Result.ok({
    endedBy: admitted.value,
    actor: Actor.forCaller(admitted.value, cmd.adminRoles),
  });
}

/** The answer and its one write. */
type Ended = GovernanceCall.Ended & { readonly writes: readonly WriteOp[] };

export const endImpersonation =
  (ports: EndImpersonationPorts) =>
  async (
    cmd: EndImpersonationCommand,
  ): Promise<Result<GovernanceCall.Ended, EndImpersonationError>> => {
    const admitted = admitEndCaller(cmd);
    if (!admitted.ok) {
      ports.log('info', LogEvent.ImpersonationEndRefused, {
        errorCode: admitted.error.errorCode,
      });
      return admitted;
    }
    const { endedBy, actor } = admitted.value;
    // Read once, before the transaction: `decide` may run more than once.
    const nowUtcMs = ports.nowUtcMs();
    const path = impersonationSessionPath(cmd.sessionId);
    const committed = await ports.commit(
      (tx) => tx.get<ImpersonationSession>(path),
      (stored): Result<Ended, GovernanceError> => {
        if (stored === null) {
          return Result.err(
            GovernanceError.endImpersonationNotFound(cmd.sessionId),
          );
        }
        const ended = ImpersonationSystem.endByAdmin(stored, endedBy, nowUtcMs);
        if (!ended.ok) return ended;
        const session = ended.value;
        if (session.impersonationStatus !== ImpersonationStatus.Ended) {
          return defect('endByAdmin answers the ended variant only');
        }
        const { id, ...body } = session;
        return Result.ok({
          sessionId: id,
          impersonationEndReason: session.impersonationEndReason,
          writes: [
            WriteOp.set(impersonationSessionPath(id), body),
            ...AuditSystem.createsOf(
              [
                AuditSystem.planImpersonationEnded(
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
    if (!committed.ok) return committed;
    const { sessionId, impersonationEndReason } = committed.value;
    ports.log('info', LogEvent.ImpersonationEnded, {
      sessionId,
      impersonationEndReason,
    });
    return Result.ok({ sessionId, impersonationEndReason });
  };
