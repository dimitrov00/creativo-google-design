import type { DayOffset } from '../components/day-offset.data';
import { EngagementError } from '../components/engagement-errors.data';
import type { Money } from '../components/money.data';
import { Result } from '../components/result.data';
import { VoucherCode } from '../components/voucher-code.data';
import { VoucherRedemption } from '../components/voucher-redemption.data';
import {
  VoucherRefusal,
  VoucherState,
  VoucherStateKind,
} from '../components/voucher-state.data';
import type {
  GiftVoucherEntity,
  GiftVoucherId,
} from '../entities/gift-voucher.entity';
import type { UserId } from '../entities/user.entity';
import { ZonedTimeSystem } from './zoned-time.system';

/** What a new voucher is issued from — every field present. */
export type IssueVoucher = {
  readonly id: GiftVoucherId;
  /** As typed or printed; normalised (trimmed, upper-case) and guarded here. */
  readonly code: string;
  readonly value: Money;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number | null;
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
  readonly vouchers: readonly GiftVoucherEntity[];
  readonly voucherRedemptions: readonly VoucherRedemption[];
};

function figure(amountMinorUnits: number, currencyCode: string): Money {
  return { amountMinorUnits: Math.max(0, amountMinorUnits) + 0, currencyCode };
}

function withBalance(
  voucher: GiftVoucherEntity,
  amountMinorUnits: number,
): GiftVoucherEntity {
  return {
    ...voucher,
    balance: figure(amountMinorUnits, voucher.balance.currencyCode),
  };
}

function refusal(
  voucher: GiftVoucherEntity,
  nowMs: number,
): VoucherRefusal | null {
  if (VoucherState.isVoid(voucher.state)) return VoucherRefusal.Void;
  if (voucher.expiresAtMs !== null && nowMs > voucher.expiresAtMs) {
    return VoucherRefusal.Expired;
  }
  if (voucher.balance.amountMinorUnits <= 0) return VoucherRefusal.Empty;
  return null;
}

function restore(
  voucher: GiftVoucherEntity,
  amount: Money,
): Result<
  GiftVoucherEntity,
  | EngagementError.GiftVoucherOverRestore
  | EngagementError.GiftVoucherCurrencyMismatch
> {
  const currency = voucher.balance.currencyCode;
  if (amount.currencyCode !== currency) {
    return Result.err(
      EngagementError.giftVoucherCurrencyMismatch(
        currency,
        amount.currencyCode,
      ),
    );
  }
  const next = voucher.balance.amountMinorUnits + amount.amountMinorUnits;
  if (next > voucher.initialValue.amountMinorUnits) {
    return Result.err(EngagementError.giftVoucherOverRestore());
  }
  return Result.ok(withBalance(voucher, next));
}

/** A voucher's last day on the shop's calendar — `null` when it never expires or the table misses it. */
function lastDayOf(
  voucher: GiftVoucherEntity,
  days: readonly DayOffset[],
): string | null {
  return voucher.expiresAtMs === null
    ? null
    : ZonedTimeSystem.dayKeyOf(voucher.expiresAtMs, days);
}

/**
 * A gift voucher's balance algebra (`gift-voucher.ts`, `voucher-restore.ts`)
 * — money the shop has already been paid, drawn down by visits. A voucher
 * PAYS part of a visit; a coupon lowers its price. Every balance change goes
 * through redeem / restore / settle, which REFUSE rather than round: never
 * below zero, never above what was issued.
 */
