import type { UserId } from '../entities/user.entity';
import { EngagementError } from './engagement-errors.data';
import { Result } from './result.data';

/** A grant's lifecycle state — the stored `couponGrants.state.kind` tags, unchanged. */
export const GrantState = {
  Active: 'active',
  Used: 'used',
  Expired: 'expired',
  Revoked: 'revoked',
} as const;
export type GrantState = (typeof GrantState)[keyof typeof GrantState];

/** How many redemptions a grant holds, by kind. */
export const GrantCapacityKind = {
  SingleUse: 'single_use',
  MultiUse: 'multi_use',
} as const;
export type GrantCapacityKind =
  (typeof GrantCapacityKind)[keyof typeof GrantCapacityKind];

/** Whether a grant runs out on a date, by kind. */
export const GrantExpirationKind = {
  NoExpiry: 'no_expiry',
  ExpiresAt: 'expires_at',
} as const;
export type GrantExpirationKind =
  (typeof GrantExpirationKind)[keyof typeof GrantExpirationKind];

/** A single-use grant, or a multi-use one counting down from `totalGranted`. */
export type CouponGrantCapacity =
  CouponGrantCapacity.SingleUse | CouponGrantCapacity.MultiUse;

export const CouponGrantCapacity = {
  singleUse(): CouponGrantCapacity.SingleUse {
    return { kind: GrantCapacityKind.SingleUse };
  },

  /** The edge guard: a positive whole number of uses, all of them remaining. */
  multiUse(
    total: number,
  ): Result<
    CouponGrantCapacity.MultiUse,
    EngagementError.CouponGrantCapacityInvalid
  > {
    if (!Number.isInteger(total) || total <= 0) {
      return Result.err(EngagementError.couponGrantCapacityInvalid(total));
    }
    return Result.ok({
      kind: GrantCapacityKind.MultiUse,
      remaining: total,
      totalGranted: total,
    });
  },
} as const;

/** No expiry, or an absolute instant after which the grant is no longer usable. */
export type CouponGrantExpiration =
  CouponGrantExpiration.NoExpiry | CouponGrantExpiration.ExpiresAt;

export const CouponGrantExpiration = {
  none(): CouponGrantExpiration.NoExpiry {
    return { kind: GrantExpirationKind.NoExpiry };
  },

  at(atMs: number): CouponGrantExpiration.ExpiresAt {
    return { kind: GrantExpirationKind.ExpiresAt, atMs };
  },
} as const;

/**
 * A user's grant, where it stands — the stored `couponGrants.state`
 * (`coupon-grant-repository.adapter.ts:40-110`, the key is `state`,
 * `firestore.rules:198`), tags unchanged, `*AtIso` → `*AtMs`.
 *
 * Lifecycle (the transitions live in CouponGrantSystem — `isUsable`,
 * `burn`, `restore`, `expire`, `revoke`):
 *   `active` ─ burn    → `active` (multi-use, one fewer) OR `used`
 *   `active` ─ expire  → `expired` (only with an `expires_at` expiration)
 *   `active` ─ revoke  → `revoked`
 */
export type GrantStatus =
  | GrantStatus.Active
  | GrantStatus.Used
  | GrantStatus.Expired
  | GrantStatus.Revoked;

export const GrantStatus = {
  /** A fresh grant: what `CouponGrant.create` starts every grant in. */
  active(
    capacity: CouponGrantCapacity,
    expiration: CouponGrantExpiration,
  ): GrantStatus.Active {
    return { kind: GrantState.Active, capacity, expiration };
  },

  isActive(status: GrantStatus): status is GrantStatus.Active {
    return status.kind === GrantState.Active;
  },
} as const;

export namespace CouponGrantCapacity {
  export type SingleUse = { readonly kind: typeof GrantCapacityKind.SingleUse };
  export type MultiUse = {
    readonly kind: typeof GrantCapacityKind.MultiUse;
    readonly remaining: number;
    readonly totalGranted: number;
  };
}

export namespace CouponGrantExpiration {
  export type NoExpiry = { readonly kind: typeof GrantExpirationKind.NoExpiry };
  export type ExpiresAt = {
    readonly kind: typeof GrantExpirationKind.ExpiresAt;
    readonly atMs: number;
  };
}

export namespace GrantStatus {
  export type Active = {
    readonly kind: typeof GrantState.Active;
    readonly capacity: CouponGrantCapacity;
    readonly expiration: CouponGrantExpiration;
  };
  export type Used = {
    readonly kind: typeof GrantState.Used;
    readonly usedAtMs: number;
    /**
     * Free-text redemption note («appointment abc123», «manual admin: …») —
     * the caller composes the meaning; the state only records that a
     * redemption happened and when. `''` when none was given.
     */
    readonly note: string;
  };
  export type Expired = {
    readonly kind: typeof GrantState.Expired;
    readonly expiredAtMs: number;
    /** The `expires_at` instant the expiry job acted on. */
    readonly scheduledForMs: number;
  };
  export type Revoked = {
    readonly kind: typeof GrantState.Revoked;
    readonly revokedAtMs: number;
    readonly revokedBy: UserId;
    /** Trimmed, never blank. */
    readonly reason: string;
  };
}
