import { describe, expect, it } from 'vitest';
import {
  OTP_DESTINATION_TYPES,
  OtpDestinationType,
  isOtpDestinationType,
} from './otp-destination-type.data';

describe('OtpDestinationType', () => {
  it('keeps the stored otps.destinationType strings', () => {
    expect([...OTP_DESTINATION_TYPES]).toEqual(['email', 'sms']);
    expect(OtpDestinationType.Sms).toBe('sms');
  });

  it('isOtpDestinationType narrows known channels and rejects strangers', () => {
    expect(isOtpDestinationType('email')).toBe(true);
    expect(isOtpDestinationType('phone')).toBe(false);
    expect(isOtpDestinationType(undefined)).toBe(false);
  });
});
