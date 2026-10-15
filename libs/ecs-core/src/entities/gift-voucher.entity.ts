import type { VoucherCode, VoucherLifecycle } from '@core/components';
import type {
  Currency,
  CustomerId,
  GiftVoucherId,
  UserId,
  LocalDate,
  PriceCents,
  UtcEpochMs,
} from '@core/primitives';

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
   * The client record it was sold or gifted to (D29, flatten-spec §5.4); a
   * paper voucher has none.
   */
  readonly issuedToCustomerId: CustomerId | null;
  /**
   * The account that may READ it — the rules key of `get`/`list`
   * (`resource.data.holderUserId == request.auth.uid`), written at the
   * boundary from the record's `Customer.userId`, never derived from
   * `issuedToCustomerId`'s text. `null` for a paper voucher, or one issued
   * to a record without an account.
   */
  readonly holderUserId: UserId | null;
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
