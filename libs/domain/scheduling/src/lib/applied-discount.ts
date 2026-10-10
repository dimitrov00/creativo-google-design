import { ZonedDateTime } from '@creativo/domain/kernel';
import {
  CouponCombinability,
  CouponValue,
  DiscountInput,
} from '@creativo/domain/engagement';
import {
  AppliedDiscount as AppliedDiscountData,
  CouponGrantId,
  type CouponValue as CouponValueData,
  DiscountSystem,
} from '@creativo/ecs-core';

/*
 * THIN SHIM (ECS migration Phase 2). The rules about a discount ON THE VISIT
 * — exclusive alone, no promise twice, "the same promise" — are
 * `DiscountSystem` over the ECS `AppliedDiscount` struct. This class keeps
 * the legacy API its callers hold and only converts.
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

/** The legacy discount as the ECS `AppliedDiscount` struct (Phase 4 deletes it). */
export function toEcsDiscount(discount: AppliedDiscount): AppliedDiscountData {
  return {
    id: discount.id,
    source: discount.source,
    value: toValueData(discount.value),
    label: discount.label,
    grantId:
      discount.grantId === null ? null : CouponGrantId.of(discount.grantId),
    code: discount.code,
    appliedAtMs: discount.appliedAt.toMillis(),
    combinability: discount.combinability,
  };
}

/**
 * Where a discount on a visit came from.
 *
 *   - `grant`  — a coupon the CLIENT already held; the shop keeping a promise.
 *   - `code`   — a shareable code the shop published, presented at the counter.
 *   - `manual` — a number a human invented at the counter, role-gated.
 */
export type AppliedDiscountSource = 'grant' | 'code' | 'manual';

export interface AppliedDiscountProps {
  readonly id: string;
  readonly source: AppliedDiscountSource;
  /** What the receipt calls it — the coupon's name, or the counter's word. */
  readonly label: string;
  readonly value: CouponValue;
  /** The grant honoured, for `grant`; `null` otherwise. */
  readonly grantId?: string | null;
  /** The code presented, for `code`; `null` otherwise. */
  readonly code?: string | null;
  /** When it was put on the visit — the evaluator's tie-break, and provenance. */
  readonly appliedAt: ZonedDateTime;
  /**
   * Whether it may share the bill — the coupon's own rule, copied here so a
   * later edit can check the SET without re-resolving anything. A manual
   * figure is stackable: the counter's own money joins whatever is on.
   */
  readonly combinability?: CouponCombinability;
}

/**
 * A discount as it sits ON THE VISIT — a snapshot, exactly as a seat's terms
 * are a snapshot of the catalogue.
 *
 * ### Why a snapshot and not a reference
 * A grant can be revoked, a coupon disabled, a code retired — and none of
 * that may change what a visit already booked was promised. The value is
 * copied here at the moment of applying; `grantId` and `code` are kept as
 * provenance (what was honoured, what was presented), never re-resolved.
 * The `engagement` context stays the authority on what a coupon IS; this
 * context only remembers what was applied.
 *
 * ### What it does not do
 * It does not compute anything. `Appointment.breakdown()` hands every
 * applied discount to `DiscountApplication.apply`, the one evaluator — a
 * second one here would guarantee the two disagree on a rounding.
 */
export class AppliedDiscount {
  private constructor(
    readonly id: string,
    readonly source: AppliedDiscountSource,
    readonly label: string,
    readonly value: CouponValue,
    readonly grantId: string | null,
    readonly code: string | null,
    readonly appliedAt: ZonedDateTime,
    readonly combinability: CouponCombinability,
  ) {}

  static of(props: AppliedDiscountProps): AppliedDiscount {
    return new AppliedDiscount(
      props.id,
      props.source,
      props.label,
      props.value,
      props.grantId ?? null,
      props.code ?? null,
      props.appliedAt,
      props.combinability ?? CouponCombinability.stackable(),
    );
  }

  /**
   * May these share one bill? An exclusive discount must be alone, and no
   * promise may be counted twice — the same grant or the same code appearing
   * twice is a caller bug, not a double discount.
   */
  static isLegalSet(discounts: readonly AppliedDiscount[]): boolean {
    return DiscountSystem.isLegalSet(discounts.map(toEcsDiscount));
  }

  get exclusive(): boolean {
    return AppliedDiscountData.isExclusive(toEcsDiscount(this));
  }

  /** The evaluator's own shape — id, label, value and the instant it was applied. */
  toDiscountInput(): DiscountInput {
    return {
      id: this.id,
      label: this.label,
      value: this.value,
      grantedAt: this.appliedAt,
    };
  }

  /** Same promise: source, value and provenance agree. The instant is not identity. */
  equals(other: AppliedDiscount): boolean {
    return DiscountSystem.samePromise(
      toEcsDiscount(this),
      toEcsDiscount(other),
    );
  }
}
