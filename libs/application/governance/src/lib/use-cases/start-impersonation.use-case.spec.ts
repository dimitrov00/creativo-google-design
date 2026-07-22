import { describe, expect, it } from 'vitest';
import { Result, ZonedDateTime, ok } from '@creativo/domain/kernel';
import { ImpersonationSession } from '@creativo/domain/governance';
import { UserId } from '@creativo/domain/accounts';
import { RepositoryError } from '@creativo/application/shared';
import { ImpersonationPort } from '../ports/impersonation.port';
import { StartImpersonationUseCase } from './start-impersonation.use-case';
import { StartImpersonationValidationFailure } from './start-impersonation.errors';

function requiredValue<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

const STARTED_AT = requiredValue(
  ZonedDateTime.fromISO('2026-01-01T00:00:00.000Z', 'UTC'),
);
const EXPIRES_AT = requiredValue(
  ZonedDateTime.fromISO('2026-01-01T01:00:00.000Z', 'UTC'),
);

function fakeRepository(): ImpersonationPort & {
  saved: ImpersonationSession[];
} {
  const saved: ImpersonationSession[] = [];
  return {
    saved,
    async save(session): Promise<Result<void, RepositoryError>> {
      saved.push(session);
      return ok(undefined);
    },
    async findById(): Promise<
      Result<ImpersonationSession | null, RepositoryError>
    > {
      return ok(null);
    },
    async findActiveForAdmin(): Promise<
      Result<ImpersonationSession | null, RepositoryError>
    > {
      return ok(null);
    },
  };
}

function fakeIdGenerator(prefix: string) {
  let n = 0;
  return { next: () => `${prefix}-${++n}` };
}

describe('StartImpersonationUseCase', () => {
  it('starts and saves a session for a staff admin', async () => {
    const repo = fakeRepository();
    const useCase = new StartImpersonationUseCase(
      repo,
      fakeIdGenerator('session'),
    );

    const result = await useCase.execute({
      adminUserId: requiredValue(UserId.create('admin_1')),
      adminRoles: ['admin'],
      targetUserId: requiredValue(UserId.create('target_1')),
      scope: 'write',
      reason: 'support ticket #123',
      startedAt: STARTED_AT,
      expiresAt: EXPIRES_AT,
    });

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.isActive()).toBe(true);
    }
    expect(repo.saved).toHaveLength(1);
  });

  it('rejects a non-staff impersonator', async () => {
    const repo = fakeRepository();
    const useCase = new StartImpersonationUseCase(
      repo,
      fakeIdGenerator('session'),
    );

    const result = await useCase.execute({
      adminUserId: requiredValue(UserId.create('admin_1')),
      adminRoles: ['client'],
      targetUserId: requiredValue(UserId.create('target_1')),
      scope: 'write',
      reason: 'support ticket #123',
      startedAt: STARTED_AT,
      expiresAt: EXPIRES_AT,
    });

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(StartImpersonationValidationFailure);
    }
    expect(repo.saved).toHaveLength(0);
  });
});
