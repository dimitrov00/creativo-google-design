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
import {
  type CouponGrantEntity,
  CouponGrantId as CouponGrantIdData,
  CouponGrantCapacity as CouponGrantCapacityData,
  CouponGrantSystem,
  CouponId as CouponIdData,
  type CouponValue as CouponValueData,
  type EngagementError as EngagementErrorData,
  EngagementErrorCode,
  type GrantStatus,
  UserId as UserIdData,
} from '@creativo/ecs-core';
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
    const capacity = CouponGrantCapacityData.multiUse(total);
    return capacity.ok
      ? ok(capacity.value)
      : fail(new CouponGrantInvalidCapacityError(total));
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

/*
 * THIN SHIM (ECS migration Phase 2). A grant's life — usable, burn (single-use
 * straight to `used`, multi-use counting down), expire, revoke, each refusing
 * a grant that is not active — is `CouponGrantSystem` over the ECS
 * `CouponGrantEntity`. This class keeps the legacy API its callers hold and
 * only converts: the system decides the next state, the legacy instants it
 * was stamped with ride back on it.
 */

/* ── Legacy ↔ ECS converters ─────────────────────────────────────────── */

function toValueData(value: CouponValue): CouponValueData {
  return value.kind === 'fixed_amount'
    ? {
        kind: 'fixed_amount',
        amount: {
          amountMinorUnits: value.amount.toMinorUnits(),
          currencyCode: value.amount.currencyCode(),
        },
      }
    : value;
}

function toStateData(state: CouponGrantState): GrantStatus {
  switch (state.kind) {
    case 'active':
      return {
        kind: 'active',
        capacity: state.capacity,
        expiration:
          state.expiration.kind === 'expires_at'
            ? { kind: 'expires_at', atMs: state.expiration.at.toMillis() }
            : { kind: 'no_expiry' },
      };
    case 'used':
      return {
        kind: 'used',
        usedAtMs: state.usedAt.toMillis(),
        note: state.note,
      };
    case 'expired':
      return {
        kind: 'expired',
        expiredAtMs: state.expiredAt.toMillis(),
        scheduledForMs: state.scheduledFor.toMillis(),
      };
    case 'revoked':
      return {
        kind: 'revoked',
        revokedAtMs: state.revokedAt.toMillis(),
        revokedBy: UserIdData.of(state.revokedBy.value),
        reason: state.reason,
      };
  }
}

function toEntity(grant: CouponGrant): CouponGrantEntity {
  return {
    id: CouponGrantIdData.of(grant.id.value),
    userId: UserIdData.of(grant.userId.value),
    couponId: CouponIdData.of(grant.couponId.value),
    value: toValueData(grant.value),
    grantedAtMs: grant.grantedAt.toMillis(),
    state: toStateData(grant.state),
  };
}

type CouponGrantTransitionError =
  | CouponGrantNotActiveError
  | CouponGrantNotExpiringError
  | CouponGrantEmptyReasonError;

/** A struct refusal → the legacy class it always was. */
function toLegacyError(error: EngagementErrorData): CouponGrantTransitionError {
  switch (error.code) {
    case EngagementErrorCode.CouponGrantNotActive:
      return new CouponGrantNotActiveError(error.currentState);
    case EngagementErrorCode.CouponGrantNotExpiring:
      return new CouponGrantNotExpiringError();
    default:
      return new CouponGrantEmptyReasonError();
  }
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
    return CouponGrantSystem.isActive(toEntity(this));
  }

  /** Active + (no expiry OR not past expiry). */
  isUsable(now: ZonedDateTime): boolean {
    return CouponGrantSystem.isUsable(toEntity(this), now.toMillis());
  }

  /** Apply one redemption — decrements multi-use capacity or transitions single-use straight to `used`. */
  markUsed(
    at: ZonedDateTime,
    note = '',
  ): Result<CouponGrant, CouponGrantNotActiveError> {
    const burnt = CouponGrantSystem.burn(toEntity(this), at.toMillis(), note);
    if (!burnt.ok) {
      return fail(toLegacyError(burnt.error) as CouponGrantNotActiveError);
    }
    const next = burnt.value.state;
    if (next.kind === 'active' && this.state.kind === 'active') {
      return ok(
        this.withState({
          kind: 'active',
          capacity: next.capacity,
          expiration: this.state.expiration,
        }),
      );
    }
    return ok(this.withState({ kind: 'used', usedAt: at, note }));
  }

  /** Mark a scheduled grant as expired — only legal on an `active` grant with `expires_at`. */
  expire(
    at: ZonedDateTime,
  ): Result<
    CouponGrant,
    CouponGrantNotActiveError | CouponGrantNotExpiringError
  > {
    const expired = CouponGrantSystem.expire(toEntity(this), at.toMillis());
    if (
      !expired.ok ||
      this.state.kind !== 'active' ||
      this.state.expiration.kind !== 'expires_at'
    ) {
      return fail(
        toLegacyError(
          expired.ok
            ? { code: EngagementErrorCode.CouponGrantNotExpiring }
            : expired.error,
        ) as CouponGrantNotActiveError | CouponGrantNotExpiringError,
      );
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
    const revoked = CouponGrantSystem.revoke(
      toEntity(this),
      at.toMillis(),
      UserIdData.of(revokedBy.value),
      reason,
    );
    if (!revoked.ok || revoked.value.state.kind !== 'revoked') {
      return fail(
        toLegacyError(
          revoked.ok
            ? { code: EngagementErrorCode.CouponGrantReasonEmpty }
            : revoked.error,
        ) as CouponGrantNotActiveError | CouponGrantEmptyReasonError,
      );
    }
    return ok(
      this.withState({
        kind: 'revoked',
        revokedAt: at,
        revokedBy,
        reason: revoked.value.state.reason,
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
