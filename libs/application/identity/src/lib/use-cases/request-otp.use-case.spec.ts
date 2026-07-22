import { describe, expect, it } from 'vitest';
import { Result, ok } from '@creativo/domain/kernel';
import {
  OtpChallengeId,
  OtpClient,
  OtpClientError,
} from '../ports/otp-client.port';
import { RequestOtpUseCase } from './request-otp.use-case';

function fakeOtpClient(): OtpClient {
  return {
    async requestChallenge(): Promise<Result<OtpChallengeId, OtpClientError>> {
      return ok('challenge_1' as OtpChallengeId);
    },
    verifyChallenge: () => {
      throw new Error('not used in this spec');
    },
    completeRegistration: () => {
      throw new Error('not used in this spec');
    },
  };
}

describe('RequestOtpUseCase', () => {
  it('requests a challenge for a valid email identifier', async () => {
    const useCase = new RequestOtpUseCase(fakeOtpClient());

    const result = await useCase.execute({
      kind: 'email',
      value: 'client@example.com',
    });

    expect(result.isSuccess()).toBe(true);
  });

  it('rejects a malformed identifier without calling the client', async () => {
    let called = false;
    const client: OtpClient = {
      async requestChallenge() {
        called = true;
        return ok('challenge_1' as OtpChallengeId);
      },
      verifyChallenge: () => {
        throw new Error('not used in this spec');
      },
      completeRegistration: () => {
        throw new Error('not used in this spec');
      },
    };
    const useCase = new RequestOtpUseCase(client);

    const result = await useCase.execute({
      kind: 'email',
      value: 'not-an-email',
    });

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.kind).toBe('invalid_identifier');
    }
    expect(called).toBe(false);
  });
});
