import { DomainError } from '@creativo/domain/kernel';

export class OtpCodeInvalidError extends DomainError {
  readonly code = 'identity.otp_code.invalid' as const;
  constructor(public readonly attempted: string) {
    super(`"${attempted}" is not a valid 6-digit OTP code`, { attempted });
  }
}
