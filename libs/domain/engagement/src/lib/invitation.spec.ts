import { ZonedDateTime } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import { describe, expect, it } from 'vitest';
import { Invitation } from './invitation';

const zone = 'Europe/Sofia';
function at(iso: string): ZonedDateTime {
  const r = ZonedDateTime.fromISO(iso, zone);
  if (r.isFailure()) throw new Error('bad fixture');
  return r.value;
}

describe('Invitation.create', () => {
  const baseProps = {
    id: 'invite-1',
    inviterUserId: UserId.generate().toString(),
    inviterName: 'Ivan',
    createdAt: at('2026-01-01T00:00:00'),
  };

  it('creates a fresh invitation with zero redemptions', () => {
    const result = Invitation.create(baseProps);
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.redemptionCount).toBe(0);
    }
  });

  it('rejects an empty inviter name', () => {
    const result = Invitation.create({ ...baseProps, inviterName: '  ' });
    expect(result.isFailure()).toBe(true);
  });

  it('rejects an empty inviter user id', () => {
    const result = Invitation.create({ ...baseProps, inviterUserId: '' });
    expect(result.isFailure()).toBe(true);
  });
});

describe('Invitation.reconstitute', () => {
  it('rejects a negative redemption count', () => {
    const result = Invitation.reconstitute({
      id: 'invite-1',
      inviterUserId: UserId.generate().toString(),
      inviterName: 'Ivan',
      createdAt: at('2026-01-01T00:00:00'),
      redemptionCount: -1,
    });
    expect(result.isFailure()).toBe(true);
  });

  it('accepts a valid non-zero redemption count', () => {
    const result = Invitation.reconstitute({
      id: 'invite-1',
      inviterUserId: UserId.generate().toString(),
      inviterName: 'Ivan',
      createdAt: at('2026-01-01T00:00:00'),
      redemptionCount: 3,
    });
    expect(result.isSuccess()).toBe(true);
  });
});

describe('Invitation.recordRedemption', () => {
  it('increments the redemption count, returning a new instance', () => {
    const created = Invitation.create({
      id: 'invite-1',
      inviterUserId: UserId.generate().toString(),
      inviterName: 'Ivan',
      createdAt: at('2026-01-01T00:00:00'),
    });
    if (created.isFailure()) throw new Error('bad fixture');
    const bumped = created.value.recordRedemption();
    expect(bumped.redemptionCount).toBe(1);
    expect(created.value.redemptionCount).toBe(0);
  });
});

describe('Invitation.isSelfInvitation', () => {
  it('detects when the candidate is the inviter', () => {
    const inviter = UserId.generate();
    const created = Invitation.create({
      id: 'invite-1',
      inviterUserId: inviter.toString(),
      inviterName: 'Ivan',
      createdAt: at('2026-01-01T00:00:00'),
    });
    if (created.isFailure()) throw new Error('bad fixture');
    expect(created.value.isSelfInvitation(inviter)).toBe(true);
    expect(created.value.isSelfInvitation(UserId.generate())).toBe(false);
  });
});
