import { describe, expect, it } from 'vitest';
import { Result, ok } from '@creativo/domain/kernel';
import {
  AuthStrategy,
  Identifier,
  createIdentifier,
} from '@creativo/domain/identity';
import { OtpClient, OtpClientError } from '../ports/otp-client.port';
import {
  MissingRegistrationFieldError,
  RegisterUserUseCase,
} from './register-user.use-case';

function requiredValue<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

const IDENTIFIER: Identifier = requiredValue(
  createIdentifier({ kind: 'email', value: 'client@example.com' }),
);

const STRATEGY: AuthStrategy = {
  kind: 'email_otp',
  required: ['phone', 'firstName', 'lastName'],
  policy: { ttlMinutes: 5, maxAttempts: 5, sessionDays: 30 },
};

function fakeOtpClient(): OtpClient & { registered: unknown[] } {
  const registered: unknown[] = [];
  return {
    registered,
    requestChallenge: () => {
      throw new Error('not used in this spec');
    },
    verifyChallenge: () => {
      throw new Error('not used in this spec');
    },
    async completeRegistration(
      identifier,
      fields,
    ): Promise<Result<void, OtpClientError>> {
      registered.push({ identifier, fields });
      return ok(undefined);
    },
  };
}

describe('RegisterUserUseCase', () => {
  it('completes registration once every required field is present', async () => {
    const client = fakeOtpClient();
    const useCase = new RegisterUserUseCase(client);

    const result = await useCase.execute(IDENTIFIER, STRATEGY, {
      phone: '+359881234567',
      firstName: 'Jane',
      lastName: 'Doe',
    });

    expect(result.isSuccess()).toBe(true);
    expect(client.registered).toHaveLength(1);
  });

  it('rejects when a required field is missing, without calling the client', async () => {
    const client = fakeOtpClient();
    const useCase = new RegisterUserUseCase(client);

    const result = await useCase.execute(IDENTIFIER, STRATEGY, {
      phone: '+359881234567',
      firstName: 'Jane',
    });

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(MissingRegistrationFieldError);
    }
    expect(client.registered).toHaveLength(0);
  });
});
