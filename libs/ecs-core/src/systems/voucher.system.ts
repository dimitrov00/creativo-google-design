import {
  Result,
  VoucherRefusal,
  type Currency,
  type GiftVoucherId,
  type LocalDate,
  PriceCents,
  UtcEpochMs,
} from '@core/primitives';
import { EngagementError, type VoucherBalanceError } from '@core/errors';
import {
  type Money,
  VoucherRedemption,
  VoucherLifecycle,
  VoucherStatus,
  WriteOp,
} from '@core/components';
import {
  type GiftVoucher,
  type GiftVoucherMeta,
  Collections,
} from '@core/entities';

/**
 * What the balance algebra reads of a voucher — its money, its expiry and
 * its lifecycle, never whose it is (D29): a whole `GiftVoucher` passes
 * straight in (Law 3). A balance change hands the same value back with
 * `balanceCents` replaced, whatever else it carries.
 */
export type VoucherBalance = Pick<
  GiftVoucherMeta,
  'initialValueCents' | 'balanceCents' | 'currency' | 'expiresAtUtcMs'
> &
  VoucherLifecycle;

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

/** The day a never-expiring voucher sorts as: after every real one. */
const NEVER_EXPIRES = '9999-12-31';

/**
 * Ids by their UTF-16 code units — every tie-break (OR-18): the same order
 * on every device, never a locale's collation.
 */
function codeUnitOrder(a: GiftVoucherId, b: GiftVoucherId): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The vouchers, the soonest to run out first — the one by-last-day order
 * {@link VoucherSystem.held} shares: by the voucher's last DAY on the shop's
 * calendar (`expiresLocalDate`), the never-expiring ones last, equal days
 * by id in code units. A new array; the input is untouched.
 */
function soonestFirst(
  vouchers: readonly GiftVoucher[],
): readonly GiftVoucher[] {
  const sorted = [...vouchers];
  sorted.sort((a, b) => {
    const dayA = a.expiresLocalDate ?? NEVER_EXPIRES;
    const dayB = b.expiresLocalDate ?? NEVER_EXPIRES;
    if (dayA !== dayB) return dayA < dayB ? -1 : 1;
    return codeUnitOrder(a.id, b.id);
  });
  return sorted;
}

/** A non-negative amount of cents (a sum or difference of safe integer cents). */
function cents(amount: number): PriceCents {
  const clamped = PriceCents.of(Math.max(0, amount) + 0);
  return clamped.ok ? clamped.value : PriceCents.ZERO;
}

function figure(amountCents: number, currency: Currency): Money {
  return { amountCents: cents(amountCents), currency };
}

function withBalance<V extends VoucherBalance>(
  voucher: V,
  balanceCents: number,
): V {
  return { ...voucher, balanceCents: cents(balanceCents) };
}

