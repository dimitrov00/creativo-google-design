import { describe, expect, it } from 'vitest';
import { Result, ZonedDateTime, ok } from '@creativo/domain/kernel';
import { Invitation } from '@creativo/domain/engagement';
import { UserId } from '@creativo/domain/accounts';
import { RepositoryError } from '@creativo/application/shared';
import { InvitationPort } from '../ports/invitation.port';
import { CreateInvitationUseCase } from './create-invitation.use-case';

function requiredValue<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

function fakeInvitations(): InvitationPort & { saved: Invitation[] } {
  const saved: Invitation[] = [];
  return {
    saved,
    async save(invitation): Promise<Result<void, RepositoryError>> {
      saved.push(invitation);
      return ok(undefined);
    },
    async findById(): Promise<Result<Invitation | null, RepositoryError>> {
      return ok(null);
    },
    async saveRedemption(): Promise<Result<void, RepositoryError>> {
      return ok(undefined);
    },
  };
}

function fakeIdGenerator(prefix: string) {
  let n = 0;
  return { next: () => `${prefix}-${++n}` };
}

describe('CreateInvitationUseCase', () => {
  it('creates and saves a fresh, zero-redemption invitation', async () => {
    const invitations = fakeInvitations();
    const useCase = new CreateInvitationUseCase(
      invitations,
      fakeIdGenerator('invite'),
    );
    const now = requiredValue(
      ZonedDateTime.fromISO('2026-01-01T00:00:00.000Z', 'UTC'),
    );

    const result = await useCase.execute({
      inviterUserId: requiredValue(UserId.create('user_1')),
      inviterName: 'Jane',
      now,
    });

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.redemptionCount).toBe(0);
    }
    expect(invitations.saved).toHaveLength(1);
  });
});
