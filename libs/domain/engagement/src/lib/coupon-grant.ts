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
  type CouponGrant as CouponGrantData,
  CouponGrantId as CouponGrantIdData,
  CouponGrantSystem,
  CouponId as CouponIdData,
  type CouponValue as CouponValueData,
  Currency,
  DiscountMethod,
  type EngagementError as EngagementErrorData,
  EngagementErrorCode,
  GrantCapacity,
  GrantCapacityTerms,
  GrantExpiry,
  GrantLifecycle,
  GrantStatus,
  PriceCents,
  UserId as UserIdData,
  UtcEpochMs,
  defect,
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
    const capacity = GrantCapacityTerms.multiUse(total);
    return capacity.ok
      ? ok({
          kind: 'multi_use',
          remaining: capacity.value.usesRemaining,
          totalGranted: capacity.value.usesGranted,
        })
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

/** The legacy lower-case value tag → the ecs-core `DiscountMethod` (flatten-spec §8.9). */
const LEGACY_DISCOUNT_METHOD = {
  percent_off: DiscountMethod.PercentOff,
  fixed_amount: DiscountMethod.FixedAmount,
  free_service: DiscountMethod.FreeService,
} as const satisfies Record<CouponValue['kind'], DiscountMethod>;

/** The legacy lower-case state tag → the ecs-core `GrantStatus`. */
const LEGACY_GRANT_STATUS = {
  active: GrantStatus.Active,
  used: GrantStatus.Used,
  expired: GrantStatus.Expired,
  revoked: GrantStatus.Revoked,
} as const satisfies Record<CouponGrantState['kind'], GrantStatus>;

/** The inverse: the ecs-core `GrantStatus` → the legacy state tag a refusal names. */
const GRANT_STATUS_LEGACY = {
  [GrantStatus.Active]: 'active',
  [GrantStatus.Used]: 'used',
  [GrantStatus.Expired]: 'expired',
  [GrantStatus.Revoked]: 'revoked',
} as const satisfies Record<GrantStatus, CouponGrantState['kind']>;

/** The legacy lower-case capacity tag → the ecs-core `GrantCapacity`. */
const LEGACY_GRANT_CAPACITY = {
  single_use: GrantCapacity.SingleUse,
  multi_use: GrantCapacity.MultiUse,
} as const satisfies Record<CouponGrantCapacity['kind'], GrantCapacity>;

/** The legacy lower-case expiry tag → the ecs-core `GrantExpiry`. */
const LEGACY_GRANT_EXPIRY = {
  no_expiry: GrantExpiry.NoExpiry,
  expires_at: GrantExpiry.ExpiresAt,
} as const satisfies Record<CouponGrantExpiration['kind'], GrantExpiry>;

function sure<T, E>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: E },
  what: string,
): T {
  // Unreachable: a legacy `Money` / `ZonedDateTime` already holds the rule.
  if (!result.ok) defect(`unreachable: ${what}`);
  return result.value;
}

function instantOf(at: ZonedDateTime): UtcEpochMs {
  return sure(UtcEpochMs.of(at.toMillis()), 'an instant');
}

/** The legacy value as the flat slice — converted as it stands, never re-validated. */
function toValueData(value: CouponValue): CouponValueData {
  switch (value.kind) {
    case 'percent_off':
      return {
        discountMethod: LEGACY_DISCOUNT_METHOD.percent_off,
        discountPercent: value.percent,
      };
    case 'fixed_amount':
      return {
        discountMethod: LEGACY_DISCOUNT_METHOD.fixed_amount,
        discountAmountCents: sure(
          PriceCents.of(value.amount.toMinorUnits()),
          'an amount',
        ),
        discountCurrency: sure(
          Currency.parse(value.amount.currencyCode()),
          'a currency',
        ),
      };
    case 'free_service':
      return { discountMethod: LEGACY_DISCOUNT_METHOD.free_service };
  }
}

function toCapacityData(capacity: CouponGrantCapacity): GrantCapacityTerms {
  return capacity.kind === 'multi_use'
    ? {
        grantCapacity: LEGACY_GRANT_CAPACITY.multi_use,
        usesRemaining: capacity.remaining,
        usesGranted: capacity.totalGranted,
      }
    : { grantCapacity: LEGACY_GRANT_CAPACITY.single_use };
}

