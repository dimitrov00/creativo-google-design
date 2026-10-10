import { describe, expect, it } from 'vitest';
import { OTP_PURPOSES, OtpPurpose, isOtpPurpose } from './otp-purpose.data';

describe('OtpPurpose', () => {
  it('keeps the stored strings of models/otp.ts', () => {
    expect([...OTP_PURPOSES]).toEqual(['login', 'signup']);
    expect(OtpPurpose.Login).toBe('login');
  });

  it('isOtpPurpose narrows known purposes and rejects strangers', () => {
    expect(isOtpPurpose('signup')).toBe(true);
    expect(isOtpPurpose('reset')).toBe(false);
    expect(isOtpPurpose(null)).toBe(false);
  });
});
