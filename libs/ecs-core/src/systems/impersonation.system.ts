import { GovernanceError } from '../components/governance-errors.data';
import type { ImpersonationScope } from '../components/impersonation-scope.data';
import {
  ImpersonationEndReason,
  ImpersonationStatus,
} from '../components/impersonation-status.data';
import { Result } from '../components/result.data';
import { type Role, isStaff } from '../components/role.data';
import type {
  ImpersonationSessionEntity,
  ImpersonationSessionId,
} from '../entities/impersonation-session.entity';
import type { UserId } from '../entities/user.entity';

/**
 * ImpersonationSystem — the time-bounded, audited session in which a staff
 * member acts on behalf of a user (blueprint §2.8), the pure port of
 * `libs/domain/governance/src/lib/impersonation-session.ts`
 * (`start`/`reconstitute` invariants, `end`, `isExpired`) and of the reason
 * pick of `EndImpersonationUseCase` (`end-impersonation.use-case.ts:42-44`).
 *
 * The structural invariants hold on every session, started or read back:
 * no self-impersonation, a non-blank recorded justification, and an expiry
 * strictly after the start. Starting one also needs a staff role set. The
 * expiry rule is the ONE place `expiresAtMs <= nowMs` is written — a stored
 * row may still say `active` past it, and an authorization decision reads
 * {@link ImpersonationSystem.isExpired}, never the stored status alone.
 */

/** What a start request carries — ids and scope already through their edge guards. */
export type StartImpersonation = {
  readonly id: ImpersonationSessionId;
  readonly adminUserId: UserId;
  /** The roles the admin holds NOW — the staff gate is a creation-time check only. */
  readonly adminRoles: readonly Role[];
  readonly targetUserId: UserId;
  readonly scope: ImpersonationScope;
  readonly reason: string;
  readonly startedAtMs: number;
  readonly expiresAtMs: number;
};

/** The fields the structural invariants read. */
export type ImpersonationShape = Pick<
  ImpersonationSessionEntity,
  'adminUserId' | 'targetUserId' | 'reason' | 'startedAtMs' | 'expiresAtMs'
>;

export const ImpersonationSystem = {
  /**
   * Every structural refusal at once, in the legacy order: self-
   * impersonation, a blank reason, an expiry not strictly after the start.
   * Empty for a sound session.
   */
  faults(session: ImpersonationShape): readonly GovernanceError[] {
    const faults: GovernanceError[] = [];
    if (session.adminUserId === session.targetUserId) {
      faults.push(GovernanceError.impersonationSelf());
    }
    if (session.reason.trim().length === 0) {
      faults.push(GovernanceError.impersonationReasonRequired());
    }
    if (!(session.startedAtMs < session.expiresAtMs)) {
      faults.push(GovernanceError.impersonationInvalidExpiry());
    }
    return faults;
  },

  /**
   * A new active session, the reason trimmed. Structural faults come first
   * and alone — the staff gate (`governance.impersonation_session.
   * admin_not_staff`) is asked only of a structurally sound request.
   */
  start(
    request: StartImpersonation,
  ): Result<ImpersonationSessionEntity, readonly GovernanceError[]> {
    const faults = ImpersonationSystem.faults(request);
    if (faults.length > 0) return Result.err(faults);
    if (!isStaff(request.adminRoles)) {
      return Result.err([
        GovernanceError.impersonationAdminNotStaff(request.adminUserId),
      ]);
    }
    return Result.ok({
      id: request.id,
      adminUserId: request.adminUserId,
      targetUserId: request.targetUserId,
      scope: request.scope,
      reason: request.reason.trim(),
      startedAtMs: request.startedAtMs,
      expiresAtMs: request.expiresAtMs,
      status: ImpersonationStatus.active(),
    });
  },

  /** Close an active session at `endedAtMs` for `reason`; the first end wins. */
  end(
    session: ImpersonationSessionEntity,
    endedAtMs: number,
    reason: ImpersonationEndReason,
  ): Result<ImpersonationSessionEntity, GovernanceError> {
    const status = ImpersonationStatus.end(session.status, endedAtMs, reason);
    if (status === null) {
      return Result.err(GovernanceError.impersonationAlreadyEnded(session.id));
    }
    return Result.ok({ ...session, status });
  },

  /**
   * An admin's end-call: tagged `expired` when the window had already
   * lapsed by the time the call arrived, `admin_ended` (by `endedBy`)
   * otherwise.
   */
  endByAdmin(
    session: ImpersonationSessionEntity,
    endedBy: UserId,
    nowMs: number,
  ): Result<ImpersonationSessionEntity, GovernanceError> {
    const reason = ImpersonationSystem.isExpired(session, nowMs)
      ? ImpersonationEndReason.expired()
      : ImpersonationEndReason.adminEnded(endedBy);
    return ImpersonationSystem.end(session, nowMs, reason);
  },

  /** The session's window has elapsed — true from `expiresAtMs` itself on. */
  isExpired(
    session: Pick<ImpersonationSessionEntity, 'expiresAtMs'>,
    nowMs: number,
  ): boolean {
    return session.expiresAtMs <= nowMs;
  },
} as const;
