import type { UserId } from '../primitives/ids.primitive';
import type { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';
import { EngagementError } from './engagement-errors.data';
import { Result } from './result.data';

/**
 * A grant's lifecycle state — the field `grantStatus`, the ONLY source of
 * these strings. The stored legacy values are the lower-case
 * `couponGrants.state.kind` tags (the rules key is `state`,
 * `firestore.rules:198`, until the engagement flip).
 */
export const GrantStatus = {
  Active: 'ACTIVE',
  Used: 'USED',
  Expired: 'EXPIRED',
  Revoked: 'REVOKED',
} as const;
export type GrantStatus = (typeof GrantStatus)[keyof typeof GrantStatus];

/** How many redemptions an active grant holds — the field `grantCapacity`. */
export const GrantCapacity = {
  SingleUse: 'SINGLE_USE',
  MultiUse: 'MULTI_USE',
} as const;
export type GrantCapacity = (typeof GrantCapacity)[keyof typeof GrantCapacity];

/** Whether an active grant runs out at an instant — the field `grantExpiry`. */
export const GrantExpiry = {
  NoExpiry: 'NO_EXPIRY',
  ExpiresAt: 'EXPIRES_AT',
} as const;
export type GrantExpiry = (typeof GrantExpiry)[keyof typeof GrantExpiry];

/**
 * A single-use grant, or a multi-use one counting down from `usesGranted`
 * (`usesRemaining` left) — a flat variant slice of an ACTIVE grant (was the
 * nested `capacity: { kind, remaining, totalGranted }`).
 */
export type GrantCapacityTerms =
  GrantCapacityTerms.SingleUse | GrantCapacityTerms.MultiUse;

const SINGLE_USE: GrantCapacityTerms.SingleUse = {
  grantCapacity: GrantCapacity.SingleUse,
};

export const GrantCapacityTerms = {
  singleUse(): GrantCapacityTerms.SingleUse {
    return SINGLE_USE;
  },

  /** The edge guard: a positive whole number of uses, all of them remaining. */
  multiUse(
    total: number,
  ): Result<
    GrantCapacityTerms.MultiUse,
    EngagementError.CouponGrantCapacityInvalid
  > {
    if (!Number.isInteger(total) || total <= 0) {
      return Result.err(EngagementError.couponGrantCapacityInvalid(total));
    }
    return Result.ok({
      grantCapacity: GrantCapacity.MultiUse,
      usesRemaining: total,
      usesGranted: total,
    });
  },

  /** The capacity slice of a value that carries one (an active grant), copied. */
  of(terms: GrantCapacityTerms): GrantCapacityTerms {
    return terms.grantCapacity === GrantCapacity.SingleUse
      ? SINGLE_USE
      : {
          grantCapacity: GrantCapacity.MultiUse,
          usesRemaining: terms.usesRemaining,
          usesGranted: terms.usesGranted,
        };
  },
} as const;

/**
 * No expiry, or an absolute instant after which an active grant is no longer
 * usable — a flat variant slice of an ACTIVE grant (was the nested
 * `expiration: { kind, atMs }`).
 */
export type GrantExpiryTerms =
  GrantExpiryTerms.NoExpiry | GrantExpiryTerms.ExpiresAt;

const NO_EXPIRY: GrantExpiryTerms.NoExpiry = {
  grantExpiry: GrantExpiry.NoExpiry,
};

export const GrantExpiryTerms = {
  none(): GrantExpiryTerms.NoExpiry {
    return NO_EXPIRY;
  },

  at(atUtcMs: UtcEpochMs): GrantExpiryTerms.ExpiresAt {
    return { grantExpiry: GrantExpiry.ExpiresAt, grantExpiresAtUtcMs: atUtcMs };
  },

  /** The expiry slice of a value that carries one (an active grant), copied. */
  of(terms: GrantExpiryTerms): GrantExpiryTerms {
    return terms.grantExpiry === GrantExpiry.NoExpiry
      ? NO_EXPIRY
      : GrantExpiryTerms.at(terms.grantExpiresAtUtcMs);
  },
} as const;

/**
 * The terms a grant was issued under — its capacity when fresh and its
 * expiry (the system I/O of `CouponGrantSystem.restore`, which brings a spent
 * grant back exactly as it was issued).
 */
export type GrantTerms = GrantCapacityTerms & GrantExpiryTerms;

/**
 * A grant, where it stands — a flat variant slice of the `CouponGrant`
 * archetype, discriminated by `grantStatus` (was the nested `state`), every
 * variant-only field prefixed by its variant. An ACTIVE grant also carries
 * its {@link GrantTerms} at the root.
 *
 * Lifecycle (the transitions live in CouponGrantSystem — `isUsable`,
 * `burn`, `restore`, `expire`, `revoke`):
 *   `ACTIVE` ─ burn    → `ACTIVE` (multi-use, one fewer) OR `USED`
 *   `ACTIVE` ─ expire  → `EXPIRED` (only with an `EXPIRES_AT` expiry)
 *   `ACTIVE` ─ revoke  → `REVOKED`
 */
export type GrantLifecycle =
  | GrantLifecycle.Active
  | GrantLifecycle.Used
  | GrantLifecycle.Expired
  | GrantLifecycle.Revoked;

export const GrantLifecycle = {
  /** A fresh grant: what every grant starts in. */
  active(
    capacity: GrantCapacityTerms,
    expiry: GrantExpiryTerms,
  ): GrantLifecycle.Active {
    return {
      grantStatus: GrantStatus.Active,
      ...GrantCapacityTerms.of(capacity),
      ...GrantExpiryTerms.of(expiry),
    };
  },

  used(atUtcMs: UtcEpochMs, note: string): GrantLifecycle.Used {
    return {
      grantStatus: GrantStatus.Used,
      usedAtUtcMs: atUtcMs,
      usedNote: note,
    };
  },

  expired(
    atUtcMs: UtcEpochMs,
    scheduledAtUtcMs: UtcEpochMs,
  ): GrantLifecycle.Expired {
    return {
      grantStatus: GrantStatus.Expired,
      expiredAtUtcMs: atUtcMs,
      expiryScheduledAtUtcMs: scheduledAtUtcMs,
    };
  },

  revoked(
    atUtcMs: UtcEpochMs,
    by: UserId,
    reason: string,
  ): GrantLifecycle.Revoked {
    return {
      grantStatus: GrantStatus.Revoked,
      revokedAtUtcMs: atUtcMs,
      revokedByUserId: by,
      revocationReason: reason,
    };
  },

  isActive(lifecycle: GrantLifecycle): lifecycle is GrantLifecycle.Active {
    return lifecycle.grantStatus === GrantStatus.Active;
  },

  /** The lifecycle slice of a value that carries one (a whole grant), copied to exactly its variant's fields. */
  of(lifecycle: GrantLifecycle): GrantLifecycle {
    switch (lifecycle.grantStatus) {
      case GrantStatus.Active:
        return GrantLifecycle.active(lifecycle, lifecycle);
      case GrantStatus.Used:
        return GrantLifecycle.used(lifecycle.usedAtUtcMs, lifecycle.usedNote);
      case GrantStatus.Expired:
        return GrantLifecycle.expired(
          lifecycle.expiredAtUtcMs,
          lifecycle.expiryScheduledAtUtcMs,
        );
      default:
        return GrantLifecycle.revoked(
          lifecycle.revokedAtUtcMs,
          lifecycle.revokedByUserId,
          lifecycle.revocationReason,
        );
    }
  },
} as const;

export namespace GrantCapacityTerms {
  export type SingleUse = {
    readonly grantCapacity: typeof GrantCapacity.SingleUse;
  };
  export type MultiUse = {
    readonly grantCapacity: typeof GrantCapacity.MultiUse;
    /** Was `remaining`. */
    readonly usesRemaining: number;
    /** Was `totalGranted`. */
    readonly usesGranted: number;
  };
}

export namespace GrantExpiryTerms {
  export type NoExpiry = { readonly grantExpiry: typeof GrantExpiry.NoExpiry };
  export type ExpiresAt = {
    readonly grantExpiry: typeof GrantExpiry.ExpiresAt;
    readonly grantExpiresAtUtcMs: UtcEpochMs;
  };
}

export namespace GrantLifecycle {
  export type Active = {
    readonly grantStatus: typeof GrantStatus.Active;
  } & GrantTerms;
  export type Used = {
    readonly grantStatus: typeof GrantStatus.Used;
    readonly usedAtUtcMs: UtcEpochMs;
    /**
     * Free-text redemption note («appointment abc123», «manual admin: …») —
     * the caller composes the meaning; the state only records that a
     * redemption happened and when. `''` when none was given.
     */
    readonly usedNote: string;
  };
  export type Expired = {
    readonly grantStatus: typeof GrantStatus.Expired;
    readonly expiredAtUtcMs: UtcEpochMs;
    /** The `EXPIRES_AT` instant the expiry job acted on (was `scheduledForMs`). */
    readonly expiryScheduledAtUtcMs: UtcEpochMs;
  };
  export type Revoked = {
    readonly grantStatus: typeof GrantStatus.Revoked;
    readonly revokedAtUtcMs: UtcEpochMs;
    readonly revokedByUserId: UserId;
    /** Trimmed, never blank. */
    readonly revocationReason: string;
  };
}
