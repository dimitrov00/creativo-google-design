import { DomainError } from '@creativo/domain/kernel';

export class InvalidCouponPercentageError extends DomainError {
  override readonly code =
    'engagement.coupon_value.invalid_percentage' as const;
  constructor(public readonly attempted: number) {
    super(`${attempted} is not a valid percentage (must be 0-100 inclusive)`, {
      attempted,
    });
  }
}

export class NegativeCouponAmountError extends DomainError {
  override readonly code = 'engagement.coupon_value.negative_amount' as const;
  constructor() {
    super('A fixed-amount coupon value must be a positive Money amount');
  }
}
