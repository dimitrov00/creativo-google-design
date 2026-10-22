import {
  type AppliedDiscount,
  Combinability,
  CouponValue,
  DiscountMethod,
  DiscountProvenance,
  DiscountSource,
  type Money,
  seesMoney,
  type Seat,
  VoucherCode,
  VoucherRedemption,
} from '@core/components';
import {
  Result,
  SchedulingError,
  type Currency,
  AppliedDiscountId,
  type CouponGrantId,
  type CouponId,
  type CustomerId,
  PriceCents,
  type UtcEpochMs,
  StaffEditError,
  type StaffEditForbidden,
  type StaffEditInvalidCommand,
} from '@core/primitives';
import type { Appointment, GiftVoucher } from '@core/entities';
import { type DiscountBreakdown, DiscountSystem } from './discount.system';
import { VoucherSystem } from './voucher.system';

/**
 * The bill of one visit — what `Appointment.subtotal/breakdown/total/
 * redeemedTotal/balanceDue` folded, plus the tips. Money in cents, every
 * figure in the one `currency`; nothing below zero. `tipsCents` is `null`
 * when no seat has a tip recorded — "not recorded" is not zero.
 */
export type BillTotals = {
  /** The seats' own snapshotted prices, before discounts. */
  readonly subtotalCents: PriceCents;
  /** Every applied discount through the one evaluator. */
  readonly breakdown: DiscountBreakdown;
  /** What the party owes after discounts — the subtotal when there are none. */
  readonly totalCents: PriceCents;
  /** What live voucher lines have paid. */
  readonly redeemedCents: PriceCents;
  /** What still changes hands at the counter: total less redeemed, never below zero. */
  readonly balanceDueCents: PriceCents;
  /** The seats' recorded tips; `null` when none is recorded. */
  readonly tipsCents: PriceCents | null;
  readonly currency: Currency;
};

/** A batch's word on the bill — the field `billPending`: the stored set kept, or a named one. */
export const BillPending = {
  /** The batch never mentioned it: the stored value is carried forward. */
  Keep: 'KEEP',
  /** The batch named the whole set. */
  Set: 'SET',
} as const;
export type BillPending = (typeof BillPending)[keyof typeof BillPending];

/** A grant as the resolver found it — whose it is, whether it can still be honoured, and its value. */
export type ResolvedGrant = {
  readonly grantId: CouponGrantId;
  /** The client record the grant rewards (D29) — matched against the visit's `ownerCustomerId`. */
  readonly customerId: CustomerId;
  /** The coupon's name — what the receipt calls the promise. */
  readonly label: string;
  readonly usable: boolean;
  /** The coupon's own rule: may it share the bill? */
  readonly exclusive: boolean;
} & CouponValue;

/** An enabled coupon a code opens, and its value. */
export type ResolvedCode = {
  readonly couponId: CouponId;
  readonly label: string;
  /** The code as stored — normalised — so the snapshot records what was matched. */
  readonly code: VoucherCode;
  readonly exclusive: boolean;
} & CouponValue;

/**
 * A typed manual figure — the `CouponValue` slice minus `FREE_SERVICE`: a
 * percent, or an amount of cents (re-stamped in the visit's currency).
 */
export type ManualDiscountValue =
  CouponValue.PercentOff | CouponValue.FixedAmount;

/** The price slice of a seat — all a subtotal reads (Law 3: the slice it needs). */
export type SeatPrice = Pick<Seat, 'priceCents' | 'currency'>;

/**
 * One requested discount with what the resolver found for it — `null` when
 * it found nothing. Not yet a refusal: a promise that no longer resolves may
 * still be one the visit already holds, and only the settle can tell.
 */
export type PendingDiscount =
  | {
      readonly discountSource: typeof DiscountSource.Grant;
      readonly grantId: CouponGrantId;
      readonly resolved: ResolvedGrant | null;
    }
  | {
      readonly discountSource: typeof DiscountSource.Code;
      /** As typed — normalised here. */
      readonly code: string;
      readonly resolved: ResolvedCode | null;
    }
  | {
      readonly discountSource: typeof DiscountSource.Manual;
      readonly value: ManualDiscountValue;
    };

