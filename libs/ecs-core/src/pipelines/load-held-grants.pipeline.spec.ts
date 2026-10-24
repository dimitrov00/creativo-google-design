import { describe, expect, it } from 'vitest';
import {
  Combinability,
  CouponExpiryRule,
  CouponStatus,
  CouponValue,
  GrantCapacityTerms,
  GrantExpiryTerms,
  GrantLifecycle,
} from '@core/components';
import {
  CouponGrantId,
  CouponId,
  CustomerId,
  Result,
  UtcEpochMs,
} from '@core/primitives';
import { RepositoryError } from '@core/errors';
import type { Coupon, CouponGrant } from '@core/entities';
import {
  memoryCouponVoucherPorts,
  pinnedNowUtcMs,
  unwrapErr,
  unwrapOk,
  utcMs,
} from '@core/testing';
import {
  type LoadHeldGrantsPorts,
  loadHeldGrants,
} from './load-held-grants.pipeline';

/*
 * The «Отстъпка» menu's read, moved out of `staff-day.store.ts` `loadGrants`
 * (the store spec's coupon cases, `staff-dashboard.spec.ts:817-826` and the
 * "with their occasion" case, pin the same reads through the page).
 */

const NOW = utcMs('2026-10-24T09:00:00+03:00');
const RECORD = CustomerId.of('customer-georgi');

function coupon(
  id: string,
  name: string,
  couponStatus: CouponStatus = CouponStatus.Enabled,
): Coupon {
  return {
    id: CouponId.of(id),
    name,
    code: null,
    combinability: Combinability.Stackable,
    usageLimit: null,
    couponStatus,
    couponOccasion: null,
    ...unwrapOk(CouponValue.percentOff(10)),
    ...CouponExpiryRule.never(),
  };
}

function grant(
  id: string,
  couponId: string,
  expiresAtUtcMs: UtcEpochMs | null = null,
): CouponGrant {
  return {
    id: CouponGrantId.of(id),
    customerId: RECORD,
    holderUserId: null,
    couponId: CouponId.of(couponId),
    grantedAtUtcMs: utcMs('2026-08-01T09:00:00+03:00'),
    ...unwrapOk(CouponValue.percentOff(10)),
    ...GrantLifecycle.active(
      GrantCapacityTerms.singleUse(),
      expiresAtUtcMs === null
        ? GrantExpiryTerms.none()
        : GrantExpiryTerms.at(expiresAtUtcMs),
    ),
  };
}

function ports(
  state: {
    readonly grants?: readonly CouponGrant[];
    readonly coupons?: readonly Coupon[];
  },
  overrides: Partial<LoadHeldGrantsPorts> = {},
): LoadHeldGrantsPorts {
  return {
    ...memoryCouponVoucherPorts(state),
    nowUtcMs: pinnedNowUtcMs(NOW),
    ...overrides,
  };
}

describe('loadHeldGrants — the client record’s coupons for the visit sheet', () => {
  it('joins each usable grant to its coupon, whatever the coupon’s status, in the grants’ order', async () => {
    const disabled = coupon('coupon-old', 'Стара', CouponStatus.Disabled);
    const loyal = coupon('coupon-loyal', 'Постоянен клиент');
    const held = unwrapOk(
      await loadHeldGrants(
        ports({
          grants: [
            grant('grant-old', 'coupon-old'),
            grant('grant-loyal', 'coupon-loyal'),
          ],
          coupons: [loyal, disabled],
        }),
      )(RECORD),
    );
    expect(held.map((row) => [row.grant.id, row.coupon])).toEqual([
      ['grant-old', disabled],
      ['grant-loyal', loyal],
    ]);
  });

  it('leaves out a grant past its expiry — AT the instant it is still held — and one whose coupon is gone', async () => {
    const held = unwrapOk(
      await loadHeldGrants(
        ports({
          grants: [
            grant('grant-lapsed', 'coupon-a', UtcEpochMs.plusMs(NOW, -1)),
            grant('grant-at', 'coupon-a', NOW),
            grant('grant-gone', 'coupon-gone'),
          ],
          coupons: [coupon('coupon-a', 'А')],
        }),
      )(RECORD),
    );
    expect(held.map((row) => row.grant.id)).toEqual(['grant-at']);
  });

  it('reads each coupon once, in first-seen order — and no coupon at all when nothing is usable', async () => {
    const asked: (readonly CouponId[])[] = [];
    const record = (
      state: Parameters<typeof ports>[0],
    ): LoadHeldGrantsPorts => {
      const base = ports(state);
      return {
        ...base,
        loadCoupons: async (ids) => {
          asked.push(ids);
          return base.loadCoupons(ids);
        },
      };
    };
    await loadHeldGrants(
      record({
        grants: [
          grant('grant-1', 'coupon-b'),
          grant('grant-2', 'coupon-a'),
          grant('grant-3', 'coupon-b'),
        ],
        coupons: [coupon('coupon-a', 'А'), coupon('coupon-b', 'Б')],
      }),
    )(RECORD);
    expect(asked).toEqual([['coupon-b', 'coupon-a']]);
    asked.length = 0;
    const none = await loadHeldGrants(
      record({
        grants: [grant('grant-lapsed', 'coupon-a', UtcEpochMs.plusMs(NOW, -1))],
        coupons: [coupon('coupon-a', 'А')],
      }),
    )(RECORD);
    expect(unwrapOk(none)).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('reads the clock after the grants, and answers a failed read with its error', async () => {
    const order: string[] = [];
    const base = ports({ grants: [grant('grant-1', 'coupon-a')] });
    await loadHeldGrants({
      ...base,
      listUsableCouponGrants: async (customerId) => {
        order.push('grants');
        return base.listUsableCouponGrants(customerId);
      },
      nowUtcMs: () => {
        order.push('clock');
        return NOW;
      },
    })(RECORD);
    expect(order).toEqual(['grants', 'clock']);

    const failure = RepositoryError.readFailed('couponGrants', 'unavailable');
    expect(
      unwrapErr(
        await loadHeldGrants(
          ports(
            {},
            { listUsableCouponGrants: async () => Result.err(failure) },
          ),
        )(RECORD),
      ),
    ).toEqual(failure);
    const couponFailure = RepositoryError.readFailed('coupons', 'unavailable');
    expect(
      unwrapErr(
        await loadHeldGrants(
          ports(
            { grants: [grant('grant-1', 'coupon-a')] },
            { loadCoupons: async () => Result.err(couponFailure) },
          ),
        )(RECORD),
      ),
    ).toEqual(couponFailure);
  });
});
