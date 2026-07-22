import {
  Money,
  Result,
  ZonedDateTime,
  ok,
  fail,
} from '@creativo/domain/kernel';
import {
  DiscountApplication,
  DiscountBreakdown,
  DiscountInput,
} from '@creativo/domain/engagement';
import { UserId } from '@creativo/domain/accounts';
import { CouponGrantRepository } from '../ports/coupon-grant-repository.port';
import {
  ApplyDiscountsError,
  ApplyDiscountsRepositoryFailure,
} from './apply-discounts.errors';

export interface ApplyDiscountsInput {
  readonly userId: UserId;
  readonly subtotal: Money;
  readonly now: ZonedDateTime;
  /** Max total discount as a share of the subtotal, 0-100 — validated via `DiscountApplication.capPercent` by the caller if user-supplied. */
  readonly capPercent?: number;
}

/**
 * Thin composition over the domain layer: loads a user's usable coupon
 * grants and hands them to `DiscountApplication.apply()`, which already
 * owns the deterministic ordering/cap logic (blueprint §7 ledger 7.4).
 * This use-case's only job is turning persisted grants into `DiscountInput`s.
 */
export class ApplyDiscountsUseCase {
  constructor(private readonly couponGrants: CouponGrantRepository) {}

  async execute(
    input: ApplyDiscountsInput,
  ): Promise<Result<DiscountBreakdown, ApplyDiscountsError>> {
    const grantsResult = await this.couponGrants.findUsableForUser(
      input.userId,
      input.now,
    );
    if (grantsResult.isFailure()) {
      return fail(new ApplyDiscountsRepositoryFailure(grantsResult.error));
    }

    const discounts: DiscountInput[] = grantsResult.value
      .filter(({ grant }) => grant.isUsable(input.now))
      .map(({ grant, coupon }) => ({
        id: grant.id.toString(),
        label: coupon.name,
        value: grant.value,
        grantedAt: grant.grantedAt,
      }));

    const breakdown = DiscountApplication.apply(input.subtotal, discounts, {
      capPercent: input.capPercent,
    });

    return ok(breakdown);
  }
}
