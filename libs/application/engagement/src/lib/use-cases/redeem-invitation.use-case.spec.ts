import { describe, expect, it } from 'vitest';
import { Result, ZonedDateTime, ok } from '@creativo/domain/kernel';
import { Invitation, InvitationRedemption } from '@creativo/domain/engagement';
import { UserId } from '@creativo/domain/accounts';
import { RepositoryError } from '@creativo/application/shared';
import { InvitationPort } from '../ports/invitation.port';
import { RedeemInvitationUseCase } from './redeem-invitation.use-case';
import { InvitationNotFoundError } from './redeem-invitation.errors';
import { InvitationSelfRedemptionError } from '@creativo/domain/engagement';

function requiredValue<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

const NOW = requiredValue(
  ZonedDateTime.fromISO('2026-01-01T00:00:00.000Z', 'UTC'),
);

function invitation(inviterUserId: string): Invitation {
  return requiredValue(
    Invitation.create({
      id: 'invite_1',
      inviterUserId,
      inviterName: 'Jane',
      createdAt: NOW,
    }),
  );
}

function fakeInvitations(seed: Invitation | null): InvitationPort & {
  saved: Invitation[];
  redemptions: InvitationRedemption[];
} {
  const saved: Invitation[] = [];
  const redemptions: InvitationRedemption[] = [];
  let current = seed;
  return {
    saved,
    redemptions,
    async save(inv): Promise<Result<void, RepositoryError>> {
      saved.push(inv);
      current = inv;
      return ok(undefined);
    },
    async findById(): Promise<Result<Invitation | null, RepositoryError>> {
      return ok(current);
    },
    async saveRedemption(redemption): Promise<Result<void, RepositoryError>> {
      redemptions.push(redemption);
      return ok(undefined);
    },
  };
}

describe('RedeemInvitationUseCase', () => {
  it('records a redemption and bumps the invitation counter', async () => {
    const invitations = fakeInvitations(invitation('user_owner'));
    const useCase = new RedeemInvitationUseCase(invitations);

    const result = await useCase.execute({
      invitationId: invitation('user_owner').id,
      refereeUserId: requiredValue(UserId.create('user_referee')),
      now: NOW,
    });

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.redemptionCount).toBe(1);
    }
    expect(invitations.redemptions).toHaveLength(1);
  });

  it('rejects self-redemption', async () => {
    const invitations = fakeInvitations(invitation('user_owner'));
    const useCase = new RedeemInvitationUseCase(invitations);

    const result = await useCase.execute({
      invitationId: invitation('user_owner').id,
      refereeUserId: requiredValue(UserId.create('user_owner')),
      now: NOW,
    });

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(InvitationSelfRedemptionError);
    }
    expect(invitations.redemptions).toHaveLength(0);
  });

  it('reports not-found for an unknown invitation', async () => {
    const invitations = fakeInvitations(null);
    const useCase = new RedeemInvitationUseCase(invitations);

    const result = await useCase.execute({
      invitationId: invitation('user_owner').id,
      refereeUserId: requiredValue(UserId.create('user_referee')),
      now: NOW,
    });

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(InvitationNotFoundError);
    }
  });
});
