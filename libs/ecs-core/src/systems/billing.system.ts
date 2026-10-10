import {
  AppliedDiscount,
  AppliedDiscountSource,
} from '../components/applied-discount.data';
import { CouponCombinability } from '../components/coupon-combinability.data';
import { CouponValue, CouponValueKind } from '../components/coupon-value.data';
import type { Money } from '../components/money.data';
import { Result } from '../components/result.data';
import { seesMoney } from '../components/role.data';
import { SchedulingError } from '../components/scheduling-errors.data';
import type { Seat } from '../components/seat.data';
import { VoucherCode } from '../components/voucher-code.data';
import { VoucherRedemption } from '../components/voucher-redemption.data';
import type { AppointmentEntity } from '../entities/appointment.entity';
import type { CouponGrantId } from '../entities/coupon-grant.entity';
import type { GiftVoucherEntity } from '../entities/gift-voucher.entity';
import type { UserId } from '../entities/user.entity';
import {
  StaffEditError,
  type StaffEditForbidden,
  type StaffEditInvalidCommand,
} from './appointment-edit.system';
import { type DiscountBreakdown, DiscountSystem } from './discount.system';
import { VoucherSystem } from './voucher.system';

/**
 * The bill of one visit — what `Appointment.subtotal/breakdown/total/
 * redeemedTotal/balanceDue` folded, plus the tips. Money in minor units;
 * nothing below zero. `tips` is `null` when no seat has a tip recorded —
 * "not recorded" is not zero.
 */
export type BillTotals = {
  /** The seats' own snapshotted prices, before discounts. */
  readonly subtotal: Money;
  /** Every applied discount through the one evaluator. */
  readonly breakdown: DiscountBreakdown;
  /** What the party owes after discounts — the subtotal when there are none. */
  readonly total: Money;
  /** What live voucher lines have paid. */
  readonly redeemed: Money;
  /** What still changes hands at the counter: total less redeemed, never below zero. */
  readonly balanceDue: Money;
  /** The seats' recorded tips; `null` when none is recorded. */
  readonly tips: Money | null;
};

/** The kinds a batch's word on the bill can take — the stored-or-named choice. */
export const BillPendingKind = {
  /** The batch never mentioned it: the stored value is carried forward. */
  Keep: 'keep',
  /** The batch named the whole set. */
  Set: 'set',
} as const;
export type BillPendingKind =
  (typeof BillPendingKind)[keyof typeof BillPendingKind];

/** A grant as the resolver found it — whose it is and whether it can still be honoured. */
export type ResolvedGrant = {
  readonly grantId: CouponGrantId;
  readonly userId: UserId;
  /** The coupon's name — what the receipt calls the promise. */
  readonly label: string;
  readonly value: CouponValue;
  readonly usable: boolean;
  /** The coupon's own rule: may it share the bill? */
  readonly exclusive: boolean;
};

/** An enabled coupon a code opens. */
export type ResolvedCode = {
  readonly couponId: string;
  readonly label: string;
  readonly value: CouponValue;
  /** The code as stored — normalised — so the snapshot records what was matched. */
  readonly code: string;
  readonly exclusive: boolean;
};

/** A typed manual figure, whole numbers only: a percent, or minor units. */
export type ManualDiscountValue =
  | {
      readonly kind: typeof CouponValueKind.PercentOff;
      readonly percent: number;
    }
  | {
      readonly kind: typeof CouponValueKind.FixedAmount;
      readonly amountMinorUnits: number;
    };

/**
 * One requested discount with what the resolver found for it — `null` when
 * it found nothing. Not yet a refusal: a promise that no longer resolves may
 * still be one the visit already holds, and only the settle can tell.
 */
export type PendingDiscount =
  | {
      readonly source: typeof AppliedDiscountSource.Grant;
      readonly grantId: string;
      readonly resolved: ResolvedGrant | null;
    }
  | {
      readonly source: typeof AppliedDiscountSource.Code;
      readonly code: string;
      readonly resolved: ResolvedCode | null;
    }
  | {
      readonly source: typeof AppliedDiscountSource.Manual;
      readonly value: ManualDiscountValue;
    };

/** The batch's last word on the discounts. */
export type PendingDiscounts =
  | { readonly kind: typeof BillPendingKind.Keep }
  | {
      readonly kind: typeof BillPendingKind.Set;
      readonly items: readonly PendingDiscount[];
    };

