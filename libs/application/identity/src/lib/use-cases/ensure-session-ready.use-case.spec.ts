import { describe, expect, it } from 'vitest';
import { Observable, of } from 'rxjs';
import { Result, ok } from '@creativo/domain/kernel';
import {
  Principal,
  PrincipalId,
  roleFromPrimitive,
} from '@creativo/domain/identity';
import { AuthGateway, AuthGatewayError } from '../ports/auth-gateway.port';
import {
  EnsureSessionReadyUseCase,
  REFRESH_UNTIL_ACTIVE_BACKOFF_MS,
} from './ensure-session-ready.use-case';

function requiredValue<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

const UID = requiredValue(PrincipalId.create('user_1'));

function fakeGateway(principals: readonly Principal[]): AuthGateway & {
  refreshCount: number;
} {
  let index = 0;
  let refreshCount = 0;
  return {
    get refreshCount() {
      return refreshCount;
    },
    observePrincipal(): Observable<Principal> {
      const principal = principals[
        Math.min(index, principals.length - 1)
      ] as Principal;
      return of(principal);
    },
    async refreshToken(): Promise<Result<void, AuthGatewayError>> {
      refreshCount++;
      index++;
      return ok(undefined);
    },
    async signOut(): Promise<Result<void, AuthGatewayError>> {
      return ok(undefined);
    },
  };
}

const noDelay = async () => undefined;

describe('EnsureSessionReadyUseCase', () => {
  it('returns immediately when already active — no refresh needed', async () => {
    const gateway = fakeGateway([
      { kind: 'active', uid: UID, roles: [roleFromPrimitive('client')] },
    ]);
    const useCase = new EnsureSessionReadyUseCase(gateway, { delay: noDelay });

    const result = await useCase.execute();

    expect(result.isSuccess()).toBe(true);
    expect(gateway.refreshCount).toBe(0);
  });

  it('retries refreshToken until the claim flips to active', async () => {
    const gateway = fakeGateway([
      { kind: 'onboarding', uid: UID },
      { kind: 'onboarding', uid: UID },
      { kind: 'active', uid: UID, roles: [roleFromPrimitive('client')] },
    ]);
    const useCase = new EnsureSessionReadyUseCase(gateway, { delay: noDelay });

    const result = await useCase.execute();

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.kind).toBe('active');
    }
    expect(gateway.refreshCount).toBe(2);
  });

  it('gives up after exhausting the fixed backoff schedule, still onboarding', async () => {
    const gateway = fakeGateway([{ kind: 'onboarding', uid: UID }]);
    const useCase = new EnsureSessionReadyUseCase(gateway, { delay: noDelay });

    const result = await useCase.execute();

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.kind).toBe('onboarding');
    }
    expect(gateway.refreshCount).toBe(REFRESH_UNTIL_ACTIVE_BACKOFF_MS.length);
  });
});
