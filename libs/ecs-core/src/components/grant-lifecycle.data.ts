import { type UserId, type UtcEpochMs, GrantStatus } from '@core/primitives';
import { GrantCapacity, GrantCapacityTerms } from './grant-capacity-terms.data';
import { GrantExpiryTerms } from './grant-expiry-terms.data';

/**
 * A grant, where it stands — a flat variant slice of the `CouponGrant`
 * archetype, discriminated by `grantStatus` (was the nested `state`), every
 * variant-only field prefixed by its variant. An ACTIVE grant carries its
 * {@link GrantLifecycle.Terms} at the root, and a USED one KEEPS them (OR-13:
 * a multi-use one with `usesRemaining` 0), so a give-back restores the
 * grant from its own document.
 *
 * Lifecycle (the transitions live in CouponGrantSystem — `isUsable`,
 * `burn`, `restore`, and the bill's `settleBill` / `releasePlan`):
 *   `ACTIVE` ─ burn    → `ACTIVE` (multi-use, one fewer) OR `USED`
 *   `USED` / `ACTIVE` ─ restore → the exact inverse of `burn`
 * `EXPIRED` and `REVOKED` stay stored vocabulary: no writer moves a grant
 * there today (the expiry job and the admin revoke are not built).
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
      ...GrantCapacityTerms.sliceOf(capacity),
      ...GrantExpiryTerms.sliceOf(expiry),
    };
  },

  /**
   * Spent at `atUtcMs`, keeping the `terms` it was issued under — a
   * multi-use grant with no use remaining (`usesRemaining` 0, whatever the
   * terms handed in said), its expiry as it was.
   */
  used(
    terms: GrantLifecycle.Terms,
    atUtcMs: UtcEpochMs,
    note: string,
  ): GrantLifecycle.Used {
    return {
      grantStatus: GrantStatus.Used,
      ...(terms.grantCapacity === GrantCapacity.SingleUse
        ? GrantCapacityTerms.singleUse()
        : {
            grantCapacity: GrantCapacity.MultiUse,
            usesRemaining: 0,
            usesGranted: terms.usesGranted,
          }),
      ...GrantExpiryTerms.sliceOf(terms),
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
  sliceOf<T extends GrantLifecycle>(lifecycle: T): GrantLifecycle {
    switch (lifecycle.grantStatus) {
      case GrantStatus.Active:
        return GrantLifecycle.active(lifecycle, lifecycle);
      case GrantStatus.Used:
        return GrantLifecycle.used(
          lifecycle,
          lifecycle.usedAtUtcMs,
          lifecycle.usedNote,
        );
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
   * The terms a grant was issued under — its capacity (what is left of it)
   * and its expiry; an ACTIVE grant holds them and a USED one keeps them, so
   * `CouponGrantSystem.restore` brings a spent grant back from its own
   * document (was `GrantTerms`).
   */
  export type Terms = GrantCapacityTerms & GrantExpiryTerms;
  export type Active = {
    readonly grantStatus: typeof GrantStatus.Active;
  } & Terms;
  export type Used = {
    readonly grantStatus: typeof GrantStatus.Used;
    readonly usedAtUtcMs: UtcEpochMs;
    /**
     * Free-text redemption note (`appointment:<id>` from the bill's settle,
     * `seed`) — the caller composes the meaning; the state only records that
     * a redemption happened and when. `''` when none was given.
     */
    readonly usedNote: string;
  } & Terms;
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
