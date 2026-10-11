import { EngagementError } from '../components/engagement-errors.data';
import type { Money } from '../components/money.data';
import { Result } from '../components/result.data';
import { VoucherCode } from '../components/voucher-code.data';
import { VoucherRedemption } from '../components/voucher-redemption.data';
import {
  VoucherLifecycle,
  VoucherRefusal,
  VoucherStatus,
} from '../components/voucher-state.data';
import { WriteOp } from '../components/write-op.data';
import type { GiftVoucher } from '../entities/gift-voucher.entity';
import type { Currency } from '../primitives/currency.primitive';
import type { GiftVoucherId, UserId } from '../primitives/ids.primitive';
import type { LocalDate } from '../primitives/local-date.primitive';
import { PriceCents } from '../primitives/price-cents.primitive';
import { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';
import { Collections } from '../ports/collections';

/** What a new voucher is issued from — every field present. */
export type IssueVoucher = {
  readonly id: GiftVoucherId;
  /** As typed or printed; normalised (trimmed, upper-case) and guarded here. */
  readonly code: string;
  readonly valueCents: PriceCents;
  readonly currency: Currency;
  readonly issuedAtUtcMs: UtcEpochMs;
  readonly expiresAtUtcMs: UtcEpochMs | null;
  /** The shop day of the expiry instant (T5) — `null` together with it. */
  readonly expiresLocalDate: LocalDate | null;
  /** The account it is issued to — a uid until the appointment flip (1) (D29). */
  readonly issuedToUserId: UserId | null;
};

/** The errors a voucher's balance algebra can refuse with. */
export type VoucherBalanceError =
  | EngagementError.GiftVoucherNotRedeemable
  | EngagementError.GiftVoucherInsufficientBalance
  | EngagementError.GiftVoucherCurrencyMismatch
  | EngagementError.GiftVoucherOverRestore;

/**
 * What a cancellation gives back (`voucher-restore.ts`): every voucher the
 * visit drew on, with its restored balance, and the visit's own redemption
 * lines with every live one REVERSED at the cancel's instant — kept as
 * history, never deleted.
 */
export type VoucherRestorePlan = {
  readonly vouchers: readonly GiftVoucher[];
  readonly voucherRedemptions: readonly VoucherRedemption[];
};

/** A non-negative amount of cents (a sum or difference of safe integer cents). */
function cents(amount: number): PriceCents {
  const clamped = PriceCents.of(Math.max(0, amount) + 0);
  return clamped.ok ? clamped.value : PriceCents.ZERO;
}

function figure(amountCents: number, currency: Currency): Money {
  return { amountCents: cents(amountCents), currency };
}

function withBalance(voucher: GiftVoucher, balanceCents: number): GiftVoucher {
  return { ...voucher, balanceCents: cents(balanceCents) };
}

function refusal(
  voucher: GiftVoucher,
  nowUtcMs: UtcEpochMs,
): VoucherRefusal | null {
  if (VoucherLifecycle.isVoid(voucher)) return VoucherRefusal.Void;
  if (
    voucher.expiresAtUtcMs !== null &&
    UtcEpochMs.compare(nowUtcMs, voucher.expiresAtUtcMs) > 0
  ) {
    return VoucherRefusal.Expired;
  }
  if (voucher.balanceCents <= 0) return VoucherRefusal.Empty;
  return null;
}

function restore(
  voucher: GiftVoucher,
  amount: Money,
): Result<
  GiftVoucher,
  | EngagementError.GiftVoucherOverRestore
  | EngagementError.GiftVoucherCurrencyMismatch
> {
  if (amount.currency !== voucher.currency) {
    return Result.err(
      EngagementError.giftVoucherCurrencyMismatch(
        voucher.currency,
        amount.currency,
      ),
    );
  }
  const next = voucher.balanceCents + amount.amountCents;
  if (next > voucher.initialValueCents) {
    return Result.err(EngagementError.giftVoucherOverRestore());
  }
  return Result.ok(withBalance(voucher, next));
}

/**
 * A gift voucher's balance algebra (`gift-voucher.ts`, `voucher-restore.ts`)
 * — money the shop has already been paid, drawn down by visits. A voucher
 * PAYS part of a visit; a coupon lowers its price. Every balance change goes
 * through redeem / restore / settle, which REFUSE rather than round: never
 * below zero, never above what was issued. Redeemability against the expiry
 * instant is a T2 lifecycle comparison (G-1); "spendable today" compares the
 * expiry's shop day (`expiresLocalDate`, T5).
 */
export const VoucherSystem = {
  /**
   * A new voucher, its whole value as balance, `ACTIVE` — every violation
   * at once: a code outside the shape (after normalising), a value of zero
   * or less.
   */
  issue(
    input: IssueVoucher,
  ): Result<
    GiftVoucher,
    readonly (
      | EngagementError.VoucherCodeInvalid
      | EngagementError.GiftVoucherValueInvalid
    )[]
  > {
    const errors: (
      | EngagementError.VoucherCodeInvalid
      | EngagementError.GiftVoucherValueInvalid
    )[] = [];
    const code = VoucherCode.parseTyped(input.code);
    if (!code.ok) errors.push(code.error);
    if (input.valueCents <= 0) {
      errors.push(EngagementError.giftVoucherValueInvalid());
    }
    if (!code.ok || errors.length > 0) return Result.err(errors);
    return Result.ok({
      id: input.id,
      code: code.value,
      initialValueCents: input.valueCents,
      balanceCents: input.valueCents,
      currency: input.currency,
      issuedAtUtcMs: input.issuedAtUtcMs,
      expiresAtUtcMs: input.expiresAtUtcMs,
      expiresLocalDate: input.expiresLocalDate,
      issuedToUserId: input.issuedToUserId,
      ...VoucherLifecycle.active(),
    });
  },

  /** Why it cannot be used at `nowUtcMs` — void, expired (AT the instant still is not), empty — or `null`. */
  refusal,

  isRedeemable(voucher: GiftVoucher, nowUtcMs: UtcEpochMs): boolean {
    return refusal(voucher, nowUtcMs) === null;
  },

  /**
   * How much of `due` this voucher can settle — its whole balance or all of
   * what is owed, whichever is smaller; zero across a currency line.
   */
  coverage(voucher: GiftVoucher, due: Money): Money {
    if (due.currency !== voucher.currency) return figure(0, voucher.currency);
    return figure(
      Math.min(voucher.balanceCents, due.amountCents),
      voucher.currency,
    );
  },

  /** `amount` taken off the balance — refused when not redeemable, in another currency, or more than is left. */
  redeem(
    voucher: GiftVoucher,
    amount: Money,
    nowUtcMs: UtcEpochMs,
  ): Result<
    GiftVoucher,
    | EngagementError.GiftVoucherNotRedeemable
    | EngagementError.GiftVoucherInsufficientBalance
    | EngagementError.GiftVoucherCurrencyMismatch
  > {
    const refused = refusal(voucher, nowUtcMs);
    if (refused !== null) {
      return Result.err(EngagementError.giftVoucherNotRedeemable(refused));
    }
    if (amount.currency !== voucher.currency) {
      return Result.err(
        EngagementError.giftVoucherCurrencyMismatch(
          voucher.currency,
          amount.currency,
        ),
      );
    }
    if (amount.amountCents > voucher.balanceCents) {
      return Result.err(
        EngagementError.giftVoucherInsufficientBalance(
          amount.amountCents,
          voucher.balanceCents,
        ),
      );
    }
    return Result.ok(
      withBalance(voucher, voucher.balanceCents - amount.amountCents),
    );
  },

  /**
   * Money given BACK — a cancelled visit, a save that took less. Allowed on
   * a void or expired voucher too (the shop must not keep the client's
   * money because the voucher ran out of time); never above what was issued.
   */
  restore,

  /**
   * One visit's draw CHANGED from `previous` to `next` — the save that
   * re-settles a bill. What the visit already holds is its own to keep or
   * give back whatever the voucher's state, so a void voucher refuses only a
   * draw that GROWS; the balance stays within `[0, initialValueCents]`.
   */
  settle(
    voucher: GiftVoucher,
    previous: Money,
    next: Money,
  ): Result<GiftVoucher, VoucherBalanceError> {
    const currency = voucher.currency;
    if (previous.currency !== currency || next.currency !== currency) {
      return Result.err(
        EngagementError.giftVoucherCurrencyMismatch(currency, next.currency),
      );
    }
    const available = voucher.balanceCents + previous.amountCents;
    if (
      next.amountCents > previous.amountCents &&
      voucher.voucherStatus === VoucherStatus.Void
    ) {
      return Result.err(
        EngagementError.giftVoucherNotRedeemable(VoucherRefusal.Void),
      );
    }
    if (next.amountCents > available) {
      return Result.err(
        EngagementError.giftVoucherInsufficientBalance(
          next.amountCents,
          cents(available),
        ),
      );
    }
    const balance = available - next.amountCents;
    if (balance > voucher.initialValueCents) {
      return Result.err(EngagementError.giftVoucherOverRestore());
    }
    return Result.ok(withBalance(voucher, balance));
  },

  /** The shop voids a voucher — the balance stays as history. */
  void(
    voucher: GiftVoucher,
    nowUtcMs: UtcEpochMs,
    reason: string,
  ): GiftVoucher {
    return {
      id: voucher.id,
      code: voucher.code,
      initialValueCents: voucher.initialValueCents,
      balanceCents: voucher.balanceCents,
      currency: voucher.currency,
      issuedAtUtcMs: voucher.issuedAtUtcMs,
      expiresAtUtcMs: voucher.expiresAtUtcMs,
      expiresLocalDate: voucher.expiresLocalDate,
      issuedToUserId: voucher.issuedToUserId,
      ...VoucherLifecycle.voided(nowUtcMs, reason),
    };
  },

  /**
   * What a cancellation gives back — `null` when the visit paid with no
   * live voucher line (nearly always). A voucher that is gone, or one that
   * would not take the money back (over what it was issued — a data error),
   * is skipped: the cancellation still lands, and its line is reversed so
   * nobody reads the money as still spent.
   */
  restorePlan(
    redemptions: readonly VoucherRedemption[],
    vouchers: readonly GiftVoucher[],
    nowUtcMs: UtcEpochMs,
  ): VoucherRestorePlan | null {
    let live = 0;
    const restored: GiftVoucher[] = [];
    const lines: VoucherRedemption[] = [];
    for (let i = 0; i < redemptions.length; i++) {
      const redemption = redemptions[i] as VoucherRedemption;
      if (!VoucherRedemption.isLive(redemption)) {
        lines.push(redemption);
        continue;
      }
      live++;
      lines.push(VoucherRedemption.reversed(redemption, nowUtcMs));
      // A voucher two live lines drew on is restored once per line, each
      // restore on the balance the one before it left.
      let at = -1;
      for (let k = 0; k < restored.length && at < 0; k++) {
        if ((restored[k] as GiftVoucher).id === redemption.voucherId) at = k;
      }
      let voucher: GiftVoucher | null =
        at < 0 ? null : (restored[at] as GiftVoucher);
      for (let k = 0; k < vouchers.length && voucher === null; k++) {
        if ((vouchers[k] as GiftVoucher).id === redemption.voucherId) {
          voucher = vouchers[k] as GiftVoucher;
        }
      }
      if (voucher === null) continue;
      const back = restore(voucher, {
        amountCents: VoucherRedemption.restoreDelta(redemption),
        currency: redemption.currency,
      });
      if (!back.ok) continue;
      if (at < 0) restored.push(back.value);
      else restored[at] = back.value;
    }
    if (live === 0) return null;
    return { vouchers: restored, voucherRedemptions: lines };
  },

  /**
   * What can be spent today (the client-card wallet, `wallet.presenter.ts:252`):
   * active, with a balance, and not past its last day — `expiresLocalDate`
   * on or after the shop's `today` (T5: provably the legacy "expires at or
   * after the first instant of today").
   */
  spendable(voucher: GiftVoucher, today: LocalDate): boolean {
    return (
      voucher.voucherStatus === VoucherStatus.Active &&
      voucher.balanceCents > 0 &&
      (voucher.expiresLocalDate === null || voucher.expiresLocalDate >= today)
    );
  },

  /** The money the {@link spendable} vouchers in `currency` still hold. */
  spendableSum(
    vouchers: readonly GiftVoucher[],
    today: LocalDate,
    currency: Currency,
  ): Money {
    let total = 0;
    for (let i = 0; i < vouchers.length; i++) {
      const voucher = vouchers[i] as GiftVoucher;
      if (
        voucher.currency === currency &&
        VoucherSystem.spendable(voucher, today)
      ) {
        total += voucher.balanceCents;
      }
    }
    return figure(total, currency);
  },

  /**
   * The vouchers, the soonest to run out first — by their last DAY on the
   * shop's calendar (`expiresLocalDate`), the never-expiring ones last, ties
   * by id. A new array; the input is untouched.
   */
  soonestFirst(vouchers: readonly GiftVoucher[]): readonly GiftVoucher[] {
    const sorted = [...vouchers];
    sorted.sort((a, b) => {
      const dayA = a.expiresLocalDate ?? '9999-12-31';
      const dayB = b.expiresLocalDate ?? '9999-12-31';
      if (dayA !== dayB) return dayA < dayB ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return sorted;
  },

  /**
   * The write plan of a voucher moving from `before` to `after`: ONE update
   * of its root — the balance and every field of the new lifecycle variant
   * set, every field of the old variant the new one does not declare deleted
   * (§6).
   */
  transitionWrite(before: GiftVoucher, after: GiftVoucher): WriteOp {
    const from = VoucherLifecycle.of(before);
    const to = VoucherLifecycle.of(after);
    return WriteOp.transition(
      [Collections.GiftVouchers, after.id],
      { balanceCents: after.balanceCents, ...to },
      WriteOp.variantFieldsToDelete(from, to),
    );
  },
} as const;
