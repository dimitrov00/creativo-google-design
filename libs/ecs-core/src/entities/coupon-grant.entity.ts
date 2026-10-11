import type { CouponValue } from '../components/coupon-value.data';
import type { GrantLifecycle } from '../components/grant-status.data';
import type {
  CouponGrantId,
  CouponId,
  UserId,
} from '../primitives/ids.primitive';
import type { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';

/*
 * F0 STAGING: `CouponGrantId` lives in `primitives/ids.primitive.ts` (§1.5);
 * the barrel still names this file for it until the integrator drops that
 * line.
 */

/** The grant's identity slice. */
export type CouponGrantMeta = {
  readonly id: CouponGrantId;
  /**
   * The account the grant belongs to — a uid until the appointment flip (1)
   * adds `customerId` and renames this access key `holderUserId` (D29, §5.4).
   */
  readonly userId: UserId;
  readonly couponId: CouponId;
  readonly grantedAtUtcMs: UtcEpochMs;
};

/**
 * `couponGrants/{id}` — a user's instance of a discount, granted from a
 * coupon. The flat intersection of its slices (Law 6): the identity slice,
 * the `CouponValue` snapshotted at granting (was the nested `value`) and the
 * `GrantLifecycle` variant (was the nested `state`).
 */
export type CouponGrant = CouponGrantMeta & CouponValue & GrantLifecycle;