/** The batch's last word on the vouchers — the codes, in cover order. */
export type PendingVouchers =
  | { readonly kind: typeof BillPendingKind.Keep }
  | {
      readonly kind: typeof BillPendingKind.Set;
      readonly codes: readonly string[];
    };

/** The vouchers paying the bill after a save, and every voucher whose balance moved. */
export type VoucherSettlement = {
  readonly voucherRedemptions: readonly VoucherRedemption[];
  readonly touched: readonly GiftVoucherEntity[];
};

/** Round-ups offered only while the tip stays within this share of the bill. */
const TIP_ROUND_UP_MAX_SHARE = 0.4;
/** A round-up smaller than this is not worth a tile. */
const TIP_ROUND_UP_MIN_MINOR = 20;
/** The coins on top of an exact payment. */
const TIP_FIXED_MINOR: readonly number[] = [100, 200, 500, 1000, 2000];
const TIP_FIXED_MIN_SHARE = 0.03;
const TIP_FIXED_MAX_SHARE = 0.5;
const TIP_FIXED_SLOTS = 3;
/** The round-up targets: the next whole euro, the next 5, the next 10. */
const TIP_ROUND_UP_STEPS: readonly number[] = [100, 500, 1000];

/** How a tip preset was found — the bento's two tile sizes. */
export const TipPresetKind = {
  /** The bill rounded up to a note a hand holds. */
  RoundUp: 'round_up',
  /** A coin on top of an exact payment. */
  Coin: 'coin',
} as const;
export type TipPresetKind = (typeof TipPresetKind)[keyof typeof TipPresetKind];

/** One tip tile: the tip itself, and the total it rounds the bill to (`null` for a coin). */
export type TipPreset = {
  readonly kind: TipPresetKind;
  readonly amountMinorUnits: number;
  readonly targetMinorUnits: number | null;
};

function figure(amountMinorUnits: number, currencyCode: string): Money {
  return { amountMinorUnits: Math.max(0, amountMinorUnits) + 0, currencyCode };
}

function invalid(field: string): Result.Err<StaffEditInvalidCommand> {
  return Result.err(StaffEditError.invalidCommand(field));
}

/** A typed manual figure → a coupon value, or `null` where its guards refuse it. */
function manualValue(
  raw: ManualDiscountValue,
  currencyCode: string,
): CouponValue | null {
  if (raw.kind === CouponValueKind.PercentOff) {
    const percent = CouponValue.percentOff(raw.percent);
    return percent.ok ? percent.value : null;
  }
  if (!Number.isSafeInteger(raw.amountMinorUnits) || raw.amountMinorUnits < 0) {
    return null;
  }
  const fixed = CouponValue.fixedAmount({
    amountMinorUnits: raw.amountMinorUnits,
    currencyCode,
  });
  return fixed.ok ? fixed.value : null;
}

function findDiscount(
  discounts: readonly AppliedDiscount[],
  match: (discount: AppliedDiscount) => boolean,
): AppliedDiscount | null {
  for (let i = 0; i < discounts.length; i++) {
    const discount = discounts[i] as AppliedDiscount;
    if (match(discount)) return discount;
  }
  return null;
}

function combinabilityOf(exclusive: boolean): CouponCombinability {
  return exclusive
    ? CouponCombinability.exclusive()
    : CouponCombinability.stackable();
}

function findVoucher(
  vouchers: readonly GiftVoucherEntity[],
  match: (voucher: GiftVoucherEntity) => boolean,
): GiftVoucherEntity | null {
  for (let i = 0; i < vouchers.length; i++) {
    const voucher = vouchers[i] as GiftVoucherEntity;
    if (match(voucher)) return voucher;
  }
  return null;
}

function setTouched(
  touched: GiftVoucherEntity[],
  voucher: GiftVoucherEntity,
): void {
  for (let i = 0; i < touched.length; i++) {
    if ((touched[i] as GiftVoucherEntity).id === voucher.id) {
      touched[i] = voucher;
      return;
    }
  }
  touched.push(voucher);
}

/**
 * A visit's bill (`appointment.ts:510-560`, `staff-edit-appointment.use-case.ts:833,974`,
 * the visit editor's evaluate and tip presets): what the seats cost, what the
 * discounts took off, what vouchers paid, and what is left to pay. Tips have
 * one home — the seat — and a `null` tip is not counted as zero. Money is
 * integer minor units; no figure goes below zero.
 */
