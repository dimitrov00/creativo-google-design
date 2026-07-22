import {
  Result,
  ZonedDateTime,
  combineAll,
  fail,
  ok,
} from '@creativo/domain/kernel';
import {
  UserId,
  EmptyIdError as AccountsEmptyIdError,
} from '@creativo/domain/accounts';
import { CouponValue } from './coupon-value';
import {
  CouponGrantEmptyReasonError,
  CouponGrantInvalidCapacityError,
  CouponGrantNotActiveError,
  CouponGrantNotExpiringError,
} from './coupon-grant.errors';
import { CouponGrantId, CouponId } from './ids';
import { EmptyIdError } from './ids.errors';

export type CouponGrantCapacity =
  CouponGrantCapacitySingleUse | CouponGrantCapacityMultiUse;

export interface CouponGrantCapacitySingleUse {
  readonly kind: 'single_use';
}
export interface CouponGrantCapacityMultiUse {
  readonly kind: 'multi_use';
  readonly remaining: number;
  readonly totalGranted: number;
}

export const CouponGrantCapacity = {
  singleUse(): CouponGrantCapacitySingleUse {
    return { kind: 'single_use' };
  },
  multiUse(
    total: number,
  ): Result<CouponGrantCapacityMultiUse, CouponGrantInvalidCapacityError> {
    if (!Number.isInteger(total) || total <= 0) {
      return fail(new CouponGrantInvalidCapacityError(total));
    }
    return ok({ kind: 'multi_use', remaining: total, totalGranted: total });
  },
} as const;

export type CouponGrantExpiration =
  CouponGrantExpirationNone | CouponGrantExpirationAt;

export interface CouponGrantExpirationNone {
  readonly kind: 'no_expiry';
}
export interface CouponGrantExpirationAt {
  readonly kind: 'expires_at';
  readonly at: ZonedDateTime;
}

export const CouponGrantExpiration = {
  none(): CouponGrantExpirationNone {
    return { kind: 'no_expiry' };
  },
  at(at: ZonedDateTime): CouponGrantExpirationAt {
    return { kind: 'expires_at', at };
  },
} as const;

export type CouponGrantState =
  | CouponGrantStateActive
  | CouponGrantStateUsed
  | CouponGrantStateExpired
  | CouponGrantStateRevoked;

export interface CouponGrantStateActive {
  readonly kind: 'active';
  readonly capacity: CouponGrantCapacity;
  readonly expiration: CouponGrantExpiration;
}
export interface CouponGrantStateUsed {
  readonly kind: 'used';
  readonly usedAt: ZonedDateTime;
  /** Free-text redemption note (e.g. "appointment abc123", "manual admin: <reason>") — the caller composes the meaning; this pure entity only tracks that a redemption happened and when. */
  readonly note: string;
}
export interface CouponGrantStateExpired {
  readonly kind: 'expired';
  readonly expiredAt: ZonedDateTime;
  readonly scheduledFor: ZonedDateTime;
}
export interface CouponGrantStateRevoked {
  readonly kind: 'revoked';
  readonly revokedAt: ZonedDateTime;
  readonly revokedBy: UserId;
  readonly reason: string;
}

export type CouponGrantError =
  EmptyIdError | AccountsEmptyIdError | CouponGrantInvalidCapacityError;

export interface CreateCouponGrantProps {
  id: string;
  userId: string;
  couponId: string;
  value: CouponValue;
  grantedAt: ZonedDateTime;
  capacity: CouponGrantCapacity;
  expiration: CouponGrantExpiration;
}

export interface ReconstituteCouponGrantProps {
  id: string;
  userId: string;
  couponId: string;
  value: CouponValue;
  grantedAt: ZonedDateTime;
  state: CouponGrantState;
}

/**
 * **Aggregate root.** A user's instance of a discount, granted from a
 * `Coupon` (ports v2's `CouponGrant.ts`). Lifecycle:
 *   `active` ─ markUsed → `active` (capacity decremented) OR `used`
 *   `active` ─ expire   → `expired` (only if `expiration.kind === 'expires_at'`)
 *   `active` ─ revoke   → `revoked`
 *
 * Deviation from v2: redemption channel (which appointment, which admin)
 * is not modeled as a cross-context reference here — this pure Phase-2
 * domain layer stays decoupled from `scheduling`; the orchestrating
 * Goal-03 use-case composes the two and passes a `note` describing the
 * channel.
 */
