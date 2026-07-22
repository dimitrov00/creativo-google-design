import {
  Clock,
  Result,
  ZonedDateTime,
  combineAll,
  fail,
  ok,
} from '@creativo/domain/kernel';
import { UserId, UserRole, isStaff } from '@creativo/domain/accounts';
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
    if (!isStaff(props.adminRoles)) {
      return fail([new ImpersonatorNotStaffError(props.adminUserId)]);
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

    const errors: ImpersonationSessionValidationError[] = [];
    if (adminUserId.equals(targetUserId)) {
      errors.push(new SelfImpersonationError());
    }
    if (props.reason.trim().length === 0) {
      errors.push(new ImpersonationReasonRequiredError());
    }
    if (!startedAt.isBefore(expiresAt)) {
      errors.push(new InvalidImpersonationExpiryError());
    }
    if (errors.length > 0) {
      return fail(errors);
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
    if (this.status.kind !== 'active') {
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
    return this.expiresAt.isSameOrBefore(clock.now());
  }
}
