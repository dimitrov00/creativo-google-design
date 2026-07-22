import { describe, expect, it } from 'vitest';
import { Result, ZonedDateTime, ok } from '@creativo/domain/kernel';
import { ImpersonationSession } from '@creativo/domain/governance';
import { UserId } from '@creativo/domain/accounts';
import { RepositoryError } from '@creativo/application/shared';
import { ImpersonationPort } from '../ports/impersonation.port';
import { EndImpersonationUseCase } from './end-impersonation.use-case';
import { ImpersonationSessionNotFoundError } from './end-impersonation.errors';

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

function activeSession(): ImpersonationSession {
  return requiredValue(
    ImpersonationSession.start({
      id: 'session_1',
      adminUserId: 'admin_1',
      targetUserId: 'target_1',
      adminRoles: ['admin'],
      scope: 'write',
      reason: 'support ticket #123',
      startedAtIso: STARTED_AT.toISO(),
      expiresAtIso: EXPIRES_AT.toISO(),
    }),
  );
}

function fakeRepository(
  seed: ImpersonationSession | null,
): ImpersonationPort & { saved: ImpersonationSession[] } {
  const saved: ImpersonationSession[] = [];
  let current = seed;
  return {
    saved,
    async save(session): Promise<Result<void, RepositoryError>> {
      saved.push(session);
      current = session;
      return ok(undefined);
    },
    async findById(): Promise<
      Result<ImpersonationSession | null, RepositoryError>
    > {
      return ok(current);
    },
    async findActiveForAdmin(): Promise<
      Result<ImpersonationSession | null, RepositoryError>
    > {
      return ok(current);
    },
  };
}

describe('EndImpersonationUseCase', () => {
  it('ends an active session with an admin_ended reason before expiry', async () => {
    const session = activeSession();
    const repo = fakeRepository(session);
    const useCase = new EndImpersonationUseCase(repo);

    const result = await useCase.execute({
      sessionId: session.id,
      endedBy: requiredValue(UserId.create('admin_1')),
      now: STARTED_AT.plusMinutes(5),
    });

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.status.kind).toBe('ended');
      if (result.value.status.kind === 'ended') {
        expect(result.value.status.reason.kind).toBe('admin_ended');
      }
    }
  });

  it('tags the reason as expired when the window had already lapsed', async () => {
    const session = activeSession();
    const repo = fakeRepository(session);
    const useCase = new EndImpersonationUseCase(repo);

    const result = await useCase.execute({
      sessionId: session.id,
      endedBy: requiredValue(UserId.create('admin_1')),
      now: EXPIRES_AT.plusMinutes(10),
    });

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess() && result.value.status.kind === 'ended') {
      expect(result.value.status.reason.kind).toBe('expired');
    }
  });

  it('reports not-found for an unknown session', async () => {
    const repo = fakeRepository(null);
    const useCase = new EndImpersonationUseCase(repo);

    const result = await useCase.execute({
      sessionId: activeSession().id,
      endedBy: requiredValue(UserId.create('admin_1')),
      now: STARTED_AT.plusMinutes(5),
    });

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(ImpersonationSessionNotFoundError);
    }
  });
});
