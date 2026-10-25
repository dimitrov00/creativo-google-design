import { type UserId, type UtcEpochMs, GrantStatus } from '@core/primitives';
import { GrantCapacityTerms } from './grant-capacity-terms.data';
import { GrantExpiryTerms } from './grant-expiry-terms.data';

/**
 * A grant, where it stands — a flat variant slice of the `CouponGrant`
 * archetype, discriminated by `grantStatus` (was the nested `state`), every
 * variant-only field prefixed by its variant. An ACTIVE grant also carries
 * its {@link GrantLifecycle.Terms} at the root.
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

export namespace GrantLifecycle {
  /**
   * The terms a grant was issued under — its capacity when fresh and its
   * expiry (the system I/O of `CouponGrantSystem.restore`, which brings a
   * spent grant back exactly as it was issued; was `GrantTerms`).
   */
  export type Terms = GrantCapacityTerms & GrantExpiryTerms;
  export type Active = {
    readonly grantStatus: typeof GrantStatus.Active;
  } & Terms;
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