export class CouponGrant {
  private constructor(
    readonly id: CouponGrantId,
    readonly userId: UserId,
    readonly couponId: CouponId,
    readonly value: CouponValue,
    readonly grantedAt: ZonedDateTime,
    readonly state: CouponGrantState,
  ) {}

  static create(
    props: CreateCouponGrantProps,
  ): Result<CouponGrant, CouponGrantError[]> {
    return CouponGrant.build({
      id: props.id,
      userId: props.userId,
      couponId: props.couponId,
      value: props.value,
      grantedAt: props.grantedAt,
      state: {
        kind: 'active',
        capacity: props.capacity,
        expiration: props.expiration,
      },
    });
  }

  static reconstitute(
    props: ReconstituteCouponGrantProps,
  ): Result<CouponGrant, CouponGrantError[]> {
    return CouponGrant.build(props);
  }

  private static build(props: {
    id: string;
    userId: string;
    couponId: string;
    value: CouponValue;
    grantedAt: ZonedDateTime;
    state: CouponGrantState;
  }): Result<CouponGrant, CouponGrantError[]> {
    const idResult = CouponGrantId.create(props.id);
    const userIdResult = UserId.create(props.userId);
    const couponIdResult = CouponId.create(props.couponId);

    const combined = combineAll([
      idResult,
      userIdResult,
      couponIdResult,
    ] as const);
    if (combined.isFailure()) {
      return fail(combined.error);
    }
    const [id, userId, couponId] = combined.value;

    return ok(
      new CouponGrant(
        id,
        userId,
        couponId,
        props.value,
        props.grantedAt,
        props.state,
      ),
    );
  }

  isActive(): boolean {
    return this.state.kind === 'active';
  }

  /** Active + (no expiry OR not past expiry). */
  isUsable(now: ZonedDateTime): boolean {
    if (this.state.kind !== 'active') return false;
    const { expiration } = this.state;
    if (expiration.kind === 'expires_at' && now.isAfter(expiration.at)) {
      return false;
    }
    return true;
  }

  /** Apply one redemption — decrements multi-use capacity or transitions single-use straight to `used`. */
  markUsed(
    at: ZonedDateTime,
    note = '',
  ): Result<CouponGrant, CouponGrantNotActiveError> {
    if (this.state.kind !== 'active') {
      return fail(new CouponGrantNotActiveError(this.state.kind));
    }
    const { capacity } = this.state;
    if (capacity.kind === 'single_use') {
      return ok(this.withState({ kind: 'used', usedAt: at, note }));
    }
    const remaining = capacity.remaining - 1;
    if (remaining <= 0) {
      return ok(this.withState({ kind: 'used', usedAt: at, note }));
    }
    return ok(
      this.withState({
        kind: 'active',
        capacity: {
          kind: 'multi_use',
          remaining,
          totalGranted: capacity.totalGranted,
        },
        expiration: this.state.expiration,
      }),
    );
  }

  /** Mark a scheduled grant as expired — only legal on an `active` grant with `expires_at`. */
  expire(
    at: ZonedDateTime,
  ): Result<
    CouponGrant,
    CouponGrantNotActiveError | CouponGrantNotExpiringError
  > {
    if (this.state.kind !== 'active') {
      return fail(new CouponGrantNotActiveError(this.state.kind));
    }
    if (this.state.expiration.kind !== 'expires_at') {
      return fail(new CouponGrantNotExpiringError());
    }
    return ok(
      this.withState({
        kind: 'expired',
        expiredAt: at,
        scheduledFor: this.state.expiration.at,
      }),
    );
  }

  /** Admin revokes a previously-granted discount. */
  revoke(
    at: ZonedDateTime,
    revokedBy: UserId,
    reason: string,
  ): Result<
    CouponGrant,
    CouponGrantNotActiveError | CouponGrantEmptyReasonError
  > {
    if (this.state.kind !== 'active') {
      return fail(new CouponGrantNotActiveError(this.state.kind));
    }
    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      return fail(new CouponGrantEmptyReasonError());
    }
    return ok(
      this.withState({
        kind: 'revoked',
        revokedAt: at,
        revokedBy,
        reason: trimmed,
      }),
    );
  }

  private withState(state: CouponGrantState): CouponGrant {
    return new CouponGrant(
      this.id,
      this.userId,
      this.couponId,
      this.value,
      this.grantedAt,
      state,
    );
  }
}