/** The batch's last word on the discounts. */
export type PendingDiscounts =
  | { readonly billPending: typeof BillPending.Keep }
  | {
      readonly billPending: typeof BillPending.Set;
      readonly items: readonly PendingDiscount[];
    };

/** The batch's last word on the vouchers — the codes, in cover order, as typed. */
export type PendingVouchers =
  | { readonly billPending: typeof BillPending.Keep }
  | {
      readonly billPending: typeof BillPending.Set;
      readonly codes: readonly string[];
    };

/** The vouchers paying the bill after a save, and every voucher whose balance moved. */
export type VoucherSettlement = {
  readonly voucherRedemptions: readonly VoucherRedemption[];
  readonly touched: readonly GiftVoucher[];
};

/** Round-ups offered only while the tip stays within this share of the bill. */
const TIP_ROUND_UP_MAX_SHARE = 0.4;
/** A round-up smaller than this is not worth a tile. */
const TIP_ROUND_UP_MIN_CENTS = 20;
/** The coins on top of an exact payment. */
const TIP_FIXED_CENTS: readonly number[] = [100, 200, 500, 1000, 2000];
const TIP_FIXED_MIN_SHARE = 0.03;
const TIP_FIXED_MAX_SHARE = 0.5;
const TIP_FIXED_SLOTS = 3;
/** The round-up targets: the next whole euro, the next 5, the next 10. */
const TIP_ROUND_UP_STEPS: readonly number[] = [100, 500, 1000];

/** How a tip preset was found — the field `tipPreset`, the bento's two tile sizes. */
export const TipPreset = {
  /** The bill rounded up to a note a hand holds. */
  RoundUp: 'ROUND_UP',
  /** A coin on top of an exact payment. */
  Coin: 'COIN',
} as const;
export type TipPreset = (typeof TipPreset)[keyof typeof TipPreset];

/** One tip tile: the tip itself, and the total it rounds the bill to (`null` for a coin). */
export type TipPresetOption = {
  readonly tipPreset: TipPreset;
  readonly amountCents: PriceCents;
  readonly targetCents: PriceCents | null;
};

/** A non-negative amount of cents (a sum or difference of safe integer cents). */
function cents(amount: number): PriceCents {
  const clamped = PriceCents.of(Math.max(0, amount) + 0);
  return clamped.ok ? clamped.value : PriceCents.ZERO;
}

function figure(amountCents: number, currency: Currency): Money {
  return { amountCents: cents(amountCents), currency };
}

function invalid(field: string): Result.Err<StaffEditInvalidCommand> {
  return Result.err(StaffEditError.invalidCommand(field));
}

