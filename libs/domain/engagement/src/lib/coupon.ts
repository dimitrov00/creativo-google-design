import {
  Result,
  ZonedDateTime,
  combineAll,
  fail,
  ok,
} from '@creativo/domain/kernel';
import { CouponCombinability } from './coupon-combinability';
import { CouponValue } from './coupon-value';
import {
  CouponEmptyNameError,
  CouponInvalidExpiryDaysError,
  CouponInvalidUsageLimitError,
} from './coupon.errors';
import { CouponId } from './ids';
import { EmptyIdError } from './ids.errors';

/**
 * When does a grant from this coupon stop being usable? Ports v2's
 * `Coupon.Expiry` union — `days` is a *relative* policy (N days after
 * granting), `fixed_date` is an absolute moment.
 */
export type CouponExpiry =
  CouponExpiryNever | CouponExpiryDays | CouponExpiryFixedDate;

export interface CouponExpiryNever {
  readonly kind: 'never';
}
export interface CouponExpiryDays {
  readonly kind: 'days';
  readonly days: number;
}
export interface CouponExpiryFixedDate {
  readonly kind: 'fixed_date';
  readonly at: ZonedDateTime;
}

const NEVER: CouponExpiryNever = { kind: 'never' };

export const CouponExpiry = {
  never(): CouponExpiryNever {
    return NEVER;
  },
  days(days: number): Result<CouponExpiryDays, CouponInvalidExpiryDaysError> {
    if (!Number.isInteger(days) || days <= 0) {
      return fail(new CouponInvalidExpiryDaysError(days));
    }
    return ok({ kind: 'days', days });
  },
  fixedDate(at: ZonedDateTime): CouponExpiryFixedDate {
    return { kind: 'fixed_date', at };
  },
} as const;

export type CouponError =
  EmptyIdError | CouponEmptyNameError | CouponInvalidUsageLimitError;

export interface CreateCouponProps {
  id: string;
  name: string;
  value: CouponValue;
  combinability: CouponCombinability;
  expiry: CouponExpiry;
  usageLimit?: number;
  enabled: boolean;
}

/**
 * **Aggregate root.** Admin-configurable coupon definition (ports v2's
 * `Coupon.ts`) — the discount blueprint (value + expiry + usage policy).
 * Granting one to a user creates a `CouponGrant`.
 */
export class Coupon {
  private constructor(
    readonly id: CouponId,
    readonly name: string,
    readonly value: CouponValue,
    readonly combinability: CouponCombinability,
    readonly expiry: CouponExpiry,
    readonly usageLimit: number | null,
    readonly enabled: boolean,
  ) {}

  static create(props: CreateCouponProps): Result<Coupon, CouponError[]> {
    return Coupon.build(props);
  }

  static reconstitute(props: CreateCouponProps): Result<Coupon, CouponError[]> {
    return Coupon.build(props);
  }

  private static build(
    props: CreateCouponProps,
  ): Result<Coupon, CouponError[]> {
    const idResult = CouponId.create(props.id);
    const nameResult = Coupon.validateName(props.name);
    const usageLimitResult = Coupon.validateUsageLimit(props.usageLimit);

    const combined = combineAll([
      idResult,
      nameResult,
      usageLimitResult,
    ] as const);
    if (combined.isFailure()) {
      return fail(combined.error);
    }
    const [id, name, usageLimit] = combined.value;

    return ok(
      new Coupon(
        id,
        name,
        props.value,
        props.combinability,
        props.expiry,
        usageLimit,
        props.enabled,
      ),
    );
  }

  /** Whether a grant from this coupon, granted `at`, is still within its expiry window at `now`. */
  isWithinExpiry(grantedAt: ZonedDateTime, now: ZonedDateTime): boolean {
    switch (this.expiry.kind) {
      case 'never':
        return true;
      case 'days':
        return now.isSameOrBefore(
          grantedAt.plusMinutes(this.expiry.days * 24 * 60),
        );
      case 'fixed_date':
        return now.isSameOrBefore(this.expiry.at);
    }
  }

  private static validateName(
    raw: string,
  ): Result<string, CouponEmptyNameError> {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? ok(trimmed) : fail(new CouponEmptyNameError());
  }

  private static validateUsageLimit(
    raw: number | undefined,
  ): Result<number | null, CouponInvalidUsageLimitError> {
    if (raw === undefined) return ok(null);
    if (!Number.isInteger(raw) || raw <= 0) {
      return fail(new CouponInvalidUsageLimitError(raw));
    }
    return ok(raw);
  }
}
