import { describe, expect, it } from 'vitest';
import { User } from './user';

function validProps() {
  return {
    id: 'uid_1',
    displayName: 'Ivo',
    email: 'client@example.com',
    phone: '+15551234567',
    referralCode: 'ABC123',
    gamificationPoints: 10,
    tenantMemberships: [{ tenantId: 'creativo', role: 'client' as const }],
  };
}

describe('User.create', () => {
  it('accepts fully valid props', () => {
    const result = User.create(validProps());
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.referralCode).toBe('ABC123');
      expect(result.value.tenantMemberships).toHaveLength(1);
      expect(result.value.tenantMemberships[0]?.role).toBe('client');
    }
  });

  it('allows omitting optional fields and an empty memberships list', () => {
    const result = User.create({
      id: 'uid_1',
      referralCode: 'ABC123',
      gamificationPoints: 0,
      tenantMemberships: [],
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.displayName).toBeNull();
      expect(result.value.email).toBeNull();
      expect(result.value.tenantMemberships).toEqual([]);
    }
  });

  it('rejects an empty referral code', () => {
    expect(
      User.create({ ...validProps(), referralCode: '  ' }).isFailure(),
    ).toBe(true);
  });

  it('rejects negative gamification points', () => {
    expect(
      User.create({ ...validProps(), gamificationPoints: -1 }).isFailure(),
    ).toBe(true);
  });

  it('rejects a malformed email when provided', () => {
    expect(
      User.create({ ...validProps(), email: 'not-an-email' }).isFailure(),
    ).toBe(true);
  });

  it('rejects an empty tenantId inside a membership', () => {
    const result = User.create({
      ...validProps(),
      tenantMemberships: [{ tenantId: '', role: 'client' }],
    });
    expect(result.isFailure()).toBe(true);
  });

  it('collects multiple field errors at once', () => {
    const result = User.create({
      ...validProps(),
      referralCode: '',
      gamificationPoints: -5,
      email: 'nope',
    });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.length).toBeGreaterThanOrEqual(3);
    }
  });
});
