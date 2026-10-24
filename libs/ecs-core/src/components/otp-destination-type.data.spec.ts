import { describe, expect, it } from 'vitest';
import { OtpDestinationType } from './otp-destination-type.data';

describe('OtpDestinationType', () => {
  it('keeps the stored otps.destinationType strings, upper-snaked', () => {
    expect(Object.values(OtpDestinationType)).toEqual(['EMAIL', 'SMS']);
    expect(OtpDestinationType.Sms).toBe('SMS');
  });
});
