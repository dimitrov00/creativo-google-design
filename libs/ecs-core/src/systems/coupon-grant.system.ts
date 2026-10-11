import type { CouponOccasion } from '../components/coupon-occasion.data';
import { CouponValue } from '../components/coupon-value.data';
import { EngagementError } from '../components/engagement-errors.data';
import {
  GrantCapacity,
  GrantCapacityTerms,
  GrantExpiry,
  GrantExpiryTerms,
  GrantLifecycle,
  GrantStatus,
  type GrantTerms,
} from '../components/grant-status.data';
import { Result } from '../components/result.data';
import { WriteOp } from '../components/write-op.data';
import type { CouponGrant } from '../entities/coupon-grant.entity';
import type { UserId } from '../primitives/ids.primitive';
import { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';
import { Collections } from '../ports/collections';

/** The grant with a new lifecycle variant — its meta and value untouched, the old variant's fields gone. */
function withLifecycle(
  grant: CouponGrant,
  lifecycle: GrantLifecycle,
): CouponGrant {
  return {
    id: grant.id,
    userId: grant.userId,
    couponId: grant.couponId,
    grantedAtUtcMs: grant.grantedAtUtcMs,
    ...CouponValue.of(grant),
    ...GrantLifecycle.of(lifecycle),
  };
}

/**
 * A user's coupon grant through its life (`coupon-grant.ts:134-299`):
 *
 *   `ACTIVE` ─ burn    → `ACTIVE` (multi-use, one fewer) OR `USED`
 *   `ACTIVE` ─ expire  → `EXPIRED` (only with an `EXPIRES_AT` expiry)
 *   `ACTIVE` ─ revoke  → `REVOKED`
 *   `USED` / `ACTIVE` ─ restore → the exact inverse of `burn`
 *
 * Every transition refuses a grant that is not `ACTIVE` (`NOT_ACTIVE`,
 * naming the state it found). `nowUtcMs`/`atUtcMs` are parameters; usability
 * against an expiry instant is a T2 lifecycle comparison (G-1).
 */
export const CouponGrantSystem = {
  isActive(grant: CouponGrant): boolean {
    return GrantLifecycle.isActive(grant);
  },

  /** Active, and not past its expiry — AT the instant is still usable. */
  isUsable(grant: CouponGrant, nowUtcMs: UtcEpochMs): boolean {
    if (grant.grantStatus !== GrantStatus.Active) return false;
    return !(
      grant.grantExpiry === GrantExpiry.ExpiresAt &&
      UtcEpochMs.compare(nowUtcMs, grant.grantExpiresAtUtcMs) > 0
    );
  },

  /**
   * One redemption (`markUsed`): a single-use grant goes straight to
   * `USED`; a multi-use one counts down, and is `USED` at zero. `note` is
   * the caller's account of the channel («appointment abc123»), `''` when
   * none was given.
   */
  burn(
    grant: CouponGrant,
    atUtcMs: UtcEpochMs,
    note: string,
  ): Result<CouponGrant, EngagementError.CouponGrantNotActive> {
    if (grant.grantStatus !== GrantStatus.Active) {
      return Result.err(
        EngagementError.couponGrantNotActive(grant.grantStatus),
      );
    }
    if (grant.grantCapacity === GrantCapacity.SingleUse) {
      return Result.ok(
        withLifecycle(grant, GrantLifecycle.used(atUtcMs, note)),
      );
    }
    const remaining = grant.usesRemaining - 1;
    if (remaining <= 0) {
      return Result.ok(
        withLifecycle(grant, GrantLifecycle.used(atUtcMs, note)),
      );
    }
    return Result.ok(
      withLifecycle(
        grant,
        GrantLifecycle.active(
          {
            grantCapacity: GrantCapacity.MultiUse,
            usesRemaining: remaining,
            usesGranted: grant.usesGranted,
          },
          grant,
        ),
      ),
    );
  },

  /**
   * The exact inverse of {@link burn} — a grant discount a save removed, or
   * a cancel released, goes back to the client: a `USED` grant returns to
   * `ACTIVE` with one use (single-use, or a multi-use with one of its
   * `issued` total), a multi-use `ACTIVE` one gains a use back. Refused for
   * an expired or revoked grant (`NOT_ACTIVE`), and for a grant with no use
   * spent to give back (`INVALID_CAPACITY`, naming the count it would reach).
   */
  restore(
    grant: CouponGrant,
    issued: GrantTerms,
  ): Result<
    CouponGrant,
    | EngagementError.CouponGrantNotActive
    | EngagementError.CouponGrantCapacityInvalid
  > {
    if (grant.grantStatus === GrantStatus.Used) {
      const capacity: GrantCapacityTerms =
        issued.grantCapacity === GrantCapacity.SingleUse
          ? GrantCapacityTerms.singleUse()
          : {
              grantCapacity: GrantCapacity.MultiUse,
              usesRemaining: 1,
              usesGranted: issued.usesGranted,
            };
      return Result.ok(
        withLifecycle(grant, GrantLifecycle.active(capacity, issued)),
      );
    }
    if (grant.grantStatus !== GrantStatus.Active) {
      return Result.err(
        EngagementError.couponGrantNotActive(grant.grantStatus),
      );
    }
    if (
      grant.grantCapacity === GrantCapacity.SingleUse ||
      grant.usesRemaining >= grant.usesGranted
    ) {
      return Result.err(
        EngagementError.couponGrantCapacityInvalid(
          grant.grantCapacity === GrantCapacity.SingleUse
            ? 2
            : grant.usesRemaining + 1,
        ),
      );
    }
    return Result.ok(
      withLifecycle(
        grant,
        GrantLifecycle.active(
          {
            grantCapacity: GrantCapacity.MultiUse,
            usesRemaining: grant.usesRemaining + 1,
            usesGranted: grant.usesGranted,
          },
          grant,
        ),
      ),
    );
  },

  /** The expiry job's act — only an `ACTIVE` grant that HAS an `EXPIRES_AT`. */
  expire(
    grant: CouponGrant,
    atUtcMs: UtcEpochMs,
  ): Result<
    CouponGrant,
    | EngagementError.CouponGrantNotActive
    | EngagementError.CouponGrantNotExpiring
  > {
    if (grant.grantStatus !== GrantStatus.Active) {
      return Result.err(
        EngagementError.couponGrantNotActive(grant.grantStatus),
      );
    }
    if (grant.grantExpiry !== GrantExpiry.ExpiresAt) {
      return Result.err(EngagementError.couponGrantNotExpiring());
    }
    return Result.ok(
      withLifecycle(
        grant,
        GrantLifecycle.expired(atUtcMs, grant.grantExpiresAtUtcMs),
      ),
    );
  },

  /** An admin takes a grant back — a reason is required, stored trimmed. */
  revoke(
    grant: CouponGrant,
    atUtcMs: UtcEpochMs,
    revokedBy: UserId,
    reason: string,
  ): Result<
    CouponGrant,
    | EngagementError.CouponGrantNotActive
    | EngagementError.CouponGrantReasonEmpty
  > {
    if (grant.grantStatus !== GrantStatus.Active) {
      return Result.err(
        EngagementError.couponGrantNotActive(grant.grantStatus),
      );
    }
    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      return Result.err(EngagementError.couponGrantReasonEmpty());
    }
    return Result.ok(
      withLifecycle(grant, GrantLifecycle.revoked(atUtcMs, revokedBy, trimmed)),
    );
  },

  /** The terms an active grant holds — what {@link restore} needs back once it is spent. */
  termsOf(grant: GrantLifecycle.Active): GrantTerms {
    return {
      ...GrantCapacityTerms.of(grant),
      ...GrantExpiryTerms.of(grant),
    };
  },

  /**
   * The write plan of a grant moving from `before` to `after`: ONE update of
   * its root — every field of the new lifecycle variant set, every field of
   * the old one the new one does not declare deleted (§6).
   */
  transitionWrite(before: CouponGrant, after: CouponGrant): WriteOp {
    const from = GrantLifecycle.of(before);
    const to = GrantLifecycle.of(after);
    return WriteOp.transition(
      [Collections.CouponGrants, after.id],
      { ...to },
      WriteOp.variantFieldsToDelete(from, to),
    );
  },

  /**
   * Was the grant's coupon made for `occasion` (`isBirthdayGrant`)? Read off
   * the coupon's own tag — a name is never parsed (§4.6).
   */
  isOccasion(
    couponOccasion: CouponOccasion | null,
    occasion: CouponOccasion,
  ): boolean {
    return couponOccasion === occasion;
  },
} as const;
