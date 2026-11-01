import { describe, expect, it } from 'vitest';
import { ImpersonationSessionId, UserId } from '@core/primitives';
import { GovernanceError, GovernanceErrorCode } from './governance.error';

describe('GovernanceError', () => {
  it('builds each struct with its errorCode and i18n params', () => {
    expect(GovernanceError.auditEntryEmptyAction()).toEqual({
      errorCode: 'GOVERNANCE_AUDIT_ENTRY_EMPTY_ACTION',
    });
    expect(GovernanceError.featureFlagsUnknownKey('rewards.points')).toEqual({
      errorCode: 'GOVERNANCE_FEATURE_FLAGS_UNKNOWN_KEY',
      attempted: 'rewards.points',
    });
    expect(GovernanceError.featureFlagsInvalidValue('loyalty.points')).toEqual({
      errorCode: 'GOVERNANCE_FEATURE_FLAGS_INVALID_VALUE',
      key: 'loyalty.points',
    });
    expect(GovernanceError.impersonationScopeInvalid('admin')).toEqual({
      errorCode: 'GOVERNANCE_IMPERSONATION_SCOPE_INVALID',
      attempted: 'admin',
    });
    expect(GovernanceError.impersonationSelf()).toEqual({
      errorCode: 'GOVERNANCE_IMPERSONATION_SESSION_SELF_IMPERSONATION',
    });
    expect(GovernanceError.impersonationReasonRequired()).toEqual({
      errorCode: 'GOVERNANCE_IMPERSONATION_SESSION_REASON_REQUIRED',
    });
    expect(GovernanceError.impersonationInvalidExpiry()).toEqual({
      errorCode: 'GOVERNANCE_IMPERSONATION_SESSION_INVALID_EXPIRY',
    });
    expect(GovernanceError.impersonationAdminNotStaff(UserId.of('u1'))).toEqual(
      {
        errorCode: 'GOVERNANCE_IMPERSONATION_SESSION_ADMIN_NOT_STAFF',
        adminUserId: 'u1',
      },
    );
    expect(
      GovernanceError.impersonationAlreadyEnded(
        ImpersonationSessionId.of('s1'),
      ),
    ).toEqual({
      errorCode: 'GOVERNANCE_IMPERSONATION_SESSION_ALREADY_ENDED',
      sessionId: 's1',
    });
    expect(
      GovernanceError.endImpersonationNotFound(ImpersonationSessionId.of('s2')),
    ).toEqual({
      errorCode: 'GOVERNANCE_END_IMPERSONATION_NOT_FOUND',
      sessionId: 's2',
    });
    expect(GovernanceError.searchUsersQueryTooShort(2)).toEqual({
      errorCode: 'GOVERNANCE_SEARCH_USERS_QUERY_TOO_SHORT',
      minLength: 2,
    });
  });

  it('builds the impersonation target refusals, each naming the uid the start named (S-RU-5)', () => {
    const target = UserId.of('u-target');
    expect(GovernanceError.impersonationTargetNotFound(target)).toEqual({
      errorCode: 'GOVERNANCE_IMPERSONATION_TARGET_NOT_FOUND',
      targetUserId: 'u-target',
    });
    expect(GovernanceError.impersonationTargetErased(target)).toEqual({
      errorCode: 'GOVERNANCE_IMPERSONATION_TARGET_ERASED',
      targetUserId: 'u-target',
    });
    expect(GovernanceError.impersonationTargetNotRegistered(target)).toEqual({
      errorCode: 'GOVERNANCE_IMPERSONATION_TARGET_NOT_REGISTERED',
      targetUserId: 'u-target',
    });
  });

  it('builds the roles-change refusals, each naming the caller or the target (S-WS-E, S-L-15)', () => {
    const caller = UserId.of('u-admin');
    const target = UserId.of('u-target');
    expect(GovernanceError.rolesUnauthenticated()).toEqual({
      errorCode: 'GOVERNANCE_ROLES_UNAUTHENTICATED',
    });
    expect(GovernanceError.rolesForbidden(caller)).toEqual({
      errorCode: 'GOVERNANCE_ROLES_FORBIDDEN',
      callerUserId: 'u-admin',
    });
    expect(GovernanceError.rolesInvalid()).toEqual({
      errorCode: 'GOVERNANCE_ROLES_INVALID',
    });
    expect(GovernanceError.rolesSelf(caller)).toEqual({
      errorCode: 'GOVERNANCE_ROLES_SELF',
      callerUserId: 'u-admin',
    });
    expect(GovernanceError.rolesTargetNotFound(target)).toEqual({
      errorCode: 'GOVERNANCE_ROLES_TARGET_NOT_FOUND',
      targetUserId: 'u-target',
    });
    expect(GovernanceError.rolesTargetNotRegistered(target)).toEqual({
      errorCode: 'GOVERNANCE_ROLES_TARGET_NOT_REGISTERED',
      targetUserId: 'u-target',
    });
    expect(GovernanceError.rolesTargetErased(target)).toEqual({
      errorCode: 'GOVERNANCE_ROLES_TARGET_ERASED',
      targetUserId: 'u-target',
    });
    expect(GovernanceError.rolesTargetSysadmin(target)).toEqual({
      errorCode: 'GOVERNANCE_ROLES_TARGET_SYSADMIN',
      targetUserId: 'u-target',
    });
    expect(GovernanceError.rolesSessionsNotRevoked(target)).toEqual({
      errorCode: 'GOVERNANCE_ROLES_SESSIONS_NOT_REVOKED',
      targetUserId: 'u-target',
    });
  });

  it('keeps every code in the GOVERNANCE_ domain, SCREAMING_SNAKE, each once', () => {
    const codes = Object.values(GovernanceErrorCode);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^GOVERNANCE_[A-Z_]+$/);
  });

  it('is() narrows by errorCode', () => {
    const error: GovernanceError = GovernanceError.impersonationAlreadyEnded(
      ImpersonationSessionId.of('s1'),
    );
    expect(
      GovernanceError.is(error, GovernanceErrorCode.ImpersonationAlreadyEnded),
    ).toBe(true);
    expect(
      GovernanceError.is(error, GovernanceErrorCode.ImpersonationSelf),
    ).toBe(false);
    if (
      GovernanceError.is(error, GovernanceErrorCode.ImpersonationAlreadyEnded)
    ) {
      expect(error.sessionId).toBe('s1');
    }
  });
});
