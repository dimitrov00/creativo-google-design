import { describe, expect, it } from 'vitest';
import { Money, Result, ZonedDateTime, ok } from '@creativo/domain/kernel';
import {
  Coupon,
  CouponCombinability,
  CouponGrant,
  CouponGrantCapacity,
  CouponGrantExpiration,
  CouponValue,
} from '@creativo/domain/engagement';
import { UserId } from '@creativo/domain/accounts';
import { RepositoryError } from '@creativo/application/shared';
import {
  CouponGrantRepository,
  CouponGrantWithCoupon,
} from '../ports/coupon-grant-repository.port';
import { ApplyDiscountsUseCase } from './apply-discounts.use-case';

function requiredValue<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

const NOW = requiredValue(
  ZonedDateTime.fromISO('2026-01-01T00:00:00.000Z', 'UTC'),
);
const USER_ID = requiredValue(UserId.create('user_1'));

function money(minorUnits: number): Money {
  return requiredValue(Money.fromMinorUnitsAndCode(minorUnits, 'EUR'));
}

function grantWithCoupon(
  id: string,
  couponName: string,
  value: CouponValue,
): CouponGrantWithCoupon {
  const coupon = requiredValue(
    Coupon.create({
      id: `coupon_${id}`,
      name: couponName,
      value,
      combinability: CouponCombinability.stackable(),
      expiry: { kind: 'never' },
      enabled: true,
    }),
  );
  const grant = requiredValue(
    CouponGrant.create({
      id,
      userId: USER_ID.value,
      couponId: `coupon_${id}`,
      value,
      grantedAt: NOW,
      capacity: CouponGrantCapacity.singleUse(),
      expiration: CouponGrantExpiration.none(),
    }),
  );
  return { grant, coupon };
}

function fakeRepository(
  grants: readonly CouponGrantWithCoupon[],
): CouponGrantRepository {
  return {
    async save(): Promise<Result<void, RepositoryError>> {
      return ok(undefined);
    },
    async findById(): Promise<Result<CouponGrant | null, RepositoryError>> {
      return ok(null);
    },
    async findUsableForUser(): Promise<
      Result<readonly CouponGrantWithCoupon[], RepositoryError>
    > {
      return ok(grants);
    },
  };
}

describe('ApplyDiscountsUseCase', () => {
  it('applies a fixed-amount grant against the cart subtotal', async () => {
    const grant = grantWithCoupon(
      'grant_1',
      '5 EUR off',
      requiredValue(CouponValue.fixedAmount(money(500))),
    );
    const useCase = new ApplyDiscountsUseCase(fakeRepository([grant]));

    const result = await useCase.execute({
      userId: USER_ID,
      subtotal: money(2000),
      now: NOW,
    });

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.lines).toHaveLength(1);
      expect(result.value.lines[0]?.label).toBe('5 EUR off');
      expect(result.value.total.toMinorUnits()).toBe(1500);
    }
  });

  it('respects the anti-abuse cap across multiple grants', async () => {
    const grants = [
      grantWithCoupon(
        'grant_1',
        '50% off',
        requiredValue(CouponValue.percentOff(50)),
      ),
      grantWithCoupon(
        'grant_2',
        '20% off',
        requiredValue(CouponValue.percentOff(20)),
      ),
    ];
    const useCase = new ApplyDiscountsUseCase(fakeRepository(grants));

    const result = await useCase.execute({
      userId: USER_ID,
      subtotal: money(10000),
      now: NOW,
      capPercent: 30,
    });

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.discountTotal.toMinorUnits()).toBeLessThanOrEqual(
        3000,
      );
    }
  });
});
