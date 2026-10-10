import type { CouponOccasion } from '../components/coupon-occasion.data';
import { EngagementError } from '../components/engagement-errors.data';
import {
  type CouponGrantCapacity,
  type CouponGrantExpiration,
  GrantCapacityKind,
  GrantExpirationKind,
  GrantState,
  GrantStatus,
} from '../components/grant-status.data';
import { Result } from '../components/result.data';
import type { CouponGrantEntity } from '../entities/coupon-grant.entity';
import type { UserId } from '../entities/user.entity';

/**
 * The terms a grant was issued under — its capacity when fresh and its
 * expiration. A `used` grant no longer carries them (`GrantStatus.Used` is
 * `{ usedAtMs, note }`), so {@link CouponGrantSystem.restore} takes them to
 * bring a spent grant back exactly as it was issued.
 */
export type GrantTerms = {
  readonly capacity: CouponGrantCapacity;
  readonly expiration: CouponGrantExpiration;
};

function withState(
  grant: CouponGrantEntity,
  state: GrantStatus,
): CouponGrantEntity {
  return { ...grant, state };
}

function used(atMs: number, note: string): GrantStatus.Used {
  return { kind: GrantState.Used, usedAtMs: atMs, note };
}

/**
 * A user's coupon grant through its life (`coupon-grant.ts:134-299`):
 *
 *   `active` ─ burn    → `active` (multi-use, one fewer) OR `used`
 *   `active` ─ expire  → `expired` (only with an `expires_at` expiration)
 *   `active` ─ revoke  → `revoked`
 *   `used` / `active` ─ restore → the exact inverse of `burn`
 *
 * Every transition refuses a grant that is not `active` (`not_active`,
 * naming the state it found). `nowMs`/`atMs` are parameters.
 */
export const CouponGrantSystem = {
  isActive(grant: CouponGrantEntity): boolean {
    return GrantStatus.isActive(grant.state);
  },

  /** Active, and not past its expiry — AT the instant is still usable. */
  isUsable(grant: CouponGrantEntity, nowMs: number): boolean {
    const state = grant.state;
    if (state.kind !== GrantState.Active) return false;
    const expiration = state.expiration;
    return !(
      expiration.kind === GrantExpirationKind.ExpiresAt &&
      nowMs > expiration.atMs
    );
  },

  /**
   * One redemption (`markUsed`): a single-use grant goes straight to
   * `used`; a multi-use one counts down, and is `used` at zero. `note` is
   * the caller's account of the channel («appointment abc123»), `''` when
   * none was given.
   */
  burn(
    grant: CouponGrantEntity,
    atMs: number,
    note: string,
  ): Result<CouponGrantEntity, EngagementError.CouponGrantNotActive> {
    const state = grant.state;
    if (state.kind !== GrantState.Active) {
      return Result.err(EngagementError.couponGrantNotActive(state.kind));
    }
    const capacity = state.capacity;
    if (capacity.kind === GrantCapacityKind.SingleUse) {
      return Result.ok(withState(grant, used(atMs, note)));
    }
    const remaining = capacity.remaining - 1;
    if (remaining <= 0) return Result.ok(withState(grant, used(atMs, note)));
    return Result.ok(
      withState(grant, {
        kind: GrantState.Active,
        capacity: {
          kind: GrantCapacityKind.MultiUse,
          remaining,
          totalGranted: capacity.totalGranted,
        },
        expiration: state.expiration,
      }),
    );
  },

  /**
   * The exact inverse of {@link burn} — a grant discount a save removed, or
   * a cancel released, goes back to the client: a `used` grant returns to
   * `active` with one use (single-use, or a multi-use with one of its
   * `issued` total), a multi-use `active` one gains a use back. Refused for
   * an expired or revoked grant (`not_active`), and for a grant with no use
   * spent to give back (`invalid_capacity`, naming the count it would reach).
   */
  restore(
    grant: CouponGrantEntity,
    issued: GrantTerms,
  ): Result<
    CouponGrantEntity,
    | EngagementError.CouponGrantNotActive
    | EngagementError.CouponGrantCapacityInvalid
  > {
    const state = grant.state;
    if (state.kind === GrantState.Used) {
      const capacity: CouponGrantCapacity =
        issued.capacity.kind === GrantCapacityKind.SingleUse
          ? issued.capacity
          : {
              kind: GrantCapacityKind.MultiUse,
              remaining: 1,
              totalGranted: issued.capacity.totalGranted,
            };
      return Result.ok(
        withState(grant, GrantStatus.active(capacity, issued.expiration)),
      );
    }
    if (state.kind !== GrantState.Active) {
      return Result.err(EngagementError.couponGrantNotActive(state.kind));
    }
    const capacity = state.capacity;
    if (
      capacity.kind === GrantCapacityKind.SingleUse ||
      capacity.remaining >= capacity.totalGranted
    ) {
      return Result.err(
        EngagementError.couponGrantCapacityInvalid(
          capacity.kind === GrantCapacityKind.SingleUse
            ? 2
            : capacity.remaining + 1,
        ),
      );
    }
    return Result.ok(
      withState(grant, {
        kind: GrantState.Active,
        capacity: {
          kind: GrantCapacityKind.MultiUse,
          remaining: capacity.remaining + 1,
          totalGranted: capacity.totalGranted,
        },
        expiration: state.expiration,
      }),
    );
  },

  /** The expiry job's act — only an `active` grant that HAS an `expires_at`. */
  expire(
    grant: CouponGrantEntity,
    atMs: number,
  ): Result<
    CouponGrantEntity,
    | EngagementError.CouponGrantNotActive
    | EngagementError.CouponGrantNotExpiring
  > {
    const state = grant.state;
    if (state.kind !== GrantState.Active) {
      return Result.err(EngagementError.couponGrantNotActive(state.kind));
    }
    const expiration = state.expiration;
    if (expiration.kind !== GrantExpirationKind.ExpiresAt) {
      return Result.err(EngagementError.couponGrantNotExpiring());
    }
    return Result.ok(
      withState(grant, {
        kind: GrantState.Expired,
        expiredAtMs: atMs,
        scheduledForMs: expiration.atMs,
      }),
    );
  },

  /** An admin takes a grant back — a reason is required, stored trimmed. */
  revoke(
    grant: CouponGrantEntity,
    atMs: number,
    revokedBy: UserId,
    reason: string,
  ): Result<
    CouponGrantEntity,
    | EngagementError.CouponGrantNotActive
    | EngagementError.CouponGrantReasonEmpty
  > {
    const state = grant.state;
    if (state.kind !== GrantState.Active) {
      return Result.err(EngagementError.couponGrantNotActive(state.kind));
    }
    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      return Result.err(EngagementError.couponGrantReasonEmpty());
    }
    return Result.ok(
      withState(grant, {
        kind: GrantState.Revoked,
        revokedAtMs: atMs,
        revokedBy,
        reason: trimmed,
      }),
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
