import { Money, ZonedDateTime } from '@creativo/domain/kernel';
import {
  GiftVoucherId,
  VoucherRedemption as VoucherRedemptionData,
} from '@creativo/ecs-core';

/*
 * THIN SHIM (ECS migration Phase 2). Whether a line still pays the bill is
 * the ECS `VoucherRedemption` component's (`isLive`); the bill's sums are
 * `BillingSystem`'s. This class keeps the legacy API and only converts.
 */

/* ── Legacy ↔ ECS converters ─────────────────────────────────────────── */

function toData(line: VoucherRedemption): VoucherRedemptionData {
  return {
    voucherId: GiftVoucherId.of(line.voucherId),
    code: line.code,
    amount: {
      amountMinorUnits: line.amount.toMinorUnits(),
      currencyCode: line.amount.currencyCode(),
    },
    balanceAfter: {
      amountMinorUnits: line.balanceAfter.toMinorUnits(),
      currencyCode: line.balanceAfter.currencyCode(),
    },
    appliedAtMs: line.appliedAt.toMillis(),
    reversedAtMs: line.reversedAt === null ? null : line.reversedAt.toMillis(),
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
    return VoucherRedemptionData.isLive(toData(this));
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
