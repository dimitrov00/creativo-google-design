import type { VoucherCode } from '../components/voucher-code.data';
import type { VoucherLifecycle } from '../components/voucher-state.data';
import type { Currency } from '../primitives/currency.primitive';
import type { GiftVoucherId, UserId } from '../primitives/ids.primitive';
import type { LocalDate } from '../primitives/local-date.primitive';
import type { PriceCents } from '../primitives/price-cents.primitive';
import type { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';

/*
 * F0 STAGING: `GiftVoucherId` lives in `primitives/ids.primitive.ts` (§1.5);
 * the barrel still names this file for it until the integrator drops that
 * line.
 */

/** The voucher's identity slice — its id, its money and its stamps. */
export type GiftVoucherMeta = {
  readonly id: GiftVoucherId;
  /** Normalised like a coupon code: trimmed, upper-case. */
  readonly code: VoucherCode;
  /** Positive — what was issued. */
  readonly initialValueCents: PriceCents;
  /** What is left; never below zero, never above `initialValueCents`. */
  readonly balanceCents: PriceCents;
  /** The one currency of both figures (N6: was two `Money`). */
  readonly currency: Currency;
  readonly issuedAtUtcMs: UtcEpochMs;
  /** The instant it stops being redeemable (T2); `null` when it never expires. */
  readonly expiresAtUtcMs: UtcEpochMs | null;
  /**
   * The shop day of that instant (T5) — what "spendable today" compares;
   * `null` together with `expiresAtUtcMs`.
   */
  readonly expiresLocalDate: LocalDate | null;
  /**
   * The account it was sold or gifted to; a paper voucher has none. A uid
   * until the appointment flip (1) adds `issuedToCustomerId` and renames this
   * access key `holderUserId` (D29, §5.4).
   */
  readonly issuedToUserId: UserId | null;
};

/**
 * `giftVouchers/{id}` — money the shop has already been paid, carried as a
 * balance that visits draw down. NOT a coupon: a coupon lowers the PRICE of
 * a visit, a voucher PAYS part of it, and the visit stays full price in
 * every report. The balance changes only through VoucherSystem's
 * redeem / restore / settle, which refuse rather than round.
 *
 * The flat intersection of its slices (Law 6): the identity slice and the
 * `VoucherLifecycle` variant (was the nested `state`). No `redemptions[]`
 * (they live on `appointments.voucherRedemptions`).
 */
export type GiftVoucher = GiftVoucherMeta & VoucherLifecycle;
