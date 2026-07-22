import { Result, fail, ok } from '@creativo/domain/kernel';
import { OtpCode, SessionKind } from '@creativo/domain/identity';
import {
  OtpChallengeId,
  OtpClient,
  OtpClientError,
} from '../ports/otp-client.port';

export type VerifyOtpError =
  | { readonly kind: 'invalid_code' }
  | { readonly kind: 'client_error'; readonly error: OtpClientError };

/** Validates the raw 6-digit code the user typed before spending the (single-use) verify attempt. */
export class VerifyOtpUseCase {
  constructor(private readonly otpClient: OtpClient) {}

  async execute(
    challengeId: OtpChallengeId,
    rawCode: string,
  ): Promise<Result<SessionKind, VerifyOtpError>> {
    const codeResult = OtpCode.create(rawCode);
    if (codeResult.isFailure()) {
      return fail({ kind: 'invalid_code' });
    }

    const result = await this.otpClient.verifyChallenge(
      challengeId,
      codeResult.value,
    );
    if (result.isFailure()) {
      return fail({ kind: 'client_error', error: result.error });
    }
    return ok(result.value);
  }
}
