import { ZonedDateTime } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import { describe, expect, it } from 'vitest';
import { Invitation } from './invitation';
import { InvitationRedemption } from './invitation-redemption';

const zone = 'Europe/Sofia';
function at(iso: string): ZonedDateTime {
  const r = ZonedDateTime.fromISO(iso, zone);
  if (r.isFailure()) throw new Error('bad fixture');
  return r.value;
}

describe('InvitationRedemption.create', () => {
  it('creates a valid redemption record', () => {
    const result = InvitationRedemption.create({
      invitationId: 'invite-1',
      refereeUserId: UserId.generate().toString(),
      redeemedAt: at('2026-01-01T00:00:00'),
    });
    expect(result.isSuccess()).toBe(true);
  });

  it('rejects an empty invitation id', () => {
    const result = InvitationRedemption.create({
      invitationId: '',
      refereeUserId: UserId.generate().toString(),
      redeemedAt: at('2026-01-01T00:00:00'),
    });
    expect(result.isFailure()).toBe(true);
  });
});

describe('InvitationRedemption.forInvitation', () => {
  it('rejects the inviter redeeming their own invitation', () => {
    const inviter = UserId.generate();
    const invitation = Invitation.create({
      id: 'invite-1',
      inviterUserId: inviter.toString(),
      inviterName: 'Ivan',
      createdAt: at('2026-01-01T00:00:00'),
    });
    if (invitation.isFailure()) throw new Error('bad fixture');
    const result = InvitationRedemption.forInvitation(
      invitation.value,
      inviter,
      at('2026-01-02T00:00:00'),
    );
    expect(result.isFailure()).toBe(true);
  });

  it('accepts a different user redeeming the invitation', () => {
    const invitation = Invitation.create({
      id: 'invite-1',
      inviterUserId: UserId.generate().toString(),
      inviterName: 'Ivan',
      createdAt: at('2026-01-01T00:00:00'),
    });
    if (invitation.isFailure()) throw new Error('bad fixture');
    const result = InvitationRedemption.forInvitation(
      invitation.value,
      UserId.generate(),
      at('2026-01-02T00:00:00'),
    );
    expect(result.isSuccess()).toBe(true);
  });
});
