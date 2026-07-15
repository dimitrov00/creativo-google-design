import {
  OtpDestinationType,
  OtpSendError,
  OtpSenderPort,
} from '@creativo/domain/models';
import { Result, ok } from '@creativo/domain/kernel';

/**
 * Swap for a real transactional email/SMS provider (e.g. Postmark/Resend
 * for email, Twilio for SMS) sending from a dedicated identity — e.g.
 * `auth.creativo.com` — kept separate from any future campaign/marketing
 * sender, per the product decision. Logging only for this Foundation pass.
 */
export class ConsoleLogOtpSender implements OtpSenderPort {
  async send(
    destination: string,
    channel: OtpDestinationType,
    code: string,
  ): Promise<Result<void, OtpSendError>> {
    console.log(`[otp] would send ${channel} OTP to ${destination}: ${code}`);
    return ok(undefined);
  }
}