/** A typed manual figure → a coupon value in the visit's currency, or `null` where its guards refuse it. */
function manualValue(
  raw: ManualDiscountValue,
  currency: Currency,
): CouponValue | null {
  if (raw.discountMethod === DiscountMethod.PercentOff) {
    const percent = CouponValue.percentOff(raw.discountPercent);
    return percent.ok ? percent.value : null;
  }
  if (
    !Number.isSafeInteger(raw.discountAmountCents) ||
    raw.discountAmountCents < 0
  ) {
    return null;
  }
  const fixed = CouponValue.fixedAmount(raw.discountAmountCents, currency);
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

function combinabilityOf(exclusive: boolean): Combinability {
  return exclusive ? Combinability.Exclusive : Combinability.Stackable;
}

function findVoucher(
  vouchers: readonly GiftVoucher[],
  match: (voucher: GiftVoucher) => boolean,
): GiftVoucher | null {
  for (let i = 0; i < vouchers.length; i++) {
    const voucher = vouchers[i] as GiftVoucher;
    if (match(voucher)) return voucher;
  }
  return null;
}

function setTouched(touched: GiftVoucher[], voucher: GiftVoucher): void {
  for (let i = 0; i < touched.length; i++) {
    if ((touched[i] as GiftVoucher).id === voucher.id) {
      touched[i] = voucher;
      return;
    }
  }
  touched.push(voucher);
}

/** A redemption line's amount as a `Money` in its own currency. */
function drawOf(redemption: VoucherRedemption): Money {
  return { amountCents: redemption.amountCents, currency: redemption.currency };
}

/**
 * A visit's bill (`appointment.ts:510-560`, `staff-edit-appointment.use-case.ts:833,974`,
 * the visit editor's evaluate and tip presets): what the seats cost, what the
 * discounts took off, what vouchers paid, and what is left to pay. Tips have
 * one home — the seat — and a `null` tip is not counted as zero. Money is
 * integer cents; no figure goes below zero.
 */
export const BillingSystem = {
  /**
   * The seats' prices summed — one currency per visit is an invariant, so a
   * second one is refused (`MIXED_CURRENCY`), and a visit with no seat has
   * no bill (`EMPTY_SEATS`).
   */
  subtotalOf(
    seats: readonly SeatPrice[],
  ): Result<
    Money,
    | SchedulingError.AppointmentEmptySeats
    | SchedulingError.AppointmentMixedCurrency
  > {
    const first = seats[0];
    if (first === undefined) {
      return Result.err(SchedulingError.appointmentEmptySeats());
    }
    const currency = first.currency;
    let total = 0;
    for (let i = 0; i < seats.length; i++) {
      const seat = seats[i] as SeatPrice;
      if (seat.currency !== currency) {
        return Result.err(
          SchedulingError.appointmentMixedCurrency(currency, seat.currency),
        );
      }
      total += seat.priceCents;
    }
    return Result.ok(figure(total, currency));
  },

  /** What the party owes after `discounts` — the subtotal itself when there are none. */
  totalOf(subtotal: Money, discounts: readonly AppliedDiscount[]): Money {
    if (discounts.length === 0) return subtotal;
    const breakdown = DiscountSystem.apply(
      subtotal,
      DiscountSystem.inputsOf(discounts),
      null,
    );
    return { amountCents: breakdown.totalCents, currency: breakdown.currency };
  },

  /** What LIVE voucher lines in `currency` have paid; a reversed line counts for nothing. */
  redeemedOf(
    redemptions: readonly VoucherRedemption[],
    currency: Currency,
  ): Money {
    let paid = 0;
    for (let i = 0; i < redemptions.length; i++) {
      const redemption = redemptions[i] as VoucherRedemption;
      if (
        VoucherRedemption.isLive(redemption) &&
        redemption.currency === currency
      ) {
        paid += redemption.amountCents;
      }
    }
    return figure(paid, currency);
  },

  /** What still changes hands: the total less what vouchers paid, never below zero. */
  balanceDueOf(total: Money, redeemed: Money): Money {
    return figure(total.amountCents - redeemed.amountCents, total.currency);
  },

  /** The seats' recorded tips (each in its seat's currency) in `currency`; `null` when no seat has one. */
  tipsOf(seats: readonly Seat[], currency: Currency): Money | null {
    let recorded = false;
    let total = 0;
    for (let i = 0; i < seats.length; i++) {
      const seat = seats[i] as Seat;
      if (seat.tipCents === null || seat.currency !== currency) continue;
      recorded = true;
      total += seat.tipCents;
    }
    return recorded ? figure(total, currency) : null;
  },

  /** The whole bill of a visit, in its seats' currency. */
  evaluate(
    appointment: Pick<
      Appointment,
      'seats' | 'discounts' | 'voucherRedemptions'
    >,
  ): Result<
    BillTotals,
    | SchedulingError.AppointmentEmptySeats
    | SchedulingError.AppointmentMixedCurrency
  > {
    const subtotal = BillingSystem.subtotalOf(appointment.seats);
    if (!subtotal.ok) return subtotal;
    const currency = subtotal.value.currency;
    const breakdown = DiscountSystem.apply(
      subtotal.value,
      DiscountSystem.inputsOf(appointment.discounts),
      null,
    );
    const total =
      appointment.discounts.length === 0
        ? subtotal.value
        : figure(breakdown.totalCents, currency);
    const redeemed = BillingSystem.redeemedOf(
      appointment.voucherRedemptions,
      currency,
    );
    const tips = BillingSystem.tipsOf(appointment.seats, currency);
    return Result.ok({
      subtotalCents: subtotal.value.amountCents,
      breakdown,
      totalCents: total.amountCents,
      redeemedCents: redeemed.amountCents,
      balanceDueCents: BillingSystem.balanceDueOf(total, redeemed).amountCents,
      tipsCents: tips === null ? null : tips.amountCents,
      currency,
    });
  },

  /**
   * The bill's discounts after a staff batch (`settleDiscounts`): the stored
   * ones carried forward (`KEEP`), or the named set, each item KEPT as
   * stored (the same grant, the same code, the same manual figure — a
   * promise once kept is not withdrawn by a coupon retired since) or NEW, a
   * snapshot stamped `nowUtcMs`. A NEW grant must be the owner's own (the
   * visit's `ownerCustomerId`, D29) and still usable; a new code must have opened a coupon; a NEW manual figure
   * needs a role that handles money (`FORBIDDEN` otherwise — keeping one
   * somebody else set does not). Then the set: at most one manual figure, an
   * exclusive coupon alone, no promise twice.
   */
  settleDiscounts(
    pending: PendingDiscounts,
    existing: readonly AppliedDiscount[],
    ownerCustomerId: CustomerId | null,
    actorRoles: readonly string[],
    currency: Currency,
    nowUtcMs: UtcEpochMs,
  ): Result<
    readonly AppliedDiscount[],
    StaffEditInvalidCommand | StaffEditForbidden
  > {
    if (pending.billPending === BillPending.Keep) return Result.ok(existing);
    if (pending.items.length === 0) return Result.ok([]);

    const settled: AppliedDiscount[] = [];
    let manualCount = 0;
    for (let i = 0; i < pending.items.length; i++) {
      const item = pending.items[i] as PendingDiscount;
      switch (item.discountSource) {
        case DiscountSource.Grant: {
          const kept = findDiscount(
            existing,
            (discount) =>
              discount.discountSource === DiscountSource.Grant &&
              discount.discountGrantId === item.grantId,
          );
          if (kept !== null) {
            settled.push(kept);
            break;
          }
          const grant = item.resolved;
          if (
            grant === null ||
            !grant.usable ||
            ownerCustomerId === null ||
            ownerCustomerId !== grant.customerId
          ) {
            return invalid('discounts');
          }
          settled.push({
            discountId: AppliedDiscountId.of(`grant:${grant.grantId}`),
            label: grant.label,
            appliedAtUtcMs: nowUtcMs,
            combinability: combinabilityOf(grant.exclusive),
            ...DiscountProvenance.grant(grant.grantId),
            ...CouponValue.of(grant),
          });
          break;
        }
        case DiscountSource.Code: {
          const code = VoucherCode.normalize(item.code);
          const kept = findDiscount(
            existing,
            (discount) =>
              discount.discountSource === DiscountSource.Code &&
              discount.discountCode === code,
          );
          if (kept !== null) {
            settled.push(kept);
            break;
          }
          const coupon = item.resolved;
          if (coupon === null) return invalid('discounts');
          settled.push({
            discountId: AppliedDiscountId.of(`code:${coupon.couponId}`),
            label: coupon.label,
            appliedAtUtcMs: nowUtcMs,
            combinability: combinabilityOf(coupon.exclusive),
            ...DiscountProvenance.code(coupon.code),
            ...CouponValue.of(coupon),
          });
          break;
        }
        default: {
          manualCount += 1;
          const value = manualValue(item.value, currency);
          if (value === null) return invalid('discounts');
          const kept = findDiscount(
            existing,
            (discount) =>
              discount.discountSource === DiscountSource.Manual &&
              discount.discountMethod === value.discountMethod &&
              CouponValue.magnitude(discount) === CouponValue.magnitude(value),
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
            discountId: AppliedDiscountId.of('manual'),
            label: 'manual',
            appliedAtUtcMs: nowUtcMs,
            combinability: Combinability.Stackable,
            ...DiscountProvenance.manual(),
            ...value,
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
   * closes as history (reversed at `nowUtcMs`); the named ones cover the
   * `total` in order, each what the ones before it left and never more than
   * it has. A voucher NEW to the visit must be redeemable; one already on it
   * may keep or shrink its draw whatever became of it (`VoucherSystem.settle`).
   */
  settleVouchers(
    pending: PendingVouchers,
    stored: readonly VoucherRedemption[],
    total: Money,
    vouchers: readonly GiftVoucher[],
    nowUtcMs: UtcEpochMs,
  ): Result<VoucherSettlement, StaffEditInvalidCommand> {
    const live: VoucherRedemption[] = [];
    const history: VoucherRedemption[] = [];
    for (let i = 0; i < stored.length; i++) {
      const redemption = stored[i] as VoucherRedemption;
      if (VoucherRedemption.isLive(redemption)) live.push(redemption);
      else history.push(redemption);
    }
    const codes: string[] = [];
    if (pending.billPending === BillPending.Set) {
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

    const currency = total.currency;
    const zero = figure(0, currency);
    const touched: GiftVoucher[] = [];

    // 1. Give back what is no longer named.
    for (let i = 0; i < live.length; i++) {
      const prior = live[i] as VoucherRedemption;
      if (codes.includes(prior.code)) continue;
      const voucher =
        findVoucher(vouchers, (entry) => entry.id === prior.voucherId) ??
        findVoucher(vouchers, (entry) => entry.code === prior.code);
      if (voucher !== null) {
        const back = VoucherSystem.settle(voucher, drawOf(prior), zero);
        if (!back.ok) return invalid('vouchers');
        setTouched(touched, back.value);
      }
      history.push(VoucherRedemption.reversed(prior, nowUtcMs));
    }

    // 2. Cover the bill in order.
    let due: number = total.amountCents;
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
      if (prior === null && VoucherSystem.refusal(voucher, nowUtcMs) !== null) {
        return invalid('vouchers');
      }
      const previous = prior === null ? zero : drawOf(prior);
      const available = voucher.balanceCents + previous.amountCents;
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
          history.push(VoucherRedemption.reversed(prior, nowUtcMs));
        }
        continue;
      }
      next.push({
        voucherId: voucher.id,
        code: voucher.code,
        amountCents: cents(cover),
        balanceAfterCents: settled.value.balanceCents,
        currency,
        appliedAtUtcMs: prior === null ? nowUtcMs : prior.appliedAtUtcMs,
        reversedAtUtcMs: null,
      });
      due -= cover;
    }
    return Result.ok({
      voucherRedemptions: [...history, ...next],
      touched,
    });
  },

  /**
   * The tip tiles for a bill of `totalCents` (the visit editor's bento): the
   * round-ups — the next whole euro, the next 5, the next 10, each while the
   * tip stays at least 20 cents and within 40 % of the bill — then up to
   * three coins (1, 2, 5, 10, 20 €) whose share of the bill falls in 3–50 %,
   * never an amount a round-up already is. None when the total is unknown or
   * not positive.
   */
  tipPresets(totalCents: PriceCents | null): readonly TipPresetOption[] {
    if (totalCents === null || totalCents <= 0) return [];
    const total: number = totalCents;
    const roundUps: TipPresetOption[] = [];
    const coins: TipPresetOption[] = [];
    const seen: number[] = [];
    for (let i = 0; i < TIP_ROUND_UP_STEPS.length; i++) {
      const step = TIP_ROUND_UP_STEPS[i] as number;
      const target = Math.ceil(total / step) * step;
      const tip = target - total;
      if (
        tip < TIP_ROUND_UP_MIN_CENTS ||
        tip > total * TIP_ROUND_UP_MAX_SHARE ||
        seen.includes(tip)
      ) {
        continue;
      }
      seen.push(tip);
      roundUps.push({
        tipPreset: TipPreset.RoundUp,
        amountCents: cents(tip),
        targetCents: cents(target),
      });
    }
    for (let i = 0; i < TIP_FIXED_CENTS.length; i++) {
      if (coins.length >= TIP_FIXED_SLOTS) break;
      const amount = TIP_FIXED_CENTS[i] as number;
      const share = amount / total;
      if (share < TIP_FIXED_MIN_SHARE || share > TIP_FIXED_MAX_SHARE) continue;
      if (seen.includes(amount)) continue;
      seen.push(amount);
      coins.push({
        tipPreset: TipPreset.Coin,
        amountCents: cents(amount),
        targetCents: null,
      });
    }
    return [...roundUps, ...coins];
  },
} as const;
