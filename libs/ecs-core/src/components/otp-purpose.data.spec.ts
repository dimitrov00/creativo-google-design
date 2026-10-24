import { describe, expect, it } from 'vitest';
import { OtpPurpose } from './otp-purpose.data';

describe('OtpPurpose', () => {
  it('keeps the stored strings of models/otp.ts, upper-snaked', () => {
    expect(Object.values(OtpPurpose)).toEqual(['LOGIN', 'SIGNUP']);
    expect(OtpPurpose.Login).toBe('LOGIN');
  });
});
