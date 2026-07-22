import { EmptyReferralCodeError } from '@creativo/domain/models';
import { AuthTokenError } from '@creativo/application/identity';
import { describe, expect, it } from 'vitest';
import {
  IncorrectCodeError,
  InvalidInputError,
  OtpAlreadyConsumedError,
  OtpExpiredError,
  OtpLockedOutError,
  OtpNotFoundError,
  TokenMintingFailure,
  UserValidationFailure,
} from '../../use-cases/verify-otp.errors';
import { toHttpsError } from './verify-otp';

describe('verify-otp toHttpsError', () => {
  it('maps InvalidInputError to invalid-argument and forwards code/params', () => {
    const httpsError = toHttpsError(new InvalidInputError('bad'));
    expect(httpsError.code).toBe('invalid-argument');
    expect(httpsError.details).toEqual({
      code: 'invalid_input',
      params: { reason: 'bad' },
    });
  });

  it('maps OtpNotFoundError to not-found', () => {
    expect(toHttpsError(new OtpNotFoundError()).code).toBe('not-found');
  });

  it('maps OtpAlreadyConsumedError to failed-precondition', () => {
    expect(toHttpsError(new OtpAlreadyConsumedError()).code).toBe(
      'failed-precondition',
    );
  });

  it('maps OtpExpiredError to deadline-exceeded', () => {
    expect(toHttpsError(new OtpExpiredError()).code).toBe('deadline-exceeded');
  });

  it('maps OtpLockedOutError to resource-exhausted', () => {
    expect(toHttpsError(new OtpLockedOutError()).code).toBe(
      'resource-exhausted',
    );
  });

  it('maps IncorrectCodeError to invalid-argument', () => {
    expect(toHttpsError(new IncorrectCodeError()).code).toBe(
      'invalid-argument',
    );
  });

  it('maps any other error to internal', () => {
    expect(
      toHttpsError(new TokenMintingFailure(new AuthTokenError('boom'))).code,
    ).toBe('internal');
  });

  it('maps UserValidationFailure to invalid-argument with aggregated error codes', () => {
    const httpsError = toHttpsError(
      new UserValidationFailure([new EmptyReferralCodeError()]),
    );
    expect(httpsError.code).toBe('invalid-argument');
    expect(httpsError.details).toEqual({
      errors: [{ code: 'referral_code_empty', params: {} }],
    });
  });
});
