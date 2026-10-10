import {
  type GovernanceError,
  GovernanceErrorCode,
  ImpersonationEndReason as EndReason,
  ImpersonationSessionId as SessionId,
  ImpersonationState,
  ImpersonationStatus,
  ImpersonationSystem,
  type Role,
  UserId as UserKey,
  knownRoles,
} from '@creativo/ecs-core';
import {
  Clock,
  Result,
  ZonedDateTime,
  combineAll,
  fail,
  ok,
} from '@creativo/domain/kernel';
import { UserId, UserRole } from '@creativo/domain/accounts';
import { ImpersonationSessionId } from './ids';
import {
  ImpersonationScope,
  parseImpersonationScope,
} from './impersonation-scope';
import {
  ACTIVE_IMPERSONATION_STATUS,
  ImpersonationEndReason,
  ImpersonationSessionStatus,
} from './impersonation-session-status';
import {
  ImpersonatorNotStaffError,
  ImpersonationSessionAlreadyEndedError,
  ImpersonationReasonRequiredError,
  ImpersonationSessionValidationError,
  InvalidImpersonationExpiryError,
  SelfImpersonationError,
  StartImpersonationSessionError,
} from './impersonation-session.errors';

/**
 * All session timestamps are treated as bare instants (security/audit
 * data, not a business calendar day) — parsed in a fixed `UTC` zone so no
 * caller has to thread a tenant's timezone through an audit primitive
 * that never displays a calendar date.
 */
const INSTANT_ZONE = 'UTC';

/*
 * Phase 2 shim (ECS migration): the invariants, the staff gate, the end
 * and the expiry rule live in `ImpersonationSystem` (`@creativo/ecs-core`).
 * This class keeps its public API, its id/scope/instant parsing and its
 * error classes; the helpers below are the only code besides the delegating
 * bodies.
 */

/** What the structural invariants read, off the parsed fields. */
type ParsedShape = {
  readonly adminUserId: UserId;
  readonly targetUserId: UserId;
  readonly reason: string;
  readonly startedAt: ZonedDateTime;
  readonly expiresAt: ZonedDateTime;
};

function toShape(fields: ParsedShape) {
  return {
    adminUserId: UserKey.of(fields.adminUserId.value),
    targetUserId: UserKey.of(fields.targetUserId.value),
    reason: fields.reason,
    startedAtMs: fields.startedAt.toMillis(),
    expiresAtMs: fields.expiresAt.toMillis(),
  };
}

/** A role list as the staff gate reads it — an unknown string grants nothing either way. */
function toRoles(roles: readonly UserRole[]): readonly Role[] {
  return knownRoles(roles);
}

/** A structural fault back as this context's error class. */
function toLegacyFault(
  error: GovernanceError,
): ImpersonationSessionValidationError {
  switch (error.code) {
    case GovernanceErrorCode.ImpersonationSelf:
      return new SelfImpersonationError();
    case GovernanceErrorCode.ImpersonationReasonRequired:
      return new ImpersonationReasonRequiredError();
    default:
      return new InvalidImpersonationExpiryError();
  }
}

/** A start refusal back as this context's error class — the staff gate, or a structural fault. */
function toLegacyStartError(
  error: GovernanceError,
): StartImpersonationSessionError {
  return error.code === GovernanceErrorCode.ImpersonationAdminNotStaff
    ? new ImpersonatorNotStaffError(error.adminUserId)
    : toLegacyFault(error);
}

/** An end reason as the system's struct. */
function toEndReason(reason: ImpersonationEndReason): EndReason {
  switch (reason.kind) {
    case 'admin_ended':
      return EndReason.adminEnded(UserKey.of(reason.endedBy.value));
    case 'revoked_by_security':
      return EndReason.revokedBySecurity(
        UserKey.of(reason.revokedBy.value),
        reason.notes,
      );
    default:
      return EndReason.expired();
  }
}

/** The stored status as the system's struct. */
function toStatus(status: ImpersonationSessionStatus): ImpersonationStatus {
  return status.kind === 'active'
    ? ImpersonationStatus.active()
    : {
        kind: ImpersonationState.Ended,
        endedAtMs: status.endedAt.toMillis(),
        reason: toEndReason(status.reason),
      };
}

/** Fields shared by both build entry points. */
export interface ImpersonationSessionCoreProps {
  id: string;
  adminUserId: string;
  targetUserId: string;
  /** Raw `'read' | 'write'` — validated against `ImpersonationScope`. */
  scope: string;
  reason: string;
  startedAtIso: string;
  expiresAtIso: string;
}

export interface StartImpersonationSessionProps extends ImpersonationSessionCoreProps {
  /**
   * The roles held by `adminUserId` right now — gates `start()` to staff
   * (blueprint §7.8 goal condition: "which staff member is impersonating
   * which user, gated to staff roles"). Not needed at `reconstitute()`:
   * a session that was legitimately started stays a legitimate historical
   * record even if the admin's roles later change.
   */
  adminRoles: readonly UserRole[];
}

export interface ReconstituteImpersonationSessionProps extends ImpersonationSessionCoreProps {
  status: ImpersonationSessionStatus;
}

