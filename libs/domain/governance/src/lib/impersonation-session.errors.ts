import { DomainError, InvalidDateTimeError } from '@creativo/domain/kernel';
import { EmptyIdError as AccountsEmptyIdError } from '@creativo/domain/accounts';
import { EmptyIdError } from './ids.errors';
import { InvalidImpersonationScopeError } from './impersonation-scope.errors';

export class SelfImpersonationError extends DomainError {
  override readonly code =
    'governance.impersonation_session.self_impersonation' as const;
  constructor() {
    super('An admin cannot impersonate themselves');
  }
}

export class ImpersonationReasonRequiredError extends DomainError {
  override readonly code =
    'governance.impersonation_session.reason_required' as const;
  constructor() {
    super('Every impersonation session requires a non-empty justification');
  }
}

export class InvalidImpersonationExpiryError extends DomainError {
  override readonly code =
    'governance.impersonation_session.invalid_expiry' as const;
  constructor() {
    super('expiresAt must be strictly after startedAt');
  }
}

/**
 * Enforces blueprint §7.8's staff-only gate: only a `UserRole` set that
 * satisfies `isStaff` may start an impersonation session. Creation-time
 * only (see `ImpersonationSession.start` vs `.reconstitute`) — a stored
 * historical session stays valid even if the admin's roles later change.
 */
export class ImpersonatorNotStaffError extends DomainError {
  override readonly code =
    'governance.impersonation_session.admin_not_staff' as const;
  constructor(public readonly adminUserId: string) {
    super(
      `User "${adminUserId}" does not hold a staff role and may not start an impersonation session`,
      { adminUserId },
    );
  }
}

/** Matches the goal-condition's example code verbatim (blueprint task spec). */
export class ImpersonationSessionAlreadyEndedError extends DomainError {
  override readonly code =
    'governance.impersonation_session.already_ended' as const;
  constructor(public readonly sessionId: string) {
    super(`Impersonation session "${sessionId}" has already ended`, {
      sessionId,
    });
  }
}

/**
 * Errors possible when building the session from persisted data (no
 * staff-role gate — see `ImpersonatorNotStaffError`). `EmptyIdError` here
 * covers `ImpersonationSessionId.create`; `AccountsEmptyIdError` covers
 * `UserId.create` (`adminUserId`/`targetUserId`) — same class name, two
 * distinct types minted by two different contexts (see `audit-entry.errors.ts`
 * for the same split).
 */
export type ImpersonationSessionValidationError =
  | EmptyIdError
  | AccountsEmptyIdError
  | InvalidDateTimeError
  | InvalidImpersonationScopeError
  | SelfImpersonationError
  | ImpersonationReasonRequiredError
  | InvalidImpersonationExpiryError;

/** Errors possible only at `start()` time — adds the staff-role gate. */
export type StartImpersonationSessionError =
  ImpersonationSessionValidationError | ImpersonatorNotStaffError;
