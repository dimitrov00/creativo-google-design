import { describe, expect, it } from 'vitest';
import { Result, ok } from '@creativo/domain/kernel';
import { AuthGateway, AuthGatewayError } from '../ports/auth-gateway.port';
import { SignOutUseCase } from './sign-out.use-case';

function fakeAuthGateway(): AuthGateway & { signedOut: boolean } {
  let signedOut = false;
  return {
    get signedOut() {
      return signedOut;
    },
    observePrincipal: () => {
      throw new Error('not used in this spec');
    },
    refreshToken: () => {
      throw new Error('not used in this spec');
    },
    async signOut(): Promise<Result<void, AuthGatewayError>> {
      signedOut = true;
      return ok(undefined);
    },
  };
}

describe('SignOutUseCase', () => {
  it('delegates to the auth gateway', async () => {
    const gateway = fakeAuthGateway();
    const useCase = new SignOutUseCase(gateway);

    const result = await useCase.execute();

    expect(result.isSuccess()).toBe(true);
    expect(gateway.signedOut).toBe(true);
  });
});
