import { describe, expect, it } from 'vitest';
import { OTP_PURPOSES, OtpPurpose, isOtpPurpose } from './otp-purpose.data';

describe('OtpPurpose', () => {
  it('keeps the stored strings of models/otp.ts, upper-snaked', () => {
    expect([...OTP_PURPOSES]).toEqual(['LOGIN', 'SIGNUP']);
    expect(OtpPurpose.Login).toBe('LOGIN');
  });

  it('isOtpPurpose narrows known purposes and rejects strangers', () => {
    expect(isOtpPurpose('SIGNUP')).toBe(true);
    expect(isOtpPurpose('signup')).toBe(false);
    expect(isOtpPurpose('RESET')).toBe(false);
    expect(isOtpPurpose(null)).toBe(false);
  });
});
