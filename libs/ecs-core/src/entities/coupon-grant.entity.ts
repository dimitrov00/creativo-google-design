import type { CouponValue, GrantLifecycle } from '@core/components';
import type {
  CouponGrantId,
  CouponId,
  CustomerId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';

/** The grant's identity slice. */
export type CouponGrantMeta = {
  readonly id: CouponGrantId;
  /** The client record the grant rewards (D29, flatten-spec §5.4) — whom the shop rewards. */
  readonly customerId: CustomerId;
  /**
   * The account that may READ the grant — the rules key of `get`/`list`
   * (`resource.data.holderUserId == request.auth.uid`) and of a client's own
   * «мои отстъпки» list; written at the boundary from the record's
   * `Customer.userId`, never derived from `customerId`'s text. `null` for a
   * grant held by a record without an account (a walk-in).
   */
  readonly holderUserId: UserId | null;
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
