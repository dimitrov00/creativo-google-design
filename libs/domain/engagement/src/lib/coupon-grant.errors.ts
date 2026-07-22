import { DomainError } from '@creativo/domain/kernel';

export class CouponGrantInvalidCapacityError extends DomainError {
  override readonly code = 'engagement.coupon_grant.invalid_capacity' as const;
  constructor(public readonly attempted: number) {
    super(
      `Multi-use coupon grant capacity must be a positive integer, got ${attempted}`,
      { attempted },
    );
  }
}

export class CouponGrantNotActiveError extends DomainError {
  override readonly code = 'engagement.coupon_grant.not_active' as const;
  constructor(public readonly currentState: string) {
    super(
      `Cannot transition a coupon grant from state "${currentState}" — it is not active`,
      { currentState },
    );
  }
}

export class CouponGrantNotExpiringError extends DomainError {
  override readonly code = 'engagement.coupon_grant.not_expiring' as const;
  constructor() {
    super(
      'Cannot expire a coupon grant that has no scheduled expiration — use revoke() instead',
    );
  }
}

export class CouponGrantEmptyReasonError extends DomainError {
  override readonly code = 'engagement.coupon_grant.empty_reason' as const;
  constructor() {
    super('A coupon grant revocation reason cannot be empty');
  }
}