function refusal(
  voucher: VoucherBalance,
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

function restore<V extends VoucherBalance>(
  voucher: V,
  amount: Money,
): Result<
  V,
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
 * through restore / settle, which REFUSE rather than round: never below
 * zero, never above what was issued. Redeemability against the expiry
 * instant is a T2 lifecycle comparison (G-1); "spendable today" compares the
 * expiry's shop day (`expiresLocalDate`, T5). No voucher is issued here:
 * issuing returns with the points-redemption callable or with payments
 * (OR-14).
 */
export const VoucherSystem = {
  /**
   * Why it cannot be used at `nowUtcMs` — void, expired (AT the instant
   * still is not), empty — or `null`: the gate a voucher NEW to a bill
   * passes before it draws (`BillingSystem.settleVouchers`).
   */
  refusal,

  /**
   * How much of `due` this voucher can settle — its whole balance or all of
   * what is owed, whichever is smaller; zero across a currency line.
   */
  coverage(
    voucher: Pick<VoucherBalance, 'balanceCents' | 'currency'>,
    due: Money,
  ): Money {
    if (due.currency !== voucher.currency) return figure(0, voucher.currency);
    return figure(
      Math.min(voucher.balanceCents, due.amountCents),
      voucher.currency,
    );
  },

  /**
   * THE in-order voucher cascade (the visit editor's voucher lines and dock
   * figure; `BillingSystem.settleVouchers`' cover step): each amount in
   * `available` — what one voucher may draw, in `due`'s currency — covers
   * what the ones before it left, never more than it has
   * ({@link coverage}). Per voucher its cover and what it still holds
   * after; `dueAfter` is what no voucher covered, never below zero.
   */
  cascade(
    available: readonly PriceCents[],
    due: Money,
  ): {
    readonly covers: readonly Money[];
    readonly left: readonly Money[];
    readonly dueAfter: Money;
  } {
    const currency = due.currency;
    const covers: Money[] = [];
    const left: Money[] = [];
    let remaining = due;
    for (let i = 0; i < available.length; i++) {
      const balanceCents = available[i] as PriceCents;
      const cover = VoucherSystem.coverage(
        { balanceCents, currency },
        remaining,
      );
      covers.push(cover);
      left.push(figure(balanceCents - cover.amountCents, currency));
      remaining = figure(remaining.amountCents - cover.amountCents, currency);
    }
    return { covers, left, dueAfter: remaining };
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
  settle<V extends VoucherBalance>(
    voucher: V,
    previous: Money,
    next: Money,
  ): Result<V, VoucherBalanceError> {
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

  /**
   * The money the {@link spendable} vouchers still hold — ONE sum per
   * currency, in the order each currency is first seen (OR-17: no currency
   * is dropped, and none is added to another). Empty when nothing can be
   * spent.
   */
  spendableSums(
    vouchers: readonly GiftVoucher[],
    today: LocalDate,
  ): readonly Money[] {
    const currencies: Currency[] = [];
    const totals: number[] = [];
    for (let i = 0; i < vouchers.length; i++) {
      const voucher = vouchers[i] as GiftVoucher;
      if (!VoucherSystem.spendable(voucher, today)) continue;
      const at = currencies.indexOf(voucher.currency);
      if (at < 0) {
        currencies.push(voucher.currency);
        totals.push(voucher.balanceCents);
      } else {
        totals[at] = (totals[at] as number) + voucher.balanceCents;
      }
    }
    const sums: Money[] = [];
    for (let i = 0; i < currencies.length; i++) {
      sums.push(figure(totals[i] as number, currencies[i] as Currency));
    }
    return sums;
  },

  soonestFirst,

  /**
   * What the wallet holds (`wallet.presenter.ts` `voucherVms`): the
   * {@link VoucherSystem.spendable} vouchers, the soonest to run out first —
   * the by-last-day order {@link VoucherSystem.soonestFirst} shares, the
   * never-expiring ones last — and two that end on one day by id in UTF-16
   * code units (OR-18: no device locale decides an order). A new array.
   */
  held(
    vouchers: readonly GiftVoucher[],
    today: LocalDate,
  ): readonly GiftVoucher[] {
    const spendable: GiftVoucher[] = [];
    for (let i = 0; i < vouchers.length; i++) {
      const voucher = vouchers[i] as GiftVoucher;
      if (VoucherSystem.spendable(voucher, today)) spendable.push(voucher);
    }
    return soonestFirst(spendable);
  },

  /** Nothing has been drawn from it yet: the balance is the whole value it was issued with. */
  untouched(
    voucher: Pick<GiftVoucher, 'balanceCents' | 'initialValueCents'>,
  ): boolean {
    return voucher.balanceCents === voucher.initialValueCents;
  },

  /**
   * The wallet's holdings total (`wallet.presenter.ts` `holdingsDetailOf`):
   * what the {@link VoucherSystem.spendable} vouchers hold together — said
   * only from two of them on (one voucher's figure is already over it), and
   * never across two currencies (they have no sum): `null` then. Composes
   * {@link VoucherSystem.spendableSums}: its one sum when there is exactly
   * one currency. The glance prints every sum instead
   * (`ClientGlanceSystem.holdings`, OR-17). It decides only WHETHER a total
   * exists and its money — never a count.
   */
  heldTotal(vouchers: readonly GiftVoucher[], today: LocalDate): Money | null {
    const sums = VoucherSystem.spendableSums(vouchers, today);
    if (sums.length !== 1) return null;
    let count = 0;
    for (let i = 0; i < vouchers.length && count < 2; i++) {
      if (VoucherSystem.spendable(vouchers[i] as GiftVoucher, today)) count++;
    }
    return count < 2 ? null : (sums[0] as Money);
  },

  /**
   * The write plan of a voucher moving from `before` to `after`: ONE update
   * of its root — the balance and every field of the new lifecycle variant
   * set, every field of the old variant the new one does not declare deleted
   * (§6).
   */
  transitionWrite(before: GiftVoucher, after: GiftVoucher): WriteOp {
    const from = VoucherLifecycle.sliceOf(before);
    const to = VoucherLifecycle.sliceOf(after);
    return WriteOp.transition(
      [Collections.GiftVouchers, after.id],
      { balanceCents: after.balanceCents, ...to },
      WriteOp.variantFieldsToDelete(from, to),
    );
  },
} as const;