export const VoucherSystem = {
  /**
   * A new voucher, its whole value as balance, `active` — every violation
   * at once: a code outside the shape (after normalising), a value of zero
   * or less.
   */
  issue(
    input: IssueVoucher,
  ): Result<
    GiftVoucherEntity,
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
    if (input.value.amountMinorUnits <= 0) {
      errors.push(EngagementError.giftVoucherValueInvalid());
    }
    if (!code.ok || errors.length > 0) return Result.err(errors);
    return Result.ok({
      id: input.id,
      code: code.value,
      initialValue: input.value,
      balance: input.value,
      issuedAtMs: input.issuedAtMs,
      expiresAtMs: input.expiresAtMs,
      issuedToUserId: input.issuedToUserId,
      state: VoucherState.active(),
    });
  },

  /** Why it cannot be used at `nowMs` — void, expired (AT the instant still is not), empty — or `null`. */
  refusal,

  isRedeemable(voucher: GiftVoucherEntity, nowMs: number): boolean {
    return refusal(voucher, nowMs) === null;
  },

  /**
   * How much of `due` this voucher can settle — its whole balance or all of
   * what is owed, whichever is smaller; zero across a currency line.
   */
  coverage(voucher: GiftVoucherEntity, due: Money): Money {
    const currency = voucher.balance.currencyCode;
    if (due.currencyCode !== currency) return figure(0, currency);
    return figure(
      Math.min(voucher.balance.amountMinorUnits, due.amountMinorUnits),
      currency,
    );
  },

  /** `amount` taken off the balance — refused when not redeemable, in another currency, or more than is left. */
  redeem(
    voucher: GiftVoucherEntity,
    amount: Money,
    nowMs: number,
  ): Result<
    GiftVoucherEntity,
    | EngagementError.GiftVoucherNotRedeemable
    | EngagementError.GiftVoucherInsufficientBalance
    | EngagementError.GiftVoucherCurrencyMismatch
  > {
    const refused = refusal(voucher, nowMs);
    if (refused !== null) {
      return Result.err(EngagementError.giftVoucherNotRedeemable(refused));
    }
    const currency = voucher.balance.currencyCode;
    if (amount.currencyCode !== currency) {
      return Result.err(
        EngagementError.giftVoucherCurrencyMismatch(
          currency,
          amount.currencyCode,
        ),
      );
    }
    if (amount.amountMinorUnits > voucher.balance.amountMinorUnits) {
      return Result.err(
        EngagementError.giftVoucherInsufficientBalance(
          amount.amountMinorUnits,
          voucher.balance.amountMinorUnits,
        ),
      );
    }
    return Result.ok(
      withBalance(
        voucher,
        voucher.balance.amountMinorUnits - amount.amountMinorUnits,
      ),
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
   * draw that GROWS; the balance stays within `[0, initialValue]`.
   */
  settle(
    voucher: GiftVoucherEntity,
    previous: Money,
    next: Money,
  ): Result<GiftVoucherEntity, VoucherBalanceError> {
    const currency = voucher.balance.currencyCode;
    if (previous.currencyCode !== currency || next.currencyCode !== currency) {
      return Result.err(
        EngagementError.giftVoucherCurrencyMismatch(
          currency,
          next.currencyCode,
        ),
      );
    }
    const available =
      voucher.balance.amountMinorUnits + previous.amountMinorUnits;
    if (
      next.amountMinorUnits > previous.amountMinorUnits &&
      voucher.state.kind === VoucherStateKind.Void
    ) {
      return Result.err(
        EngagementError.giftVoucherNotRedeemable(VoucherRefusal.Void),
      );
    }
    if (next.amountMinorUnits > available) {
      return Result.err(
        EngagementError.giftVoucherInsufficientBalance(
          next.amountMinorUnits,
          available,
        ),
      );
    }
    const balance = available - next.amountMinorUnits;
    if (balance > voucher.initialValue.amountMinorUnits) {
      return Result.err(EngagementError.giftVoucherOverRestore());
    }
    return Result.ok(withBalance(voucher, balance));
  },

  /** The shop voids a voucher — the balance stays as history. */
  void(
    voucher: GiftVoucherEntity,
    nowMs: number,
    reason: string,
  ): GiftVoucherEntity {
    return { ...voucher, state: VoucherState.voided(nowMs, reason) };
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
    vouchers: readonly GiftVoucherEntity[],
    nowMs: number,
  ): VoucherRestorePlan | null {
    let live = 0;
    const restored: GiftVoucherEntity[] = [];
    const lines: VoucherRedemption[] = [];
    for (let i = 0; i < redemptions.length; i++) {
      const redemption = redemptions[i] as VoucherRedemption;
      if (!VoucherRedemption.isLive(redemption)) {
        lines.push(redemption);
        continue;
      }
      live++;
      lines.push(VoucherRedemption.reversed(redemption, nowMs));
      // A voucher two live lines drew on is restored once per line, each
      // restore on the balance the one before it left.
      let at = -1;
      for (let k = 0; k < restored.length && at < 0; k++) {
        if ((restored[k] as GiftVoucherEntity).id === redemption.voucherId) {
          at = k;
        }
      }
      let voucher: GiftVoucherEntity | null =
        at < 0 ? null : (restored[at] as GiftVoucherEntity);
      for (let k = 0; k < vouchers.length && voucher === null; k++) {
        if ((vouchers[k] as GiftVoucherEntity).id === redemption.voucherId) {
          voucher = vouchers[k] as GiftVoucherEntity;
        }
      }
      if (voucher === null) continue;
      const back = restore(voucher, VoucherRedemption.restoreDelta(redemption));
      if (!back.ok) continue;
      if (at < 0) restored.push(back.value);
      else restored[at] = back.value;
    }
    if (live === 0) return null;
    return { vouchers: restored, voucherRedemptions: lines };
  },

  /**
   * What can be spent today (the client-card wallet, `wallet.presenter.ts:252`):
   * active, with a balance, and not past its last day — `todayStartMs` is
   * the first instant of the shop's today, so a voucher expiring at any
   * moment of today still counts.
   */
  spendable(voucher: GiftVoucherEntity, todayStartMs: number): boolean {
    return (
      voucher.state.kind === VoucherStateKind.Active &&
      voucher.balance.amountMinorUnits > 0 &&
      (voucher.expiresAtMs === null || voucher.expiresAtMs >= todayStartMs)
    );
  },

  /** The money the {@link spendable} vouchers in `currencyCode` still hold. */
  spendableSum(
    vouchers: readonly GiftVoucherEntity[],
    todayStartMs: number,
    currencyCode: string,
  ): Money {
    let total = 0;
    for (let i = 0; i < vouchers.length; i++) {
      const voucher = vouchers[i] as GiftVoucherEntity;
      if (
        voucher.balance.currencyCode === currencyCode &&
        VoucherSystem.spendable(voucher, todayStartMs)
      ) {
        total += voucher.balance.amountMinorUnits;
      }
    }
    return figure(total, currencyCode);
  },

  /**
   * The vouchers, the soonest to run out first — by their last DAY on the
   * shop's calendar (`days`, the shop's day table), the never-expiring ones
   * last, ties by id. A new array; the input is untouched.
   */
  soonestFirst(
    vouchers: readonly GiftVoucherEntity[],
    days: readonly DayOffset[],
  ): readonly GiftVoucherEntity[] {
    const keyed: { voucher: GiftVoucherEntity; lastDay: string }[] = [];
    for (let i = 0; i < vouchers.length; i++) {
      const voucher = vouchers[i] as GiftVoucherEntity;
      keyed.push({
        voucher,
        lastDay: lastDayOf(voucher, days) ?? '9999-12-31',
      });
    }
    keyed.sort((a, b) =>
      a.lastDay < b.lastDay
        ? -1
        : a.lastDay > b.lastDay
          ? 1
          : a.voucher.id < b.voucher.id
            ? -1
            : a.voucher.id > b.voucher.id
              ? 1
              : 0,
    );
    const out: GiftVoucherEntity[] = [];
    for (let i = 0; i < keyed.length; i++) {
      out.push((keyed[i] as { voucher: GiftVoucherEntity }).voucher);
    }
    return out;
  },
} as const;
