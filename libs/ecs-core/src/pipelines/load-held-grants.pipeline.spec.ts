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
import { CouponGrantSystem } from '@core/systems';
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

/** `id` burned by the open visit's save — `USED`, no longer the record's ACTIVE grant. */
function spent(id: string, couponId: string): CouponGrant {
  return unwrapOk(
    CouponGrantSystem.burn(
      grant(id, couponId),
      utcMs('2026-10-20T09:00:00+03:00'),
      'appointment:appt-open',
    ),
  );
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
      )(RECORD, []),
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
      )(RECORD, []),
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
    )(RECORD, []);
    expect(asked).toEqual([['coupon-b', 'coupon-a']]);
    asked.length = 0;
    const none = await loadHeldGrants(
      record({
        grants: [grant('grant-lapsed', 'coupon-a', UtcEpochMs.plusMs(NOW, -1))],
        coupons: [coupon('coupon-a', 'А')],
      }),
    )(RECORD, []);
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
    })(RECORD, []);
    expect(order).toEqual(['grants', 'clock']);

    const failure = RepositoryError.readFailed('couponGrants', 'unavailable');
    expect(
      unwrapErr(
        await loadHeldGrants(
          ports(
            {},
            { listUsableCouponGrants: async () => Result.err(failure) },
          ),
        )(RECORD, []),
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
        )(RECORD, []),
      ),
    ).toEqual(couponFailure);
  });

  describe('the open visit’s saved bill (OR-13)', () => {
    it('offers each grant the bill names WHATEVER its status after the usable ones, in the bill’s order — a burned one still shows on its card', async () => {
      const loyal = coupon('coupon-loyal', 'Постоянен клиент');
      const autumn = coupon('coupon-autumn', 'Есен');
      const burnt = spent('grant-burnt', 'coupon-autumn');
      const lapsed = grant(
        'grant-lapsed',
        'coupon-loyal',
        UtcEpochMs.plusMs(NOW, -1),
      );
      const held = unwrapOk(
        await loadHeldGrants(
          ports({
            grants: [grant('grant-loyal', 'coupon-loyal'), lapsed, burnt],
            coupons: [loyal, autumn],
          }),
        )(RECORD, [
          CouponGrantId.of('grant-lapsed'),
          CouponGrantId.of('grant-burnt'),
          CouponGrantId.of('grant-loyal'),
          CouponGrantId.of('grant-burnt'),
        ]),
      );
      // The usable one first; then the bill's, once each — the expired one
      // (the record's query answered it) and the burned one (it did not).
      expect(held.map((row) => [row.grant.id, row.coupon.id])).toEqual([
        ['grant-loyal', 'coupon-loyal'],
        ['grant-lapsed', 'coupon-loyal'],
        ['grant-burnt', 'coupon-autumn'],
      ]);
      expect(held[2]?.grant).toBe(burnt);
    });

    it('asks only for the bill’s grants the record’s query did not answer, in ONE batched get — none for a bill without grants or ids that name nothing', async () => {
      const asked: (readonly CouponGrantId[])[] = [];
      const record = (
        state: Parameters<typeof ports>[0],
      ): LoadHeldGrantsPorts => {
        const base = ports(state);
        return {
          ...base,
          loadCouponGrants: async (ids) => {
            asked.push(ids);
            return base.loadCouponGrants(ids);
          },
        };
      };
      const state = {
        grants: [
          grant('grant-1', 'coupon-a'),
          spent('grant-2', 'coupon-a'),
          spent('grant-3', 'coupon-a'),
        ],
        coupons: [coupon('coupon-a', 'А')],
      };
      await loadHeldGrants(record(state))(RECORD, [
        CouponGrantId.of('grant-1'),
        CouponGrantId.of('grant-3'),
        CouponGrantId.of('grant-2'),
        CouponGrantId.of('a/b'),
      ]);
      expect(asked).toEqual([['grant-3', 'grant-2']]);
      asked.length = 0;
      await loadHeldGrants(record(state))(RECORD, [
        CouponGrantId.of('grant-1'),
      ]);
      await loadHeldGrants(record(state))(RECORD, []);
      expect(asked).toEqual([]);
    });

    it('reads the clock after both grant reads, and answers a failed bill read with its error — no coupon read', async () => {
      const order: string[] = [];
      const base = ports({
        grants: [spent('grant-1', 'coupon-a')],
        coupons: [coupon('coupon-a', 'А')],
      });
      await loadHeldGrants({
        ...base,
        listUsableCouponGrants: async (customerId) => {
          order.push('held');
          return base.listUsableCouponGrants(customerId);
        },
        loadCouponGrants: async (ids) => {
          order.push('bill');
          return base.loadCouponGrants(ids);
        },
        nowUtcMs: () => {
          order.push('clock');
          return NOW;
        },
        loadCoupons: async (ids) => {
          order.push('coupons');
          return base.loadCoupons(ids);
        },
      })(RECORD, [CouponGrantId.of('grant-1')]);
      expect(order).toEqual(['held', 'bill', 'clock', 'coupons']);

      const failure = RepositoryError.readFailed('couponGrants', 'unavailable');
      let couponsRead = false;
      expect(
        unwrapErr(
          await loadHeldGrants(
            ports(
              {},
              {
                loadCouponGrants: async () => Result.err(failure),
                loadCoupons: async () => {
                  couponsRead = true;
                  return Result.ok([]);
                },
              },
            ),
          )(RECORD, [CouponGrantId.of('grant-1')]),
        ),
      ).toEqual(failure);
      expect(couponsRead).toBe(false);
    });

    it('a bill grant that is gone is simply not offered — nothing offered reads no coupon', async () => {
      let couponsRead = false;
      const held = await loadHeldGrants(
        ports(
          {},
          {
            loadCoupons: async () => {
              couponsRead = true;
              return Result.ok([]);
            },
          },
        ),
      )(RECORD, [CouponGrantId.of('grant-gone')]);
      expect(unwrapOk(held)).toEqual([]);
      expect(couponsRead).toBe(false);
    });
  });
});
