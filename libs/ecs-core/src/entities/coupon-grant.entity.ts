import type { CouponValue, GrantLifecycle } from '@core/components';
import type {
  CouponGrantId,
  CouponId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';

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
