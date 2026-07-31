import { DomainError } from '@creativo/domain/kernel';

export class InvalidBookingPolicyError extends DomainError {
  override readonly code = 'scheduling.booking_policy.invalid' as const;
  constructor(
    public readonly field: string,
    public readonly rawValue: number,
  ) {
    super(`Booking policy "${field}" is invalid: ${rawValue}`, {
      field,
      rawValue,
    });
  }
}
