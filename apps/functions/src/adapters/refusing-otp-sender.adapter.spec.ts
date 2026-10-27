import { E164, Email, ParsedIdentifier } from '@core/components';
import { IdentityErrorCode } from '@core/errors';
import type { OtpDeliveryPorts } from '@core/ports';
import { refusingOtpSender } from './refusing-otp-sender.adapter';

describe('refusing-otp-sender adapter (the deployed login-OTP sender until a provider lands)', () => {
  it('is the OtpDeliveryPorts bundle', () => {
    const ports: OtpDeliveryPorts = refusingOtpSender();
    expect(Object.keys(ports)).toEqual(['sendOtp']);
    expect(typeof ports.sendOtp).toBe('function');
  });

  it.each([
    ['an SMS', ParsedIdentifier.phone(E164.of('+359888123456'))],
    ['an e-mail', ParsedIdentifier.email(Email.of('ana@example.com'))],
  ])(
    'refuses %s with IDENTITY_OTP_SEND_UNAVAILABLE — never a delivered code',
    async (_channel, destination) => {
      await expect(
        refusingOtpSender().sendOtp(destination, '042917'),
      ).resolves.toEqual({
        ok: false,
        error: { errorCode: IdentityErrorCode.OtpSendUnavailable },
      });
    },
  );

  it('takes no log, so neither the destination nor the code can reach one', () => {
    expect(refusingOtpSender.length).toBe(0);
  });
});
