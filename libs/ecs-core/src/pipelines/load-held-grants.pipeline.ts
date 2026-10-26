import {
  CouponGrantId,
  type CouponId,
  type CustomerId,
  Result,
} from '@core/primitives';
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
 * ACTIVE grants (the port's query) and — in ONE batched get, only for the
 * ids that query did not answer — the grants the open visit's SAVED bill
 * names (`billGrantIds`, OR-13), then the clock, read after them. Offered
 * (`CouponGrantSystem.offered`): the record's grants still usable now, then
 * every bill grant WHATEVER its status, in `billGrantIds` order — the save
 * burned it (`USED`), and a burned grant must still show on its own visit's
 * card.
 * Nothing offered reads no coupon. Then their coupons in ONE read, each id
 * once in first-seen order, WHATEVER the coupon's status (`loadCoupons`),
 * joined by `CouponGrantSystem.held`: a held grant whose coupon was
 * disabled since keeps its name, value and exclusivity, and a grant whose
 * coupon is gone altogether is left out. An id the brand's door refuses
 * names nothing and is never read.
 */
export const loadHeldGrants =
  (ports: LoadHeldGrantsPorts) =>
  async (
    customerId: CustomerId,
    billGrantIds: readonly CouponGrantId[],
  ): Promise<Result<readonly HeldGrant[], RepositoryError>> => {
    const held = await ports.listUsableCouponGrants(customerId);
    if (!held.ok) return held;
    const billIds: CouponGrantId[] = [];
    const unread: CouponGrantId[] = [];
    for (const id of billGrantIds) {
      if (!CouponGrantId.is(id) || billIds.includes(id)) continue;
      billIds.push(id);
      if (!held.value.some((grant) => grant.id === id)) unread.push(id);
    }
    let billed: readonly CouponGrant[] = [];
    if (unread.length > 0) {
      const read = await ports.loadCouponGrants(unread);
      if (!read.ok) return read;
      billed = read.value;
    }
    const offered = CouponGrantSystem.offered(
      held.value,
      billed,
      billIds,
      ports.nowUtcMs(),
    );
    if (offered.length === 0) return Result.ok([]);
    const couponIds: CouponId[] = [];
    for (const grant of offered) {
      if (!couponIds.includes(grant.couponId)) couponIds.push(grant.couponId);
    }
    const coupons = await ports.loadCoupons(couponIds);
    if (!coupons.ok) return coupons;
    return Result.ok(CouponGrantSystem.held(offered, coupons.value));
  };
