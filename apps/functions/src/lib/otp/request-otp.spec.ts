import { describe, expect, it } from 'vitest';
import {
  InvalidInputError,
  OtpChannelMismatchError,
  RateLimitedError,
  SendFailure,
  ValidationFailure,
} from '../../use-cases/request-otp.errors';
import { EmptyDestinationError } from '@creativo/domain/models';
import { toHttpsError } from './request-otp';

describe('request-otp toHttpsError', () => {
  it('maps InvalidInputError to invalid-argument and forwards code/params', () => {
    const httpsError = toHttpsError(new InvalidInputError('bad'));
    expect(httpsError.code).toBe('invalid-argument');
    expect(httpsError.details).toEqual({
      code: 'invalid_input',
      params: { reason: 'bad' },
    });
  });

  it('maps OtpChannelMismatchError to failed-precondition with its stable code', () => {
    const httpsError = toHttpsError(
      new OtpChannelMismatchError('phone', 'email_otp'),
    );
    expect(httpsError.code).toBe('failed-precondition');
    expect(httpsError.details).toEqual({
      code: 'otp_channel_mismatch',
      params: { requested: 'phone', strategyKind: 'email_otp' },
    });
  });

  it('maps RateLimitedError to resource-exhausted', () => {
    expect(toHttpsError(new RateLimitedError()).code).toBe(
      'resource-exhausted',
    );
  });

  it('maps any other error to internal', () => {
    expect(toHttpsError(new SendFailure(new Error('boom'))).code).toBe(
      'internal',
    );
  });

  it('maps ValidationFailure to invalid-argument with aggregated error codes', () => {
    const httpsError = toHttpsError(
      new ValidationFailure([new EmptyDestinationError()]),
    );
    expect(httpsError.code).toBe('invalid-argument');
    expect(httpsError.details).toEqual({
      errors: [{ code: 'otp_destination_empty', params: {} }],
    });
  });
});
