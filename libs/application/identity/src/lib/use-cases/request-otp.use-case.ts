import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  Identifier,
  IdentifierDefaultCountry,
  IdentifierInput,
  createIdentifier,
} from '@creativo/domain/identity';
import {
  OtpChallengeId,
  OtpClient,
  OtpClientError,
} from '../ports/otp-client.port';

export type RequestOtpError =
  | { readonly kind: 'invalid_identifier' }
  | { readonly kind: 'client_error'; readonly error: OtpClientError };

/** Validates the raw identifier input (the domain factory IS the validator, blueprint §5.1) before requesting a challenge. */
export class RequestOtpUseCase {
  constructor(private readonly otpClient: OtpClient) {}

  async execute(
    input: IdentifierInput,
    defaultCountry?: IdentifierDefaultCountry,
  ): Promise<Result<OtpChallengeId, RequestOtpError>> {
    const identifierResult = createIdentifier(input, defaultCountry);
    if (identifierResult.isFailure()) {
      return fail({ kind: 'invalid_identifier' });
    }
    return this.requestForIdentifier(identifierResult.value);
  }

  private async requestForIdentifier(
    identifier: Identifier,
  ): Promise<Result<OtpChallengeId, RequestOtpError>> {
    const result = await this.otpClient.requestChallenge(identifier);
    if (result.isFailure()) {
      return fail({ kind: 'client_error', error: result.error });
    }
    return ok(result.value);
  }
}
