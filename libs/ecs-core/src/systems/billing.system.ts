import {
  AppliedDiscount,
  AuditAction,
  BillPending,
  type BookingCall,
  BookingLifecycle,
  Combinability,
  CouponValue,
  DiscountMethod,
  DiscountProvenance,
  DiscountSource,
  type Money,
  Roles,
  Seat,
  type TipAction,
  TipPreset,
  VoucherCode,
  VoucherRedemption,
} from '@core/components';
import {
  Result,
  type BookingStatus,
  type Currency,
  AppliedDiscountId,
  type CouponGrantId,
  type CustomerId,
  PriceCents,
  type SeatId,
  type UtcEpochMs,
} from '@core/primitives';
import {
  SchedulingError,
  StaffEditError,
  type StaffEditForbidden,
  type StaffEditInvalidCommand,
} from '@core/errors';
import type { Appointment, GiftVoucher } from '@core/entities';
import type { ResolvedGrant } from './coupon-grant.system';
import {
  type DiscountBreakdown,
  type DiscountInput,
  type DiscountLine,
  DiscountSystem,
  type ResolvedCode,
} from './discount.system';
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

/** One drafted discount and what it took off this bill — zero when it took nothing. */
export type DraftBillLine = {
  readonly id: AppliedDiscountId;
  readonly amountCents: PriceCents;
};

/**
 * A bill being DRAFTED (the visit editor's sheet and dock): every figure in
 * the subtotal's currency, the voucher arrays in the order the vouchers were
 * given. With no subtotal there is no total and nothing to cover: every line
 * and cover is zero, and `totalCents` / `balanceDueCents` are `null`.
 */
export type DraftBill = {
  /** EVERY drafted discount in the evaluator's total order, zeros kept. */
  readonly lines: readonly DraftBillLine[];
  /** What the discounts took off together. */
  readonly discountTotalCents: PriceCents;
  /** What the party owes after the discounts; `null` with no subtotal. */
  readonly totalCents: PriceCents | null;
  /** What each voucher covers — what the discounts and the vouchers before it left, never more than it has. */
  readonly covers: readonly PriceCents[];
  /** What each voucher still holds after its cover. */
  readonly left: readonly PriceCents[];
  /** What the vouchers cover together. */
  readonly voucherTotalCents: PriceCents;
  /** What still changes hands: the total less the covers, never below zero; `null` with no subtotal. */
  readonly balanceDueCents: PriceCents | null;
  /** What came off altogether: the lines' amounts and the covers. */
  readonly takenCents: PriceCents;
};

/** The lifecycle slice a release reads — a whole appointment passes (Law 3). */
export type HoldingsStatus = { readonly bookingStatus: BookingStatus };

/** The seat slice a tip sum reads — a whole seat passes (Law 3). */
export type SeatTip = Pick<Seat, 'tipCents' | 'currency'>;

