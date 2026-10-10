import type { Money } from '../components/money.data';
import type { VoucherCode } from '../components/voucher-code.data';
import type { VoucherState } from '../components/voucher-state.data';
import type { UserId } from './user.entity';

export type GiftVoucherId = string & { readonly __brand: unique symbol };
export const GiftVoucherId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): GiftVoucherId => raw as GiftVoucherId,
} as const;

/**
 * `giftVouchers/{id}` — money the shop has already been paid, carried as a
 * balance that visits draw down. NOT a coupon: a coupon lowers the PRICE of
 * a visit, a voucher PAYS part of it, and the visit stays full price in
 * every report. The balance changes only through VoucherSystem's
 * redeem / restore / settle, which refuse rather than round: never below
 * zero, never above `initialValue`.
 *
 * The stored body of `gift-voucher-document.ts:39-55`. Declared changes
 * (§2.6): the flat `initialValueMinorUnits`/`balanceMinorUnits` +
 * `currencyCode` nest as two `Money`; the `{ iso, zone }` stamps → `*Ms`.
 * No `redemptions[]` (they live on `appointments.voucherRedemptions`).
 */
export type GiftVoucherEntity = {
  readonly id: GiftVoucherId;
  /** Normalised like a coupon code: trimmed, upper-case. */
  readonly code: VoucherCode;
  /** Positive. */
  readonly initialValue: Money;
  readonly balance: Money;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number | null;
  /** The account it was sold or gifted to; a paper voucher has none. */
  readonly issuedToUserId: UserId | null;
  readonly state: VoucherState;
};