function fromCapacityData(capacity: GrantCapacityTerms): CouponGrantCapacity {
  return capacity.grantCapacity === GrantCapacity.MultiUse
    ? {
        kind: 'multi_use',
        remaining: capacity.usesRemaining,
        totalGranted: capacity.usesGranted,
      }
    : { kind: 'single_use' };
}

function toLifecycleData(state: CouponGrantState): GrantLifecycle {
  switch (state.kind) {
    case 'active':
      return GrantLifecycle.active(
        toCapacityData(state.capacity),
        state.expiration.kind === 'expires_at'
          ? {
              grantExpiry: LEGACY_GRANT_EXPIRY.expires_at,
              grantExpiresAtUtcMs: instantOf(state.expiration.at),
            }
          : { grantExpiry: LEGACY_GRANT_EXPIRY.no_expiry },
      );
    case 'used':
      return {
        grantStatus: LEGACY_GRANT_STATUS.used,
        usedAtUtcMs: instantOf(state.usedAt),
        usedNote: state.note,
      };
    case 'expired':
      return {
        grantStatus: LEGACY_GRANT_STATUS.expired,
        expiredAtUtcMs: instantOf(state.expiredAt),
        expiryScheduledAtUtcMs: instantOf(state.scheduledFor),
      };
    case 'revoked':
      return {
        grantStatus: LEGACY_GRANT_STATUS.revoked,
        revokedAtUtcMs: instantOf(state.revokedAt),
        revokedByUserId: UserIdData.of(state.revokedBy.value),
        revocationReason: state.reason,
      };
  }
}

function toEntity(grant: CouponGrant): CouponGrantData {
  return {
    id: CouponGrantIdData.of(grant.id.value),
    userId: UserIdData.of(grant.userId.value),
    couponId: CouponIdData.of(grant.couponId.value),
    grantedAtUtcMs: instantOf(grant.grantedAt),
    ...toValueData(grant.value),
    ...toLifecycleData(grant.state),
  };
}

type CouponGrantTransitionError =
  | CouponGrantNotActiveError
  | CouponGrantNotExpiringError
  | CouponGrantEmptyReasonError;

/** A struct refusal → the legacy class it always was. */
function toLegacyError(error: EngagementErrorData): CouponGrantTransitionError {
  switch (error.errorCode) {
    case EngagementErrorCode.CouponGrantNotActive:
      return new CouponGrantNotActiveError(
        GRANT_STATUS_LEGACY[error.currentState],
      );
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
    return CouponGrantSystem.isUsable(toEntity(this), instantOf(now));
  }

  /** Apply one redemption — decrements multi-use capacity or transitions single-use straight to `used`. */
  markUsed(
    at: ZonedDateTime,
    note = '',
  ): Result<CouponGrant, CouponGrantNotActiveError> {
    const burnt = CouponGrantSystem.burn(toEntity(this), instantOf(at), note);
    if (!burnt.ok) {
      return fail(
        new CouponGrantNotActiveError(
          GRANT_STATUS_LEGACY[burnt.error.currentState],
        ),
      );
    }
    const next = burnt.value;
    if (
      next.grantStatus === GrantStatus.Active &&
      this.state.kind === 'active'
    ) {
      return ok(
        this.withState({
          kind: 'active',
          capacity: fromCapacityData(next),
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
    const expired = CouponGrantSystem.expire(toEntity(this), instantOf(at));
    if (
      !expired.ok ||
      this.state.kind !== 'active' ||
      this.state.expiration.kind !== 'expires_at'
    ) {
      return fail(
        toLegacyError(
          expired.ok
            ? { errorCode: EngagementErrorCode.CouponGrantNotExpiring }
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
      instantOf(at),
      UserIdData.of(revokedBy.value),
      reason,
    );
    if (!revoked.ok || revoked.value.grantStatus !== GrantStatus.Revoked) {
      return fail(
        toLegacyError(
          revoked.ok
            ? { errorCode: EngagementErrorCode.CouponGrantReasonEmpty }
            : revoked.error,
        ) as CouponGrantNotActiveError | CouponGrantEmptyReasonError,
      );
    }
    return ok(
      this.withState({
        kind: 'revoked',
        revokedAt: at,
        revokedBy,
        reason: revoked.value.revocationReason,
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
