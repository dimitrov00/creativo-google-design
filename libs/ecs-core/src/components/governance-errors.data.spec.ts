import { describe, expect, it } from 'vitest';
import { GovernanceError, GovernanceErrorCode } from './governance-errors.data';

describe('GovernanceError', () => {
  it('builds each struct with its dotted code and i18n params', () => {
    expect(GovernanceError.auditEntryEmptyAction()).toEqual({
      code: 'governance.audit_entry.empty_action',
    });
    expect(GovernanceError.featureFlagsUnknownKey('rewards.points')).toEqual({
      code: 'governance.feature_flags.unknown_key',
      attempted: 'rewards.points',
    });
    expect(GovernanceError.featureFlagsInvalidValue('loyalty.points')).toEqual({
      code: 'governance.feature_flags.invalid_value',
      key: 'loyalty.points',
    });
    expect(GovernanceError.impersonationScopeInvalid('admin')).toEqual({
      code: 'governance.impersonation_scope.invalid',
      attempted: 'admin',
    });
    expect(GovernanceError.impersonationSelf()).toEqual({
      code: 'governance.impersonation_session.self_impersonation',
    });
    expect(GovernanceError.impersonationReasonRequired()).toEqual({
      code: 'governance.impersonation_session.reason_required',
    });
    expect(GovernanceError.impersonationInvalidExpiry()).toEqual({
      code: 'governance.impersonation_session.invalid_expiry',
    });
    expect(GovernanceError.impersonationAdminNotStaff('u1')).toEqual({
      code: 'governance.impersonation_session.admin_not_staff',
      adminUserId: 'u1',
    });
    expect(GovernanceError.impersonationAlreadyEnded('s1')).toEqual({
      code: 'governance.impersonation_session.already_ended',
      sessionId: 's1',
    });
    expect(GovernanceError.endImpersonationNotFound('s2')).toEqual({
      code: 'governance.end_impersonation.not_found',
      sessionId: 's2',
    });
    expect(GovernanceError.searchUsersQueryTooShort(2)).toEqual({
      code: 'governance.search_users.query_too_short',
      minLength: 2,
    });
  });

  it('keeps every code in the governance namespace, each once', () => {
    const codes = Object.values(GovernanceErrorCode);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^governance\.[a-z_.]+$/);
  });

  it('is() narrows by code', () => {
    const error: GovernanceError =
      GovernanceError.impersonationAlreadyEnded('s1');
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
