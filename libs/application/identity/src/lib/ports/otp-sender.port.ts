import { Result } from '@creativo/domain/kernel';
import { OtpDestination } from './otp-destination';
import { RawOtpCode } from './otp-code';

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
 * never share a sending identity). The channel lives on `destination`
 * itself (its discriminant), so there is no separate primitive channel
 * parameter to fall out of sync with it.
 */
export interface OtpSenderPort {
  send(
    destination: OtpDestination,
    code: RawOtpCode,
  ): Promise<Result<void, OtpSendError>>;
}
