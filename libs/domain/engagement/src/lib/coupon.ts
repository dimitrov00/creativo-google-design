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
  CouponOccasionUnknownError,
} from './coupon.errors';
import { CouponId } from './ids';
import { EmptyIdError } from './ids.errors';
import { VoucherCode } from './voucher-code';
import { VoucherCodeInvalidError } from './voucher-code.errors';

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

/**
 * The occasion a coupon is given FOR, where it has one: a closed set, so
 * the card that dresses a grant for the day reads a fact, never a name
 * («Рожден ден −20 %» is copy an admin may reword). `birthday` is the
 * gift a client holds on their birthday.
 */
export const COUPON_OCCASIONS = ['birthday'] as const;
export type CouponOccasion = (typeof COUPON_OCCASIONS)[number];

export type CouponError =
  | EmptyIdError
  | CouponEmptyNameError
  | CouponInvalidUsageLimitError
  | VoucherCodeInvalidError
  | CouponOccasionUnknownError;

export interface CreateCouponProps {
  id: string;
  name: string;
  value: CouponValue;
  combinability: CouponCombinability;
  expiry: CouponExpiry;
  usageLimit?: number;
  enabled: boolean;
  /**
   * A SHAREABLE code that opens this coupon at the counter — `FIRST10` on a
   * flyer, a code the client reads off their phone. `null` (the default)
   * for a coupon that reaches people only as grants. Case-insensitive at
   * the counter: stored and matched upper-case, whatever the flyer printed.
   */
  code?: string | null;
  /**
   * What the coupon is given for, one of {@link COUPON_OCCASIONS}; `null`
   * (the default) for a coupon tied to no occasion, which is every coupon
   * written before occasions existed.
   */
  occasion?: CouponOccasion | null;
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
    /** See `CreateCouponProps.code` — upper-case, or `null` for grant-only. */
    readonly code: string | null = null,
    /** See `CreateCouponProps.occasion`: `null` for a coupon tied to none. */
    readonly occasion: CouponOccasion | null = null,
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
    const codeResult = Coupon.validateCode(props.code);
    const occasionResult = Coupon.validateOccasion(props.occasion);

    const combined = combineAll([
      idResult,
      nameResult,
      usageLimitResult,
      codeResult,
      occasionResult,
    ] as const);
    if (combined.isFailure()) {
      return fail(combined.error);
    }
    const [id, name, usageLimit, code, occasion] = combined.value;

    return ok(
      new Coupon(
        id,
        name,
        props.value,
        props.combinability,
        props.expiry,
        usageLimit,
        props.enabled,
        code,
        occasion,
      ),
    );
  }

  /**
   * Normalise a code the way the counter reads it: trimmed, upper-case, and
   * a legal `VoucherCode` — the same shape a client would type in. Exposed
   * so the lookup that RESOLVES a typed code prepares it identically.
   */
  static normalizeCode(raw: string): string {
    return raw.trim().toUpperCase();
  }

  private static validateCode(
    raw: string | null | undefined,
  ): Result<string | null, VoucherCodeInvalidError> {
    if (raw == null || raw.trim().length === 0) return ok(null);
    const normalized = Coupon.normalizeCode(raw);
    const parsed = VoucherCode.create(normalized);
    return parsed.isFailure() ? fail(parsed.error) : ok(parsed.value.value);
  }

  /**
   * An occasion is one of the set or it is refused: a document is
   * untrusted text, and a word the card does not know must not pass as
   * "no occasion" and quietly undress a gift.
   */
  private static validateOccasion(
    raw: unknown,
  ): Result<CouponOccasion | null, CouponOccasionUnknownError> {
    if (raw === undefined || raw === null) return ok(null);
    const known = COUPON_OCCASIONS.find((occasion) => occasion === raw);
    return known === undefined
      ? fail(new CouponOccasionUnknownError(raw))
      : ok(known);
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
