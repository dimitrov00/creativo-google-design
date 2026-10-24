import { type CouponId, type CustomerId, Result } from '@core/primitives';
import type { RepositoryError } from '@core/errors';
import type { CouponGrant } from '@core/entities';
import type {
  ClockPorts,
  CouponCatalogPorts,
  CouponGrantPorts,
} from '@core/ports';
import { CouponGrantSystem, type HeldGrant } from '@core/systems';

/** The record's grants, the coupons they were issued from, and the clock. */
export type LoadHeldGrantsPorts = CouponGrantPorts &
  CouponCatalogPorts &
  ClockPorts;

/**
 * THE CLIENT'S PROMISES, as the visit sheet's «Отстъпка» menu offers them
 * (moved from `staff-day.store.ts` `loadGrants`, Law 8.4): the record's
 * ACTIVE grants (the port's query), then — the clock read after them — the
 * ones still usable now (`CouponGrantSystem.isUsable`, so an expired one
 * never reaches the menu); none usable reads no coupon. Then their coupons
 * in ONE read, each id once in first-seen order, WHATEVER the coupon's
 * status (`loadCoupons`), joined by `CouponGrantSystem.held`: a held grant
 * whose coupon was disabled since keeps its name, value and exclusivity,
 * and a grant whose coupon is gone altogether is left out.
 */
export const loadHeldGrants =
  (ports: LoadHeldGrantsPorts) =>
  async (
    customerId: CustomerId,
  ): Promise<Result<readonly HeldGrant[], RepositoryError>> => {
    const held = await ports.listUsableCouponGrants(customerId);
    if (!held.ok) return held;
    const nowUtcMs = ports.nowUtcMs();
    const usable: CouponGrant[] = [];
    for (const grant of held.value) {
      if (CouponGrantSystem.isUsable(grant, nowUtcMs)) usable.push(grant);
    }
    if (usable.length === 0) return Result.ok([]);
    const couponIds: CouponId[] = [];
    for (const grant of usable) {
      if (!couponIds.includes(grant.couponId)) couponIds.push(grant.couponId);
    }
    const coupons = await ports.loadCoupons(couponIds);
    if (!coupons.ok) return coupons;
    return Result.ok(CouponGrantSystem.held(usable, coupons.value));
  };