/** A tip that changes a seat: the seats rewritten with it, and the act's audit verb. */
export type RecordedTip = {
  readonly seats: readonly Seat[];
  readonly auditAction: TipAction;
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

/**
 * A typed manual figure → a coupon value in the visit's currency, or `null`
 * where its guards refuse it: a whole percent 1–100
 * (`CouponValue.manualPercentOff`, the callable edge's rule — DEP-6), or a
 * positive whole amount of cents.
 */
function manualValue(
  raw: ManualDiscountValue,
  currency: Currency,
): CouponValue | null {
  if (raw.discountMethod === DiscountMethod.PercentOff) {
    const percent = CouponValue.manualPercentOff(raw.discountPercent);
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

/** A voucher a batch names, with the live line this visit already drew on it (and that draw). */
type VoucherDrawer = {
  readonly voucher: GiftVoucher;
  readonly prior: VoucherRedemption | null;
  readonly previous: Money;
};

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
   * A staff batch's discounts as the settle reads them
   * (`edit-appointment.pipeline.ts`'s pending items): `null` — the batch
   * said nothing — keeps the stored set; otherwise every request in order,
   * a grant with the FIRST of `resolvedGrants` naming its id (`null` when
   * none does), a code with the first of `resolvedCodes` matched on it
   * (`null` when none), a manual figure as typed — a fixed amount stamped
   * in `currency`, the visit's (its first seat's).
   */
  pendingDiscounts(
    requests: readonly BookingCall.StaffDiscount[] | null,
    resolvedGrants: readonly ResolvedGrant[],
    resolvedCodes: readonly ResolvedCode[],
    currency: Currency,
  ): PendingDiscounts {
    if (requests === null) return { billPending: BillPending.Keep };
    const items: PendingDiscount[] = [];
    for (let i = 0; i < requests.length; i++) {
      const request = requests[i] as BookingCall.StaffDiscount;
      switch (request.discountSource) {
        case DiscountSource.Grant: {
          let resolved: ResolvedGrant | null = null;
          for (let k = 0; k < resolvedGrants.length && resolved === null; k++) {
            const grant = resolvedGrants[k] as ResolvedGrant;
            if (grant.grantId === request.grantId) resolved = grant;
          }
          items.push({
            discountSource: DiscountSource.Grant,
            grantId: request.grantId,
            resolved,
          });
          break;
        }
        case DiscountSource.Code: {
          let resolved: ResolvedCode | null = null;
          for (let k = 0; k < resolvedCodes.length && resolved === null; k++) {
            const code = resolvedCodes[k] as ResolvedCode;
            if (code.code === request.code) resolved = code;
          }
          items.push({
            discountSource: DiscountSource.Code,
            code: request.code,
            resolved,
          });
          break;
        }
        default:
          items.push({
            discountSource: DiscountSource.Manual,
            value:
              request.discountMethod === DiscountMethod.PercentOff
                ? {
                    discountMethod: DiscountMethod.PercentOff,
                    discountPercent: request.discountPercent,
                  }
                : {
                    discountMethod: DiscountMethod.FixedAmount,
                    discountAmountCents: request.discountAmountCents,
                    discountCurrency: currency,
                  },
          });
      }
    }
    return { billPending: BillPending.Set, items };
  },

  /**
   * The bill's discounts after a staff batch (`settleDiscounts`): the stored
   * ones carried forward (`KEEP`), or the named set, each item KEPT as
   * stored (the same grant, the same code, the same manual figure — a
   * promise once kept is not withdrawn by a coupon retired since) or NEW, a
   * snapshot stamped `nowUtcMs`. A NEW grant must be the owner's own (the
   * visit's `ownerCustomerId`, D29) and still usable — refused as `grant`
   * otherwise (OR-13); a new code must have opened a coupon; a NEW manual
   * figure needs a role that handles money (`FORBIDDEN` otherwise — keeping one
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
          // A grant that no longer applies — not found, spent, expired, or
          // another client's — is its own answer (OR-13): `grant`.
          const grant = item.resolved;
          if (
            grant === null ||
            !grant.usable ||
            ownerCustomerId === null ||
            ownerCustomerId !== grant.customerId
          ) {
            return invalid('grant');
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
          if (!Roles.seesMoney(actorRoles)) {
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
    if (manualCount > 1 || !AppliedDiscount.isLegalSelection(settled)) {
      return invalid('discounts');
    }
    return Result.ok(settled);
  },

  /**
   * Does this move give the visit's holdings back — its voucher draws to
   * their balances and its coupon grants to the wallet (OR-13, DEP-F10b)?
   * The ONE predicate both give-backs read (`VoucherSystem.restorePlan`,
   * `CouponGrantSystem.releasePlan`): value the client holds is consumed
   * only by a visit that happened, so the move releases when it ENDS the
   * visit cancelled or no-show from a status that did not
   * (`BookingLifecycle.didNotHappen`). A completed visit keeps what it
   * spent; a reopen releases nothing and re-burns nothing (the barber
   * re-adds the reward or the voucher), and a cancelled visit marked
   * no-show, or the reverse, gives nothing back twice.
   */
  releasesHoldings(before: HoldingsStatus, after: HoldingsStatus): boolean {
    return (
      BookingLifecycle.didNotHappen(after) &&
      !BookingLifecycle.didNotHappen(before)
    );
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
        const back = VoucherSystem.settle(voucher, prior, zero);
        if (!back.ok) return invalid('vouchers');
        setTouched(touched, back.value);
      }
      history.push(VoucherRedemption.reversed(prior, nowUtcMs));
    }

    // 2. Cover the bill in order: each named voucher found and allowed
    // first, then the one in-order cascade over what each may draw (its
    // balance and what this visit already drew on it), then each draw
    // settled. Every refusal on the way is the same `vouchers` answer.
    const drawers: VoucherDrawer[] = [];
    const available: PriceCents[] = [];
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
      const previous: Money = prior === null ? zero : prior;
      drawers.push({ voucher, prior, previous });
      available.push(cents(voucher.balanceCents + previous.amountCents));
    }
    const { covers } = VoucherSystem.cascade(available, total);
    const next: VoucherRedemption[] = [];
    for (let i = 0; i < drawers.length; i++) {
      const { voucher, prior, previous } = drawers[i] as VoucherDrawer;
      const cover = covers[i] as Money;
      const settled = VoucherSystem.settle(voucher, previous, cover);
      if (!settled.ok) return invalid('vouchers');
      setTouched(touched, settled.value);
      if (cover.amountCents === 0) {
        if (prior !== null) {
          history.push(VoucherRedemption.reversed(prior, nowUtcMs));
        }
        continue;
      }
      next.push({
        voucherId: voucher.id,
        code: voucher.code,
        amountCents: cover.amountCents,
        balanceAfterCents: settled.value.balanceCents,
        currency,
        appliedAtUtcMs: prior === null ? nowUtcMs : prior.appliedAtUtcMs,
        reversedAtUtcMs: null,
      });
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

  /**
   * A bill being DRAFTED (the visit editor's `evaluate`, voucher lines, dock
   * figure, «what came off» and «nothing left to cover»): every discount
   * through the one evaluator ({@link DiscountSystem.apply}, uncapped), each
   * listed in its total order ({@link DiscountSystem.ordered}) with what it
   * took off — a line the evaluator dropped (a zero) kept at zero — then the
   * vouchers' in-order cascade over the total ({@link VoucherSystem.cascade}):
   * `voucherAvailable` is what each voucher may draw, in the subtotal's
   * currency. With no subtotal (`null`) there is no total: every line and
   * cover is zero and nothing is due (`null`).
   */
  draftBill(
    subtotal: Money | null,
    discounts: readonly DiscountInput[],
    voucherAvailable: readonly PriceCents[],
  ): DraftBill {
    const breakdown =
      subtotal === null
        ? null
        : DiscountSystem.apply(subtotal, discounts, null);
    const amounts = new Map<AppliedDiscountId, PriceCents>();
    if (breakdown !== null) {
      for (let i = 0; i < breakdown.lines.length; i++) {
        const line = breakdown.lines[i] as DiscountLine;
        amounts.set(line.id, line.amountCents);
      }
    }
    const ordered = DiscountSystem.ordered(discounts);
    const lines: DraftBillLine[] = [];
    let taken = 0;
    for (let i = 0; i < ordered.length; i++) {
      const id = (ordered[i] as DiscountInput).id;
      const amountCents = amounts.get(id) ?? PriceCents.ZERO;
      lines.push({ id, amountCents });
      taken += amountCents;
    }
    if (subtotal === null || breakdown === null) {
      const covers: PriceCents[] = [];
      for (let i = 0; i < voucherAvailable.length; i++) {
        covers.push(PriceCents.ZERO);
      }
      return {
        lines,
        discountTotalCents: PriceCents.ZERO,
        totalCents: null,
        covers,
        left: [...voucherAvailable],
        voucherTotalCents: PriceCents.ZERO,
        balanceDueCents: null,
        takenCents: cents(taken),
      };
    }
    const cascade = VoucherSystem.cascade(
      voucherAvailable,
      figure(breakdown.totalCents, subtotal.currency),
    );
    const covers: PriceCents[] = [];
    const left: PriceCents[] = [];
    for (let i = 0; i < cascade.covers.length; i++) {
      covers.push((cascade.covers[i] as Money).amountCents);
      left.push((cascade.left[i] as Money).amountCents);
    }
    const voucherTotal = PriceCents.sum(covers);
    return {
      lines,
      discountTotalCents: breakdown.discountTotalCents,
      totalCents: breakdown.totalCents,
      covers,
      left,
      voucherTotalCents: voucherTotal,
      balanceDueCents: cascade.dueAfter.amountCents,
      takenCents: cents(taken + voucherTotal),
    };
  },

  /**
   * A typed manual figure held to what the bill can take (the visit
   * editor's `cappedFigure`): a percent past 100 is 100; an amount past the
   * subtotal is the subtotal, when there is one (`null` = no amount cap) and
   * it is in the amount's currency. A figure within the cap comes back as
   * it is — the same value — so the caller keeps what was typed.
   */
  capManual(
    value: ManualDiscountValue,
    subtotal: Money | null,
  ): ManualDiscountValue {
    if (value.discountMethod === DiscountMethod.PercentOff) {
      return value.discountPercent > 100
        ? { discountMethod: DiscountMethod.PercentOff, discountPercent: 100 }
        : value;
    }
    return subtotal !== null &&
      subtotal.currency === value.discountCurrency &&
      value.discountAmountCents > subtotal.amountCents
      ? {
          discountMethod: DiscountMethod.FixedAmount,
          discountAmountCents: subtotal.amountCents,
          discountCurrency: value.discountCurrency,
        }
      : value;
  },

  /**
   * The seats' recorded tips summed STRICTLY (the staff day's `dayTips`):
   * `null` when no seat has a tip recorded — "not recorded" is not zero —
   * and `null` too when a second currency appears (a mixed-currency day is
   * a data error, not a figure). Not {@link tipsOf}, which sums one given
   * currency and skips the rest.
   */
  recordedTipsTotal(seats: readonly SeatTip[]): Money | null {
    let currency: Currency | null = null;
    let total = 0;
    for (let i = 0; i < seats.length; i++) {
      const seat = seats[i] as SeatTip;
      if (seat.tipCents === null) continue;
      if (currency === null) currency = seat.currency;
      else if (seat.currency !== currency) return null;
      total += seat.tipCents;
    }
    return currency === null ? null : figure(total, currency);
  },

  /**
   * One seat's tip set to `tipCents` (`record-seat-tip.pipeline.ts`; `null`
   * clears it — "not recorded", never zero): no such seat is refused
   * (`SCHEDULING_APPOINTMENT_UNKNOWN_SEAT`); the same figure again is no
   * change (`null` — a retried call writes nothing); otherwise the seats
   * with that one field changed and the act's verb — recorded, or cleared.
   */
  recordTip(
    appointment: Pick<Appointment, 'seats'>,
    seatId: SeatId,
    tipCents: PriceCents | null,
  ): Result<RecordedTip | null, SchedulingError.AppointmentUnknownSeat> {
    let index = -1;
    for (let i = 0; i < appointment.seats.length && index < 0; i++) {
      if ((appointment.seats[i] as Seat).seatId === seatId) index = i;
    }
    if (index < 0) {
      return Result.err(SchedulingError.appointmentUnknownSeat(seatId));
    }
    if ((appointment.seats[index] as Seat).tipCents === tipCents) {
      return Result.ok(null);
    }
    const seats: Seat[] = [];
    for (let i = 0; i < appointment.seats.length; i++) {
      const each = appointment.seats[i] as Seat;
      seats.push(i === index ? Seat.withTip(each, tipCents) : each);
    }
    return Result.ok({
      seats,
      auditAction:
        tipCents === null
          ? AuditAction.BookingTipCleared
          : AuditAction.BookingTipRecorded,
    });
  },
} as const;
