import { describe, expect, it } from 'vitest';
import {
  OTP_DESTINATION_TYPES,
  OtpDestinationType,
  isOtpDestinationType,
} from './otp-destination-type.data';

describe('OtpDestinationType', () => {
  it('keeps the stored otps.destinationType strings, upper-snaked', () => {
    expect([...OTP_DESTINATION_TYPES]).toEqual(['EMAIL', 'SMS']);
    expect(OtpDestinationType.Sms).toBe('SMS');
  });

  it('isOtpDestinationType narrows known channels and rejects strangers', () => {
    expect(isOtpDestinationType('EMAIL')).toBe(true);
    expect(isOtpDestinationType('email')).toBe(false);
    expect(isOtpDestinationType('PHONE')).toBe(false);
    expect(isOtpDestinationType(undefined)).toBe(false);
  });
});