/**
 * **Aggregate root.** A time-bounded, audited session in which a staff
 * member acts on behalf of a target user — ported from v2's
 * `ImpersonationSession` (Stripe/Auth0-canon design, see that file's
 * doc-comment for the full token/claims rationale, which stays a
 * use-case/adapter concern, not a domain one).
 *
 * Invariants (enforced on both `start()` and `reconstitute()` — none of
 * these are "true only relative to now", unlike e.g. `Appointment`'s
 * must-start-in-the-future check):
 *   - `adminUserId !== targetUserId` — impersonating yourself is a no-op
 *     and almost certainly a bug.
 *   - `expiresAt` strictly after `startedAt`.
 *   - `reason.trim().length > 0` — every session demands a recorded
 *     justification.
 *
 * `start()` additionally gates on the admin's roles (`isStaff`) —
 * creation-only, see `StartImpersonationSessionProps.adminRoles`.
 *
 * Server-authoritative expiry (blueprint §7.8): `isExpired(clock)` is the
 * ONE place the expiry comparison is written, so a Cloud Functions
 * callable and a client-side guard share the exact same rule instead of
 * each re-implementing `expiresAt <= now`.
 *
 * Non-repudiability: `start`/`end` don't emit an `AuditEntry`
 * themselves (this is pure domain, no side effects), but every field a
 * caller needs to build one — `id`, `adminUserId`, `targetUserId`,
 * `scope`, `status` — is a public, already-domain-typed getter, so a
 * use case can construct a matching audit row for each transition
 * without reaching back into raw persistence.
 */
export class ImpersonationSession {
  private constructor(
    readonly id: ImpersonationSessionId,
    readonly adminUserId: UserId,
    readonly targetUserId: UserId,
    readonly scope: ImpersonationScope,
    readonly reason: string,
    readonly startedAt: ZonedDateTime,
    readonly expiresAt: ZonedDateTime,
    readonly status: ImpersonationSessionStatus,
  ) {}

  /** New session — enforces the staff-role gate on top of the shared structural invariants. */
  static start(
    props: StartImpersonationSessionProps,
  ): Result<ImpersonationSession, StartImpersonationSessionError[]> {
    const result = ImpersonationSession.build(
      props,
      ACTIVE_IMPERSONATION_STATUS,
    );
    if (result.isFailure()) {
      return result;
    }
    const session = result.value;
    const started = ImpersonationSystem.start({
      ...toShape(session),
      id: SessionId.of(session.id.value),
      adminRoles: toRoles(props.adminRoles),
      scope: session.scope,
    });
    if (!started.ok) {
      return fail(started.error.map(toLegacyStartError));
    }
    return result;
  }

  /** Rebuild from persistence — same structural validation, no role re-check (see class doc). */
  static reconstitute(
    props: ReconstituteImpersonationSessionProps,
  ): Result<ImpersonationSession, ImpersonationSessionValidationError[]> {
    return ImpersonationSession.build(props, props.status);
  }

  private static build(
    props: ImpersonationSessionCoreProps,
    status: ImpersonationSessionStatus,
  ): Result<ImpersonationSession, ImpersonationSessionValidationError[]> {
    const idResult = ImpersonationSessionId.create(props.id);
    const adminUserIdResult = UserId.create(props.adminUserId);
    const targetUserIdResult = UserId.create(props.targetUserId);
    const scopeResult = parseImpersonationScope(props.scope);
    const startedAtResult = ZonedDateTime.fromISO(
      props.startedAtIso,
      INSTANT_ZONE,
    );
    const expiresAtResult = ZonedDateTime.fromISO(
      props.expiresAtIso,
      INSTANT_ZONE,
    );

    const combined = combineAll([
      idResult,
      adminUserIdResult,
      targetUserIdResult,
      scopeResult,
      startedAtResult,
      expiresAtResult,
    ] as const);
    if (combined.isFailure()) {
      return fail(combined.error);
    }
    const [id, adminUserId, targetUserId, scope, startedAt, expiresAt] =
      combined.value;

    const faults = ImpersonationSystem.faults(
      toShape({
        adminUserId,
        targetUserId,
        reason: props.reason,
        startedAt,
        expiresAt,
      }),
    );
    if (faults.length > 0) {
      return fail(faults.map(toLegacyFault));
    }

    return ok(
      new ImpersonationSession(
        id,
        adminUserId,
        targetUserId,
        scope,
        props.reason.trim(),
        startedAt,
        expiresAt,
        status,
      ),
    );
  }

  /** Close an active session. Result-not-throw (deviation from v2, which throws — see repo-wide convention). */
  end(
    endedAt: ZonedDateTime,
    reason: ImpersonationEndReason,
  ): Result<ImpersonationSession, ImpersonationSessionAlreadyEndedError> {
    const ended = ImpersonationSystem.end(
      {
        ...toShape(this),
        id: SessionId.of(this.id.value),
        scope: this.scope,
        status: toStatus(this.status),
      },
      endedAt.toMillis(),
      toEndReason(reason),
    );
    if (!ended.ok) {
      return fail(new ImpersonationSessionAlreadyEndedError(this.id.value));
    }
    return ok(
      new ImpersonationSession(
        this.id,
        this.adminUserId,
        this.targetUserId,
        this.scope,
        this.reason,
        this.startedAt,
        this.expiresAt,
        ImpersonationSessionStatus.ended({ endedAt, reason }),
      ),
    );
  }

  isActive(): boolean {
    return this.status.kind === 'active';
  }

  /**
   * Whether the session's wall-clock window has elapsed as of `clock`'s
   * current instant. The ONE shared rule (blueprint §7.8) — a Firestore
   * row can still say `active` past this point until something (admin
   * end-call, cron sweep) materializes the `ended` state; callers making
   * an authorization decision MUST check this rather than trusting
   * `status.kind === 'active'` alone.
   */
  isExpired(clock: Clock): boolean {
    return ImpersonationSystem.isExpired(
      { expiresAtMs: this.expiresAt.toMillis() },
      clock.now().toMillis(),
    );
  }
}
