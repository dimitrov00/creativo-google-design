import { InjectionToken } from '@angular/core';
import { Result, ZonedDateTime } from '@creativo/domain/kernel';
import {
  Coupon,
  CouponGrant,
  CouponGrantId,
} from '@creativo/domain/engagement';
import { UserId } from '@creativo/domain/accounts';
import { RepositoryError } from '@creativo/application/shared';

export interface CouponGrantWithCoupon {
  readonly grant: CouponGrant;
  readonly coupon: Coupon;
}

export interface CouponGrantRepository {
  save(grant: CouponGrant): Promise<Result<void, RepositoryError>>;
  findById(
    id: CouponGrantId,
  ): Promise<Result<CouponGrant | null, RepositoryError>>;
  /** Active, not-yet-expired grants for a user, paired with the coupon they were granted from (for display/label + expiry policy). */
  findUsableForUser(
    userId: UserId,
    now: ZonedDateTime,
  ): Promise<Result<readonly CouponGrantWithCoupon[], RepositoryError>>;
}

export const COUPON_GRANT_REPOSITORY =
  new InjectionToken<CouponGrantRepository>('CouponGrantRepository');
