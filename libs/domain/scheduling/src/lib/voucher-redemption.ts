import { Money, ZonedDateTime } from '@creativo/domain/kernel';
import {
  Currency,
  GiftVoucherId,
  PriceCents,
  UtcEpochMs,
  VoucherCode,
  VoucherRedemption as VoucherRedemptionData,
  defect,
} from '@creativo/ecs-core';

/*
 * THIN SHIM (ECS migration Phase 2). Whether a line still pays the bill is
 * the ECS `VoucherRedemption` component's (`isLive`); the bill's sums are
 * `BillingSystem`'s. This class keeps the legacy API and only converts:
 * `Money` → `*Cents` beside one `currency`, a `ZonedDateTime` → its instant
 * (flatten-spec §8.9).
 */

/* ── Legacy ↔ ECS converters ─────────────────────────────────────────── */

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

function centsOf(money: Money): PriceCents {
  return sure(PriceCents.signed(money.toMinorUnits()), 'an amount');
}

function instantOf(at: ZonedDateTime): UtcEpochMs {
  return sure(UtcEpochMs.of(at.toMillis()), 'an instant');
}

/** A line as the ECS struct (`appointments.voucherRedemptions[]`, flat). */
export function toEcsRedemption(
  line: VoucherRedemption,
): VoucherRedemptionData {
  return {
    voucherId: GiftVoucherId.of(line.voucherId),
    code: VoucherCode.of(line.code),
    amountCents: centsOf(line.amount),
    balanceAfterCents: centsOf(line.balanceAfter),
    currency: sure(Currency.parse(line.amount.currencyCode()), 'a currency'),
    appliedAtUtcMs: instantOf(line.appliedAt),
    reversedAtUtcMs:
      line.reversedAt === null ? null : instantOf(line.reversedAt),
  };
}

export interface VoucherRedemptionProps {
  readonly voucherId: string;
  /** The code presented, upper-case — what the receipt prints. */
  readonly code: string;
  /** What THIS visit took off the voucher's balance. */
  readonly amount: Money;
  /** The balance the voucher had left after this — the receipt's «остават». */
  readonly balanceAfter: Money;
  readonly appliedAt: ZonedDateTime;
  /** Set when the money went back — a cancelled visit. The line stays as history. */
  readonly reversedAt?: ZonedDateTime | null;
}

/**
 * A gift voucher drawn down BY THIS VISIT — a payment, not a discount.
 *
 * Snapshotted like everything else on the appointment: the amount and the
 * balance it left are what the counter saw and what the receipt said, and
 * neither changes because the voucher is later used elsewhere. The voucher
 * itself (`GiftVoucher`, engagement) keeps the running balance; the two
 * are reconciled only inside the server transaction that writes both.
 */
export class VoucherRedemption {
  private constructor(
    readonly voucherId: string,
    readonly code: string,
    readonly amount: Money,
    readonly balanceAfter: Money,
    readonly appliedAt: ZonedDateTime,
    readonly reversedAt: ZonedDateTime | null,
  ) {}

  static of(props: VoucherRedemptionProps): VoucherRedemption {
    return new VoucherRedemption(
      props.voucherId,
      props.code,
      props.amount,
      props.balanceAfter,
      props.appliedAt,
      props.reversedAt ?? null,
    );
  }

  /** Still counting against the bill. */
  get live(): boolean {
    return VoucherRedemptionData.isLive(toEcsRedemption(this));
  }

  reversed(at: ZonedDateTime): VoucherRedemption {
    return new VoucherRedemption(
      this.voucherId,
      this.code,
      this.amount,
      this.balanceAfter,
      this.appliedAt,
      at,
    );
  }
}
