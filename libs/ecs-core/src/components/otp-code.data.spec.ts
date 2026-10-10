import { describe, expect, it } from 'vitest';
import { IdentityErrorCode } from './identity-errors.data';
import { OtpCode } from './otp-code.data';

// The cases of libs/domain/identity/src/lib/otp-code.spec.ts, on the brand.
describe('OtpCode.parse', () => {
  it('accepts a 6-digit code', () => {
    expect(OtpCode.parse('123456')).toEqual({ ok: true, value: '123456' });
  });

  it('accepts a code with leading zeros', () => {
    expect(OtpCode.parse('000123')).toEqual({ ok: true, value: '000123' });
  });

  it('trims surrounding whitespace', () => {
    expect(OtpCode.parse('  654321  ')).toEqual({ ok: true, value: '654321' });
  });

  it('rejects a code that is not exactly 6 digits, with the raw text', () => {
    for (const raw of ['12345', '1234567', '12a456', '', '١٢٣٤٥٦']) {
      expect(OtpCode.parse(raw)).toEqual({
        ok: false,
        error: { code: IdentityErrorCode.OtpCodeInvalid, attempted: raw },
      });
    }
  });
});

describe('OtpCode.of / equals', () => {
  it('casts a trusted value and compares by value', () => {
    const a = OtpCode.of('123456');
    expect(a).toBe('123456');
    expect(OtpCode.equals(a, OtpCode.of('123456'))).toBe(true);
    expect(OtpCode.equals(a, OtpCode.of('654321'))).toBe(false);
  });
});
