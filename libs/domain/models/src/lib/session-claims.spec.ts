import { describe, expect, it } from 'vitest';
import { SessionClaims } from './session-claims';

describe('SessionClaims.fromToken', () => {
  it('accepts a valid claims payload', () => {
    const result = SessionClaims.fromToken({
      tenantId: 'creativo',
      role: 'client',
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.tenantId).toBe('creativo');
      expect(result.value.role).toBe('client');
    }
  });

  it('rejects a non-object payload', () => {
    expect(SessionClaims.fromToken(null).isFailure()).toBe(true);
    expect(SessionClaims.fromToken('nope').isFailure()).toBe(true);
  });

  it('rejects a missing/empty tenantId', () => {
    expect(SessionClaims.fromToken({ role: 'client' }).isFailure()).toBe(true);
    expect(
      SessionClaims.fromToken({ tenantId: '', role: 'client' }).isFailure(),
    ).toBe(true);
  });

  it('rejects an unknown role', () => {
    expect(
      SessionClaims.fromToken({
        tenantId: 'creativo',
        role: 'superadmin',
      }).isFailure(),
    ).toBe(true);
  });
});

describe('SessionClaims.hasRole', () => {
  it('matches when the role is in the allowed list', () => {
    const result = SessionClaims.fromToken({
      tenantId: 'creativo',
      role: 'owner',
    });
    if (result.isFailure())
      throw new Error('unexpected failure in test fixture');
    expect(result.value.hasRole('owner', 'performer')).toBe(true);
    expect(result.value.hasRole('client')).toBe(false);
  });
});
