import { describe, expect, it } from 'vitest';
import { Result, ok } from '@creativo/domain/kernel';
import { NEW_SESSION } from '@creativo/domain/identity';
import {
  OtpChallengeId,
  OtpClient,
  OtpClientError,
} from '../ports/otp-client.port';
import { VerifyOtpUseCase } from './verify-otp.use-case';

function fakeOtpClient(): OtpClient {
  return {
    requestChallenge: () => {
      throw new Error('not used in this spec');
    },
    async verifyChallenge() {
      return ok(NEW_SESSION);
    },
    completeRegistration: () => {
      throw new Error('not used in this spec');
    },
  };
}

describe('VerifyOtpUseCase', () => {
  it('verifies a well-formed 6-digit code', async () => {
    const useCase = new VerifyOtpUseCase(fakeOtpClient());

    const result = await useCase.execute(
      'challenge_1' as OtpChallengeId,
      '123456',
    );

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.kind).toBe('new');
    }
  });

  it('rejects a malformed code without calling the client', async () => {
    let called = false;
    const client: OtpClient = {
      requestChallenge: () => {
        throw new Error('not used in this spec');
      },
      async verifyChallenge(): Promise<Result<never, OtpClientError>> {
        called = true;
        throw new Error('unreachable');
      },
      completeRegistration: () => {
        throw new Error('not used in this spec');
      },
    };
    const useCase = new VerifyOtpUseCase(client);

    const result = await useCase.execute(
      'challenge_1' as OtpChallengeId,
      'abc',
    );

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.kind).toBe('invalid_code');
    }
    expect(called).toBe(false);
  });
});
