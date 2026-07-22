import { DomainError } from '@creativo/domain/kernel';

export class CouponEmptyNameError extends DomainError {
  override readonly code = 'engagement.coupon.empty_name' as const;
  constructor() {
    super('Coupon name cannot be empty');
  }
}

export class CouponInvalidExpiryDaysError extends DomainError {
  override readonly code = 'engagement.coupon.invalid_expiry_days' as const;
  constructor(public readonly attempted: number) {
    super(`Coupon expiry days must be a positive integer, got ${attempted}`, {
      attempted,
    });
  }
}

export class CouponInvalidUsageLimitError extends DomainError {
  override readonly code = 'engagement.coupon.invalid_usage_limit' as const;
  constructor(public readonly attempted: number) {
    super(`Coupon usage limit must be a positive integer, got ${attempted}`, {
      attempted,
    });
  }
}
