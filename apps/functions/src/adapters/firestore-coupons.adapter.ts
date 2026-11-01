import type { Firestore } from 'firebase-admin/firestore';
import { Result } from '@core/primitives';
import { CouponStatus } from '@core/components';
import { type Coupon, Collections, QueryOp } from '@core/entities';
import type { CouponLookupPorts } from '@core/ports';
import { readFailed } from './store-answer';

/**
 * The staff edit's out-of-transaction code lookup (blueprint §4.1, flip 1
 * §3.2): the ENABLED coupon a typed code names — `code ==`,
 * `couponStatus == 'ENABLED'`, `limit 1` (an equality merge, no composite
 * index). A code is a lookup; the grants a save may honour are read inside
 * its transaction. The document body IS the coupon minus `id` (Law 5):
 * `{ id, ...data }`, no mapping. A read that throws answers a
 * `RepositoryError` value.
 */

export const firestoreCouponPorts = (db: Firestore): CouponLookupPorts => ({
  findCouponByCode: async (code) => {
    try {
      const snap = await db
        .collection(Collections.Coupons)
        .where('code', QueryOp.Eq, code)
        .where('couponStatus', QueryOp.Eq, CouponStatus.Enabled)
        .limit(1)
        .get();
      const found = snap.docs[0];
      return Result.ok(
        found === undefined
          ? null
          : ({ id: found.id, ...found.data() } as Coupon),
      );
    } catch (error) {
      return Result.err(readFailed(Collections.Coupons, error));
    }
  },
});
