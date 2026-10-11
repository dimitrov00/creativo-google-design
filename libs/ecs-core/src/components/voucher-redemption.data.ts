import {
  type Currency,
  type GiftVoucherId,
  PriceCents,
  type UtcEpochMs,
} from '@core/primitives';
import type { VoucherCode } from './voucher-code.data';

/**
 * A gift voucher drawn down BY THIS VISIT — a payment, not a discount
 * (`voucher-redemption.ts`) — an element of the 1-to-N
 * `appointments.voucherRedemptions[]` array, flat (Law 6, N6: the two nested
 * `Money` figures become `amountCents` / `balanceAfterCents` beside ONE
 * `currency`). Snapshotted: the amount and the balance it left are what the
 * counter saw and what the receipt said, and neither changes because the
 * voucher is used elsewhere later. The voucher keeps the running balance;
 * the two are reconciled only inside the server transaction that writes
 * both.
 *
 * A reversed line (`reversedAtUtcMs` set — a cancelled visit) stays as
 * history and counts for nothing.
 */
export type VoucherRedemption = {
  readonly voucherId: GiftVoucherId;
  /** The code presented, upper-case — what the receipt prints. */
  readonly code: VoucherCode;
  /** What THIS visit took off the voucher's balance. */
  readonly amountCents: PriceCents;
  /** The balance the voucher had left after this — the receipt's «остават». */
  readonly balanceAfterCents: PriceCents;
  readonly currency: Currency;
  readonly appliedAtUtcMs: UtcEpochMs;
  /** When the money went back; `null` while it still pays the bill. */
  readonly reversedAtUtcMs: UtcEpochMs | null;
};

export const VoucherRedemption = {
  /** Still counting against the bill. */
  isLive(redemption: VoucherRedemption): boolean {
    return redemption.reversedAtUtcMs === null;
  },

  /** The same line, reversed at `atUtcMs` — kept as history. */
  reversed(
    redemption: VoucherRedemption,
    atUtcMs: UtcEpochMs,
  ): VoucherRedemption {
    return { ...redemption, reversedAtUtcMs: atUtcMs };
  },

  /**
   * What reversing this line puts back on the voucher: its amount while it
   * is live, nothing once already reversed (a second reversal restores
   * nothing). In the redemption's own `currency`.
   */
  restoreDelta(redemption: VoucherRedemption): PriceCents {
    return redemption.reversedAtUtcMs === null
      ? redemption.amountCents
      : PriceCents.ZERO;
  },
} as const;
