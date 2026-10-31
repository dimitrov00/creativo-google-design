import {
  Result,
  type ImpersonationSessionId,
  type UserId,
  UtcEpochMs,
} from '@core/primitives';
import { GovernanceError } from '@core/errors';
import {
  AccountLifecycle,
  type ImpersonationScope,
  EndReasonFields,
  ImpersonationLifecycle,
  Registration,
  type Role,
  Roles,
} from '@core/components';
import type {
  ImpersonationSession,
  ImpersonationSessionMeta,
  User,
} from '@core/entities';

/**
 * ImpersonationSystem — the time-bounded, audited session in which a staff
 * member acts on behalf of a user (blueprint §2.8), the pure port of the
 * legacy governance `impersonation-session.ts` (deleted in Phase 4b)
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
 * The target a start may open on is decided here too
 * ({@link ImpersonationSystem.admitTarget}, security hardening S-RU-5):
 * the pipeline reads `users/{target}` inside its commit and asks.
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

/**
 * A projection: the meta slice of a whole session — the fields an end
 * carries over unchanged; the active variant's fields are left behind.
 */
function metaOf<S extends ImpersonationSessionMeta>(
  session: S,
): ImpersonationSessionMeta {
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
    if (!Roles.isStaff(request.adminRoles)) {
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

  /**
   * The stored target an impersonation may open on: present, not erased,
   * registered — asked in that order, the first failing answer alone
   * (security hardening S-RU-5, S-L-13). No `users` document →
   * `GOVERNANCE_IMPERSONATION_TARGET_NOT_FOUND`; an `ERASED` account →
   * `GOVERNANCE_IMPERSONATION_TARGET_ERASED`; a `PROVISIONED` stub that
   * never finished registering →
   * `GOVERNANCE_IMPERSONATION_TARGET_NOT_REGISTERED`. A `BLOCKED` account
   * is admitted: support may need to see what a blocked client sees.
   * Answers the stored account itself, never a copy.
   */
  admitTarget(
    stored: User | null,
    targetUserId: UserId,
  ): Result<User, GovernanceError> {
    if (stored === null) {
      return Result.err(
        GovernanceError.impersonationTargetNotFound(targetUserId),
      );
    }
    if (AccountLifecycle.isErased(stored)) {
      return Result.err(
        GovernanceError.impersonationTargetErased(targetUserId),
      );
    }
    if (!Registration.isRegistered(stored)) {
      return Result.err(
        GovernanceError.impersonationTargetNotRegistered(targetUserId),
      );
    }
    return Result.ok(stored);
  },

  /** The session's window has elapsed — true from `expiresAtUtcMs` itself on. */
  isExpired(
    session: Pick<ImpersonationSessionMeta, 'expiresAtUtcMs'>,
    nowUtcMs: UtcEpochMs,
  ): boolean {
    return UtcEpochMs.compare(session.expiresAtUtcMs, nowUtcMs) <= 0;
  },
} as const;