export const BillingSystem = {
  /**
   * The seats' prices summed — one currency per visit is an invariant, so a
   * second one is refused (`mixed_currency`), and a visit with no seat has
   * no bill (`empty_seats`).
   */
  subtotalOf(
    seats: readonly Seat[],
  ): Result<
    Money,
    | SchedulingError.AppointmentEmptySeats
    | SchedulingError.AppointmentMixedCurrency
  > {
    const first = seats[0];
    if (first === undefined) {
      return Result.err(SchedulingError.appointmentEmptySeats());
    }
    const currency = first.terms.currencyCode;
    let total = 0;
    for (let i = 0; i < seats.length; i++) {
      const terms = (seats[i] as Seat).terms;
      if (terms.currencyCode !== currency) {
        return Result.err(
          SchedulingError.appointmentMixedCurrency(
            currency,
            terms.currencyCode,
          ),
        );
      }
      total += terms.priceMinorUnits;
    }
    return Result.ok({ amountMinorUnits: total, currencyCode: currency });
  },

  /** What the party owes after `discounts` — the subtotal itself when there are none. */
  totalOf(subtotal: Money, discounts: readonly AppliedDiscount[]): Money {
    if (discounts.length === 0) return subtotal;
    return DiscountSystem.apply(
      subtotal,
      DiscountSystem.inputsOf(discounts),
      null,
    ).total;
  },

  /** What LIVE voucher lines in `currencyCode` have paid; a reversed line counts for nothing. */
  redeemedOf(
    redemptions: readonly VoucherRedemption[],
    currencyCode: string,
  ): Money {
    let paid = 0;
    for (let i = 0; i < redemptions.length; i++) {
      const redemption = redemptions[i] as VoucherRedemption;
      if (
        VoucherRedemption.isLive(redemption) &&
        redemption.amount.currencyCode === currencyCode
      ) {
        paid += redemption.amount.amountMinorUnits;
      }
    }
    return figure(paid, currencyCode);
  },

  /** What still changes hands: the total less what vouchers paid, never below zero. */
  balanceDueOf(total: Money, redeemed: Money): Money {
    return figure(
      total.amountMinorUnits - redeemed.amountMinorUnits,
      total.currencyCode,
    );
  },

  /** The seats' recorded tips in `currencyCode`; `null` when no seat has one. */
  tipsOf(seats: readonly Seat[], currencyCode: string): Money | null {
    let recorded = false;
    let total = 0;
    for (let i = 0; i < seats.length; i++) {
      const tip = (seats[i] as Seat).tip;
      if (tip === null || tip.currencyCode !== currencyCode) continue;
      recorded = true;
      total += tip.amountMinorUnits;
    }
    return recorded ? figure(total, currencyCode) : null;
  },

  /** The whole bill of a visit, in its seats' currency. */
  evaluate(
    appointment: AppointmentEntity,
  ): Result<
    BillTotals,
    | SchedulingError.AppointmentEmptySeats
    | SchedulingError.AppointmentMixedCurrency
  > {
    const subtotal = BillingSystem.subtotalOf(appointment.seats);
    if (!subtotal.ok) return subtotal;
    const currency = subtotal.value.currencyCode;
    const breakdown = DiscountSystem.apply(
      subtotal.value,
      DiscountSystem.inputsOf(appointment.discounts),
      null,
    );
    const total =
      appointment.discounts.length === 0 ? subtotal.value : breakdown.total;
    const redeemed = BillingSystem.redeemedOf(
      appointment.voucherRedemptions,
      currency,
    );
    return Result.ok({
      subtotal: subtotal.value,
      breakdown,
      total,
      redeemed,
      balanceDue: BillingSystem.balanceDueOf(total, redeemed),
      tips: BillingSystem.tipsOf(appointment.seats, currency),
    });
  },

  /**
   * The bill's discounts after a staff batch (`settleDiscounts`): the stored
   * ones carried forward (`keep`), or the named set, each item KEPT as
   * stored (the same grant, the same code, the same manual figure — a
   * promise once kept is not withdrawn by a coupon retired since) or NEW, a
   * snapshot stamped `nowMs`. A NEW grant must be the owner's own and still
   * usable; a new code must have opened a coupon; a NEW manual figure needs
   * a role that handles money (`forbidden` otherwise — keeping one somebody
   * else set does not). Then the set: at most one manual figure, an
   * exclusive coupon alone, no promise twice.
   */
  settleDiscounts(
    pending: PendingDiscounts,
    existing: readonly AppliedDiscount[],
    ownerUserId: UserId | null,
    actorRoles: readonly string[],
    currencyCode: string,
    nowMs: number,
  ): Result<
    readonly AppliedDiscount[],
    StaffEditInvalidCommand | StaffEditForbidden
  > {
    if (pending.kind === BillPendingKind.Keep) return Result.ok(existing);
    if (pending.items.length === 0) return Result.ok([]);

    const settled: AppliedDiscount[] = [];
    let manualCount = 0;
    for (let i = 0; i < pending.items.length; i++) {
      const item = pending.items[i] as PendingDiscount;
      switch (item.source) {
        case AppliedDiscountSource.Grant: {
          const kept = findDiscount(
            existing,
            (discount) =>
              discount.source === AppliedDiscountSource.Grant &&
              discount.grantId === item.grantId,
          );
          if (kept !== null) {
            settled.push(kept);
            break;
          }
          const grant = item.resolved;
          if (
            grant === null ||
            !grant.usable ||
            ownerUserId === null ||
            ownerUserId !== grant.userId
          ) {
            return invalid('discounts');
          }
          settled.push({
            id: `grant:${grant.grantId}`,
            source: AppliedDiscountSource.Grant,
            value: grant.value,
            label: grant.label,
            grantId: grant.grantId,
            code: null,
            appliedAtMs: nowMs,
            combinability: combinabilityOf(grant.exclusive),
          });
          break;
        }
        case AppliedDiscountSource.Code: {
          const code = VoucherCode.normalize(item.code);
          const kept = findDiscount(
            existing,
            (discount) =>
              discount.source === AppliedDiscountSource.Code &&
              discount.code === code,
          );
          if (kept !== null) {
            settled.push(kept);
            break;
          }
          const coupon = item.resolved;
          if (coupon === null) return invalid('discounts');
          settled.push({
            id: `code:${coupon.couponId}`,
            source: AppliedDiscountSource.Code,
            value: coupon.value,
            label: coupon.label,
            grantId: null,
            code: coupon.code,
            appliedAtMs: nowMs,
            combinability: combinabilityOf(coupon.exclusive),
          });
          break;
        }
        default: {
          manualCount += 1;
          const value = manualValue(item.value, currencyCode);
          if (value === null) return invalid('discounts');
          const kept = findDiscount(
            existing,
            (discount) =>
              discount.source === AppliedDiscountSource.Manual &&
              discount.value.kind === value.kind &&
              CouponValue.magnitude(discount.value) ===
                CouponValue.magnitude(value),
          );
          if (kept !== null) {
            settled.push(kept);
            break;
          }
          // A barber may stretch his own time; he may not discount the
          // shop's money — refused as FORBIDDEN, not as a bad command.
          if (!seesMoney(actorRoles)) {
            return Result.err(StaffEditError.forbidden());
          }
          settled.push({
            id: 'manual',
            source: AppliedDiscountSource.Manual,
            value,
            label: 'manual',
            grantId: null,
            code: null,
            appliedAtMs: nowMs,
            combinability: CouponCombinability.stackable(),
          });
          break;
        }
      }
    }
    if (manualCount > 1 || !DiscountSystem.isLegalSet(settled)) {
      return invalid('discounts');
    }
    return Result.ok(settled);
  },

  /**
   * The vouchers paying the bill after a batch (`settleVouchers`), against
   * the balances read in the same transaction — ALWAYS re-settled, since a
   * reprice or a discount can drop the bill under what a voucher had paid.
   * A voucher no longer named gives back everything it paid and its line
   * closes as history (reversed at `nowMs`); the named ones cover the
   * `total` in order, each what the ones before it left and never more than
   * it has. A voucher NEW to the visit must be redeemable; one already on it
   * may keep or shrink its draw whatever became of it (`VoucherSystem.settle`).
   */
  settleVouchers(
    pending: PendingVouchers,
    stored: readonly VoucherRedemption[],
    total: Money,
    vouchers: readonly GiftVoucherEntity[],
    nowMs: number,
  ): Result<VoucherSettlement, StaffEditInvalidCommand> {
    const live: VoucherRedemption[] = [];
    const history: VoucherRedemption[] = [];
    for (let i = 0; i < stored.length; i++) {
      const redemption = stored[i] as VoucherRedemption;
      if (VoucherRedemption.isLive(redemption)) live.push(redemption);
      else history.push(redemption);
    }
    const codes: string[] = [];
    if (pending.kind === BillPendingKind.Set) {
      for (let i = 0; i < pending.codes.length; i++) {
        codes.push(VoucherCode.normalize(pending.codes[i] as string));
      }
    } else {
      for (let i = 0; i < live.length; i++) {
        codes.push((live[i] as VoucherRedemption).code);
      }
    }
    if (live.length === 0 && codes.length === 0) {
      return Result.ok({ voucherRedemptions: stored, touched: [] });
    }

    const currency = total.currencyCode;
    const zero = figure(0, currency);
    const touched: GiftVoucherEntity[] = [];

    // 1. Give back what is no longer named.
    for (let i = 0; i < live.length; i++) {
      const prior = live[i] as VoucherRedemption;
      if (codes.includes(prior.code)) continue;
      const voucher =
        findVoucher(vouchers, (entry) => entry.id === prior.voucherId) ??
        findVoucher(vouchers, (entry) => entry.code === prior.code);
      if (voucher !== null) {
        const back = VoucherSystem.settle(voucher, prior.amount, zero);
        if (!back.ok) return invalid('vouchers');
        setTouched(touched, back.value);
      }
      history.push(VoucherRedemption.reversed(prior, nowMs));
    }

    // 2. Cover the bill in order.
    let due = total.amountMinorUnits;
    const next: VoucherRedemption[] = [];
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i] as string;
      const voucher = findVoucher(vouchers, (entry) => entry.code === code);
      if (voucher === null) return invalid('vouchers');
      let prior: VoucherRedemption | null = null;
      for (let k = 0; k < live.length && prior === null; k++) {
        if ((live[k] as VoucherRedemption).voucherId === voucher.id) {
          prior = live[k] as VoucherRedemption;
        }
      }
      if (prior === null && VoucherSystem.refusal(voucher, nowMs) !== null) {
        return invalid('vouchers');
      }
      const previous = prior === null ? zero : prior.amount;
      const available =
        voucher.balance.amountMinorUnits + previous.amountMinorUnits;
      const cover = Math.max(0, Math.min(available, due));
      const settled = VoucherSystem.settle(
        voucher,
        previous,
        figure(cover, currency),
      );
      if (!settled.ok) return invalid('vouchers');
      setTouched(touched, settled.value);
      if (cover === 0) {
        if (prior !== null) {
          history.push(VoucherRedemption.reversed(prior, nowMs));
        }
        continue;
      }
      next.push({
        voucherId: voucher.id,
        code: voucher.code,
        amount: figure(cover, currency),
        balanceAfter: settled.value.balance,
        appliedAtMs: prior === null ? nowMs : prior.appliedAtMs,
        reversedAtMs: null,
      });
      due -= cover;
    }
    return Result.ok({
      voucherRedemptions: [...history, ...next],
      touched,
    });
  },

  /**
   * The tip tiles for a bill of `totalMinorUnits` (the visit editor's
   * bento): the round-ups — the next whole euro, the next 5, the next 10,
   * each while the tip stays at least 20 minor units and within 40 % of the
   * bill — then up to three coins (1, 2, 5, 10, 20 €) whose share of the bill
   * falls in 3–50 %, never an amount a round-up already is. None when the
   * total is unknown or not positive.
   */
  tipPresets(totalMinorUnits: number | null): readonly TipPreset[] {
    if (totalMinorUnits === null || totalMinorUnits <= 0) return [];
    const total = totalMinorUnits;
    const roundUps: TipPreset[] = [];
    const coins: TipPreset[] = [];
    const seen: number[] = [];
    for (let i = 0; i < TIP_ROUND_UP_STEPS.length; i++) {
      const step = TIP_ROUND_UP_STEPS[i] as number;
      const target = Math.ceil(total / step) * step;
      const tip = target - total;
      if (
        tip < TIP_ROUND_UP_MIN_MINOR ||
        tip > total * TIP_ROUND_UP_MAX_SHARE ||
        seen.includes(tip)
      ) {
        continue;
      }
      seen.push(tip);
      roundUps.push({
        kind: TipPresetKind.RoundUp,
        amountMinorUnits: tip,
        targetMinorUnits: target,
      });
    }
    for (let i = 0; i < TIP_FIXED_MINOR.length; i++) {
      if (coins.length >= TIP_FIXED_SLOTS) break;
      const amount = TIP_FIXED_MINOR[i] as number;
      const share = amount / total;
      if (share < TIP_FIXED_MIN_SHARE || share > TIP_FIXED_MAX_SHARE) continue;
      if (seen.includes(amount)) continue;
      seen.push(amount);
      coins.push({
        kind: TipPresetKind.Coin,
        amountMinorUnits: amount,
        targetMinorUnits: null,
      });
    }
    return [...roundUps, ...coins];
  },
} as const;
