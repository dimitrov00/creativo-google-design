import { Result } from '@creativo/domain/kernel';
import { OtpDestinationType } from '../otp';

export class OtpSendError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
  }
}

/**
 * Keeps the actual transactional email/SMS provider swappable, and — per
 * the product decision — isolated from any future marketing/campaign
 * sender (a real, stated user requirement: OTP and campaign sends must
 * never share a sending identity).
 */
export interface OtpSenderPort {
  send(
    destination: string,
    channel: OtpDestinationType,
    code: string,
  ): Promise<Result<void, OtpSendError>>;
}
