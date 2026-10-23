import { describe, expect, it } from 'vitest';
import { PhoneError, PhoneErrorCode, PhoneInvalidReason } from './phone.error';

describe('PhoneError', () => {
  it('builds the invalid struct with the raw text and the reason', () => {
    expect(PhoneError.invalid('123', PhoneInvalidReason.TooShort)).toEqual({
      errorCode: 'PHONE_INVALID',
      attempted: '123',
      reason: 'too-short',
    });
  });

  it('builds the unsupported-country struct with the raw text', () => {
    expect(PhoneError.countryUnsupported('XX')).toEqual({
      errorCode: 'PHONE_COUNTRY_UNSUPPORTED',
      attempted: 'XX',
    });
  });

  it('is() narrows by errorCode', () => {
    const error: PhoneError = PhoneError.invalid(
      'x',
      PhoneInvalidReason.Invalid,
    );
    expect(PhoneError.is(error, PhoneErrorCode.Invalid)).toBe(true);
    expect(PhoneError.is(error, PhoneErrorCode.CountryUnsupported)).toBe(false);
  });

  it('keeps the legacy kernel reason strings, which key errors.PHONE_INVALID.<reason> 1:1 — the value itself, nothing mapped', () => {
    expect(Object.values(PhoneInvalidReason)).toEqual([
      'not-a-number',
      'too-short',
      'too-long',
      'invalid-country',
      'invalid',
    ]);
    // The onboarding page words a reason as `PHONE_INVALID.${reason}`: the
    // struct keeps its own code and the reason segment is the value as is.
    const keys = Object.values(PhoneInvalidReason).map(
      (reason) => `${PhoneErrorCode.Invalid}.${reason}`,
    );
    expect(keys).toEqual([
      'PHONE_INVALID.not-a-number',
      'PHONE_INVALID.too-short',
      'PHONE_INVALID.too-long',
      'PHONE_INVALID.invalid-country',
      'PHONE_INVALID.invalid',
    ]);
  });
});
