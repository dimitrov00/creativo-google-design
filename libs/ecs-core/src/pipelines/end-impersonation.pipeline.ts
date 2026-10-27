import {
  Actor,
  type GovernanceCall,
  ImpersonationStatus,
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
 * `endImpersonation` — an admin closes a session (blueprint §2.8; Phase 4a
 * 4A-3 (4)), on the SAME caller gate as the start, asked BEFORE any read:
 * no verified caller → `GOVERNANCE_IMPERSONATION_UNAUTHENTICATED`, no admin
 * role → `GOVERNANCE_IMPERSONATION_FORBIDDEN` (`ImpersonationSystem.endByAdmin`
 * checks neither roles nor ownership, so without the gate any signed-in
 * caller holding a session id could end an admin's session). Then ONE
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
   * The call's transport operation id (WS-4.1, RU-21) — optional on the
   * wire: absent or malformed is `null`, never refused.
   */
  readonly operationId: OperationId | null;
};

/** The answer and its one write. */
type Ended = GovernanceCall.Ended & { readonly writes: readonly WriteOp[] };

export const endImpersonation =
  (ports: EndImpersonationPorts) =>
  async (
    cmd: EndImpersonationCommand,
  ): Promise<Result<GovernanceCall.Ended, EndImpersonationError>> => {
    const admitted = admitImpersonationCaller(cmd.adminUserId, cmd.adminRoles);
    if (!admitted.ok) {
      ports.log('info', LogEvent.ImpersonationEndRefused, {
        errorCode: admitted.error.errorCode,
      });
      return admitted;
    }
    const endedBy = admitted.value;
    const actor = Actor.forCaller(endedBy, cmd.adminRoles);
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
