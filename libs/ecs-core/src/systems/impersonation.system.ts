import {
  GovernanceError,
  Result,
  type ImpersonationSessionId,
  type UserId,
  UtcEpochMs,
} from '@core/primitives';
import {
  type ImpersonationScope,
  EndReasonFields,
  ImpersonationLifecycle,
  type Role,
  isStaff,
} from '@core/components';
import type {
  ImpersonationSession,
  ImpersonationSessionMeta,
} from '@core/entities';

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
 * expiry rule is the ONE place "expired" is written — a stored row may
 * still say `ACTIVE` past it, and an authorization decision reads
 * {@link ImpersonationSystem.isExpired}, never the stored status alone.
 * Every instant is a lifecycle stamp compared in elapsed real time (a T2
 * row, flatten-spec §2.3): a session has no location, so `nowUtcMs` (F-5).
 */

/** What a start request carries — ids and scope already through their edge guards. */
export type StartImpersonation = {
  readonly id: ImpersonationSessionId;
  readonly adminUserId: UserId;
  /** The roles the admin holds NOW — the staff gate is a creation-time check only. */
  readonly adminRoles: readonly Role[];
  readonly targetUserId: UserId;
  readonly impersonationScope: ImpersonationScope;
  readonly reason: string;
  readonly startedAtUtcMs: UtcEpochMs;
  readonly expiresAtUtcMs: UtcEpochMs;
};

/** The fields the structural invariants read. */
export type ImpersonationShape = Pick<
  ImpersonationSessionMeta,
  | 'adminUserId'
  | 'targetUserId'
  | 'reason'
  | 'startedAtUtcMs'
  | 'expiresAtUtcMs'
>;

/** The meta slice of a session — the fields an end carries over unchanged. */
function metaOf(session: ImpersonationSessionMeta): ImpersonationSessionMeta {
  return {
    id: session.id,
    adminUserId: session.adminUserId,
    targetUserId: session.targetUserId,
    impersonationScope: session.impersonationScope,
    reason: session.reason,
    startedAtUtcMs: session.startedAtUtcMs,
    expiresAtUtcMs: session.expiresAtUtcMs,
  };
}

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
    if (
      UtcEpochMs.compare(session.startedAtUtcMs, session.expiresAtUtcMs) >= 0
    ) {
      faults.push(GovernanceError.impersonationInvalidExpiry());
    }
    return faults;
  },

  /**
   * A new active session, the reason trimmed. Structural faults come first
   * and alone — the staff gate
   * (`GOVERNANCE_IMPERSONATION_SESSION_ADMIN_NOT_STAFF`) is asked only of a
   * structurally sound request.
   */
  start(
    request: StartImpersonation,
  ): Result<ImpersonationSession, readonly GovernanceError[]> {
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
      impersonationScope: request.impersonationScope,
      reason: request.reason.trim(),
      startedAtUtcMs: request.startedAtUtcMs,
      expiresAtUtcMs: request.expiresAtUtcMs,
      ...ImpersonationLifecycle.active(),
    });
  },

  /**
   * Close an active session at `endedAtUtcMs` for `reason`; the first end
   * wins. The ended session is exactly the `ENDED` variant: the meta slice,
   * the stamp and the reason's own fields at the root.
   */
  end(
    session: ImpersonationSession,
    endedAtUtcMs: UtcEpochMs,
    reason: EndReasonFields,
  ): Result<ImpersonationSession, GovernanceError> {
    const ended = ImpersonationLifecycle.end(session, endedAtUtcMs, reason);
    if (ended === null) {
      return Result.err(GovernanceError.impersonationAlreadyEnded(session.id));
    }
    return Result.ok({ ...metaOf(session), ...ended });
  },

  /**
   * An admin's end-call: tagged `EXPIRED` when the window had already
   * lapsed by the time the call arrived, `ADMIN_ENDED` (by
   * `endedByUserId`) otherwise.
   */
  endByAdmin(
    session: ImpersonationSession,
    endedByUserId: UserId,
    nowUtcMs: UtcEpochMs,
  ): Result<ImpersonationSession, GovernanceError> {
    const reason = ImpersonationSystem.isExpired(session, nowUtcMs)
      ? EndReasonFields.expired()
      : EndReasonFields.adminEnded(endedByUserId);
    return ImpersonationSystem.end(session, nowUtcMs, reason);
  },

  /** The session's window has elapsed — true from `expiresAtUtcMs` itself on. */
  isExpired(
    session: Pick<ImpersonationSessionMeta, 'expiresAtUtcMs'>,
    nowUtcMs: UtcEpochMs,
  ): boolean {
    return UtcEpochMs.compare(session.expiresAtUtcMs, nowUtcMs) <= 0;
  },
} as const;
