import { describe, expect, it } from 'vitest';
import {
  PhoneError,
  PhoneErrorCode,
  PhoneInvalidReason,
} from './phone-errors.data';

describe('PhoneError', () => {
  it('builds the invalid struct with the raw text and the reason', () => {
    expect(PhoneError.invalid('123', PhoneInvalidReason.TooShort)).toEqual({
      code: 'phone.invalid',
      attempted: '123',
      reason: 'too-short',
    });
  });

  it('builds the unsupported-country struct with the raw text', () => {
    expect(PhoneError.countryUnsupported('XX')).toEqual({
      code: 'phone.country_unsupported',
      attempted: 'XX',
    });
  });

  it('is() narrows by code', () => {
    const error: PhoneError = PhoneError.invalid(
      'x',
      PhoneInvalidReason.Invalid,
    );
    expect(PhoneError.is(error, PhoneErrorCode.Invalid)).toBe(true);
    expect(PhoneError.is(error, PhoneErrorCode.CountryUnsupported)).toBe(false);
  });

  it('keeps the kernel reason strings, which map 1:1 onto errors.identity.phone.* keys', () => {
    expect(Object.values(PhoneInvalidReason)).toEqual([
      'not-a-number',
      'too-short',
      'too-long',
      'invalid-country',
      'invalid',
    ]);
    // The onboarding page words a reason as `identity.phone.${reason with _}`.
    const keys = Object.values(PhoneInvalidReason).map((r) =>
      r.replace(/-/g, '_'),
    );
    expect(keys).toEqual([
      'not_a_number',
      'too_short',
      'too_long',
      'invalid_country',
      'invalid',
    ]);
  });
});
