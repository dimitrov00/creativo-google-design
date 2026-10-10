import type { GiftVoucherId } from '../entities/gift-voucher.entity';
import type { Money } from './money.data';

/**
 * A gift voucher drawn down BY THIS VISIT — a payment, not a discount
 * (`voucher-redemption.ts`, stored as `appointments.voucherRedemptions[]`,
 * `appointment-document.ts:212-270`). Snapshotted: the amount and the
 * balance it left are what the counter saw and what the receipt said, and
 * neither changes because the voucher is used elsewhere later. The voucher
 * keeps the running balance; the two are reconciled only inside the server
 * transaction that writes both.
 *
 * Both figures are nested `Money` (the §2.5 money rule). A reversed line
 * (`reversedAtMs` set — a cancelled visit) stays as history and counts for
 * nothing.
 */
export type VoucherRedemption = {
  readonly voucherId: GiftVoucherId;
  /** The code presented, upper-case — what the receipt prints. */
  readonly code: string;
  /** What THIS visit took off the voucher's balance. */
  readonly amount: Money;
  /** The balance the voucher had left after this — the receipt's «остават». */
  readonly balanceAfter: Money;
  readonly appliedAtMs: number;
  /** When the money went back; `null` while it still pays the bill. */
  readonly reversedAtMs: number | null;
};

export const VoucherRedemption = {
  /** Still counting against the bill. */
  isLive(redemption: VoucherRedemption): boolean {
    return redemption.reversedAtMs === null;
  },

  /** The same line, reversed at `atMs` — kept as history. */
  reversed(redemption: VoucherRedemption, atMs: number): VoucherRedemption {
    return { ...redemption, reversedAtMs: atMs };
  },

  /**
   * What reversing this line puts back on the voucher: its amount while it
   * is live, nothing once already reversed (a second reversal restores
   * nothing). In the redemption's own currency.
   */
  restoreDelta(redemption: VoucherRedemption): Money {
    return {
      amountMinorUnits:
        redemption.reversedAtMs === null
          ? redemption.amount.amountMinorUnits
          : 0,
      currencyCode: redemption.amount.currencyCode,
    };
  },
} as const;
