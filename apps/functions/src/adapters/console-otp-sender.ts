import {
  OtpCode,
  OtpDestination,
  OtpSendError,
  OtpSenderPort,
  otpDestinationValue,
} from '@creativo/application/identity';
import { Result, ok } from '@creativo/domain/kernel';

/**
 * Swap for a real transactional email/SMS provider (e.g. Postmark/Resend
 * for email, Twilio for SMS) sending from a dedicated identity — e.g.
 * `auth.creativo.com` — kept separate from any future campaign/marketing
 * sender, per the product decision. Logging only for this Foundation pass.
 */
export class ConsoleLogOtpSender implements OtpSenderPort {
  async send(
    destination: OtpDestination,
    code: OtpCode,
  ): Promise<Result<void, OtpSendError>> {
    console.log(
      `[otp] would send ${destination.kind} OTP to ${otpDestinationValue(destination)}: ${code}`,
    );
    return ok(undefined);
  }
}
