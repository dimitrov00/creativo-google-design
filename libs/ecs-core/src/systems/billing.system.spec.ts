import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type AppliedDiscount,
  AuditAction,
  type BookingCall,
  Combinability,
  CouponValue,
  DiscountMethod,
  DiscountSource,
  type Money,
  Seat,
  ServiceTerms,
  VoucherCode,
  VoucherRedemption,
  VoucherLifecycle,
} from '@core/components';
import {
  Currency,
  DurationMinutes,
  AppliedDiscountId,
  CouponGrantId,
  CouponId,
  GiftVoucherId,
  SeatId,
  UserId,
  PriceCents,
  UtcEpochMs,
} from '@core/primitives';
import { SchedulingErrorCode, StaffEditErrorCode } from '@core/errors';
import type { Appointment, GiftVoucher } from '@core/entities';
import {
  FIXTURE_NOW_UTC_MS,
  deepFreeze,
  minute,
  unwrapErr,
  unwrapOk,
  utcMs,
  appointmentFixture,
  seatFixture,
  customerOf,
} from '@core/testing';
import { AppointmentLifecycleSystem } from './appointment-lifecycle.system';
import type { ResolvedGrant } from './coupon-grant.system';
import type { DiscountInput, ResolvedCode } from './discount.system';
import {
  BillPending,
  BillingSystem,
  type ManualDiscountValue,
  type PendingDiscount,
  type PendingDiscounts,
  type PendingVouchers,
  TipPreset,
} from './billing.system';

/*
 * The bill cases of the legacy scheduling `applied-discount.spec.ts` (an
 * appointment's discounts and voucher lines), the subtotal case of the legacy
 * `appointment.spec.ts` (both deleted in Phase 4b; ledger
 * `docs/architecture/flips/phase-4b-delete.md` §11.1), and the bill's math of
 * apps/functions/src/use-cases/staff-edit-appointment.use-case.spec.ts («the
 * discounts on the bill», «the vouchers paying the bill») — the callable's
 * write re-targeted to the settle it decides with. Copied while the originals
 * still ran against their shims.
 */

/** 09:00 on the fixture shop's today. */
const NOW = FIXTURE_NOW_UTC_MS;
/** The visit owner's client record (D29) — what a new grant must belong to. */
const OWNER = customerOf(UserId.of('user-owner'));

const plus = (base: UtcEpochMs, ms: number): UtcEpochMs =>
  UtcEpochMs.plusMs(base, ms);

function cents(minor: number): PriceCents {
  return unwrapOk(PriceCents.of(minor));
}

function money(minor: number, currency: Currency): Money {
  return { amountCents: cents(minor), currency };
}

function eur(minor: number): Money {
  return money(minor, Currency.EUR);
}

function seat(
  priceCents: number,
  startHour: number,
  id = `s${startHour}`,
  currency: Currency = Currency.EUR,
): Seat {
  return seatFixture({
    seatId: SeatId.of(id),
    terms: Seat.termsOf(
      ServiceTerms.unpadded(
        cents(priceCents),
        currency,
        unwrapOk(DurationMinutes.of(30)),
      ),
      null,
    ),
    startMinutes: minute(startHour * 60),
  });
}

/** A 20,00 € cut and an 8,00 € beard, confirmed. */
function visit(
  discounts: readonly AppliedDiscount[] = [],
  voucherRedemptions: readonly VoucherRedemption[] = [],
): Appointment {
  return appointmentFixture({
    seats: [seat(2000, 10), seat(800, 11)],
    discounts,
    voucherRedemptions,
  });
}

function percent(value: number): CouponValue {
  return unwrapOk(CouponValue.percentOff(value));
}

function fixed(minor: number): CouponValue {
  return unwrapOk(CouponValue.fixedAmount(cents(minor), Currency.EUR));
}

const birthday: AppliedDiscount = {
  discountId: AppliedDiscountId.of('grant:grant-1'),
  discountSource: DiscountSource.Grant,
  label: 'Рожден ден',
  discountGrantId: CouponGrantId.of('grant-1'),
  appliedAtUtcMs: NOW,
  combinability: Combinability.Stackable,
  ...percent(20),
};

function evaluate(appointment: Appointment) {
  return unwrapOk(BillingSystem.evaluate(appointment));
}

describe('BillingSystem — an appointment’s discounts', () => {
  it('sums the seats’ own snapshotted prices', () => {
    expect(
      unwrapOk(BillingSystem.subtotalOf([seat(1450, 10), seat(1000, 11)])),
    ).toEqual(eur(2450));
  });

  it('is empty by default, and then the total is the subtotal', () => {
    const bill = evaluate(visit());
    expect(bill.subtotalCents).toBe(2800);
    expect(bill.totalCents).toBe(2800);
    expect(bill.currency).toBe('EUR');
    expect(bill.breakdown.lines).toEqual([]);
  });

  it('takes the discount off the bill through the one evaluator', () => {
    const bill = evaluate(visit([birthday]));
    expect(bill.breakdown.subtotalCents).toBe(2800);
    expect(bill.breakdown.discountTotalCents).toBe(560);
    expect(bill.breakdown.totalCents).toBe(2240);
    expect(bill.breakdown.lines.map((line) => line.label)).toEqual([
      'Рожден ден',
    ]);
    expect(bill.totalCents).toBe(2240);
  });

  it('clamps a fixed amount at the bill and a free service zeroes it', () => {
    const generous: AppliedDiscount = {
      discountId: AppliedDiscountId.of('manual'),
      discountSource: DiscountSource.Manual,
      label: 'manual',
      appliedAtUtcMs: NOW,
      combinability: Combinability.Stackable,
      ...fixed(5000),
    };
    expect(evaluate(visit([generous])).totalCents).toBe(0);
    const free: AppliedDiscount = {
      ...birthday,
      discountId: AppliedDiscountId.of('grant:grant-2'),
      discountGrantId: CouponGrantId.of('grant-2'),
      ...CouponValue.freeService(),
    };
    expect(evaluate(visit([free])).totalCents).toBe(0);
  });

  it('survives every lifecycle move and can be replaced whole', () => {
    const discounted = visit([birthday]);
    const completed = unwrapOk(
      AppointmentLifecycleSystem.complete(discounted, NOW),
    );
    expect(completed.appointment.discounts).toHaveLength(1);
    expect(evaluate(completed.appointment).totalCents).toBe(2240);
    const cleared = { ...discounted, discounts: [] };
    expect(evaluate(cleared).totalCents).toBe(2800);
    expect(discounted.discounts).toHaveLength(1);
  });

  it("stacks on the running remainder, in the evaluator's order", () => {
    const stackable: AppliedDiscount = {
      discountId: AppliedDiscountId.of('code:first10'),
      discountSource: DiscountSource.Code,
      label: 'Първо посещение',
      discountCode: VoucherCode.of('FIRST10'),
      appliedAtUtcMs: NOW,
      combinability: Combinability.Stackable,
      ...percent(10),
    };
    const five: AppliedDiscount = {
      ...stackable,
      discountId: AppliedDiscountId.of('code:beard5'),
      label: 'Брада −5 €',
      discountCode: VoucherCode.of('BEARD5'),
      appliedAtUtcMs: plus(NOW, 60_000),
      ...fixed(500),
    };
    const bill = evaluate(visit([stackable, five]));
    expect(bill.breakdown.lines.map((line) => line.amountCents)).toEqual([
      500, 230,
    ]);
    expect(bill.totalCents).toBe(2070);
  });

  it('refuses a bill with no seats, or seats in two currencies', () => {
    expect(unwrapErr(BillingSystem.subtotalOf([])).errorCode).toBe(
      SchedulingErrorCode.AppointmentEmptySeats,
    );
    const usd = seat(100, 12, 's12', Currency.USD);
    expect(unwrapErr(BillingSystem.subtotalOf([seat(100, 10), usd]))).toEqual({
      errorCode: SchedulingErrorCode.AppointmentMixedCurrency,
      expected: 'EUR',
      found: 'USD',
    });
  });
});

const redemption: VoucherRedemption = {
  voucherId: GiftVoucherId.of('v1'),
  code: VoucherCode.of('GIFT2025'),
  amountCents: cents(1000),
  balanceAfterCents: cents(1500),
  currency: Currency.EUR,
  appliedAtUtcMs: NOW,
  reversedAtUtcMs: null,
};

describe('BillingSystem — the vouchers on an appointment', () => {
  it('pays the bill without changing the price', () => {
    const bill = evaluate(visit([birthday], [redemption]));
    expect(bill.totalCents).toBe(2240);
    expect(bill.redeemedCents).toBe(1000);
    expect(bill.balanceDueCents).toBe(1240);
  });

  it('keeps a reversed line as history that counts for nothing', () => {
    const reversed = VoucherRedemption.reversed(redemption, plus(NOW, 1));
    expect(VoucherRedemption.isLive(reversed)).toBe(false);
    const paid = visit([], [reversed]);
    const bill = evaluate(paid);
    expect(bill.redeemedCents).toBe(0);
    expect(bill.balanceDueCents).toBe(2800);
    // History, not deletion: the visit still holds the line, and a save that
    // never mentions vouchers carries it forward untouched.
    expect(paid.voucherRedemptions).toHaveLength(1);
    const carried = unwrapOk(
      BillingSystem.settleVouchers(
        { billPending: BillPending.Keep },
        paid.voucherRedemptions,
        eur(bill.totalCents),
        [],
        NOW,
      ),
    );
    expect(carried.voucherRedemptions).toEqual([reversed]);
    expect(carried.touched).toEqual([]);
  });

  it('never owes less than nothing, and survives the lifecycle', () => {
    const generous = { ...redemption, amountCents: cents(5000) };
    const paid = visit([], [generous]);
    expect(evaluate(paid).balanceDueCents).toBe(0);
    const completed = unwrapOk(AppointmentLifecycleSystem.complete(paid, NOW));
    expect(completed.appointment.voucherRedemptions).toHaveLength(1);
  });

  it('counts the tips the seats recorded — a null tip is not zero', () => {
    expect(evaluate(visit()).tipsCents).toBeNull();
    const tipped = {
      ...visit(),
      seats: [
        Seat.withTip(seat(2000, 10), cents(0)),
        Seat.withTip(seat(800, 11), cents(200)),
      ],
    };
    expect(evaluate(tipped).tipsCents).toBe(200);
    const zero = {
      ...visit(),
      seats: [Seat.withTip(seat(2000, 10), cents(0))],
    };
    expect(evaluate(zero).tipsCents).toBe(0);
  });

  it('balance due + redeemed never exceeds the total, and never goes negative (property)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            amount: fc.integer({ min: 0, max: 6000 }),
            reversed: fc.boolean(),
          }),
          { maxLength: 4 },
        ),
        (lines) => {
          const bill = evaluate(
            visit(
              [],
              lines.map((entry) => ({
                ...redemption,
                amountCents: cents(entry.amount),
                reversedAtUtcMs: entry.reversed ? NOW : null,
              })),
            ),
          );
          expect(bill.balanceDueCents).toBeGreaterThanOrEqual(0);
          expect(bill.balanceDueCents).toBe(
            Math.max(0, bill.totalCents - bill.redeemedCents),
          );
        },
      ),
    );
  });
});

/* ── The discounts a staff save settles (settleDiscounts) ─────────────── */

const grants: ReadonlyMap<string, ResolvedGrant> = new Map(
  Object.entries({
    'grant-1': {
      grantId: CouponGrantId.of('grant-1'),
      customerId: OWNER,
      label: 'Рожден ден',
      usable: true,
      exclusive: true,
      ...percent(20),
    },
    'grant-loyal': {
      grantId: CouponGrantId.of('grant-loyal'),
      customerId: OWNER,
      label: 'Постоянен клиент',
      usable: true,
      exclusive: false,
      ...percent(5),
    },
    'grant-spent': {
      grantId: CouponGrantId.of('grant-spent'),
      customerId: OWNER,
      label: 'Рожден ден',
      usable: false,
      exclusive: true,
      ...percent(20),
    },
    'grant-other': {
      grantId: CouponGrantId.of('grant-other'),
      customerId: customerOf(UserId.of('user-2')),
      label: 'Чужд',
      usable: true,
      exclusive: true,
      ...percent(20),
    },
  }),
);

const codes: ReadonlyMap<string, ResolvedCode> = new Map(
  Object.entries({
    FIRST10: {
      couponId: CouponId.of('coupon-first10'),
      label: 'Първо посещение',
      code: VoucherCode.of('FIRST10'),
      exclusive: false,
      ...percent(10),
    },
    BEARD5: {
      couponId: CouponId.of('coupon-beard5'),
      label: 'Брада −5 €',
      code: VoucherCode.of('BEARD5'),
      exclusive: false,
      ...fixed(500),
    },
    SOLO: {
      couponId: CouponId.of('coupon-solo'),
      label: 'Само това',
      code: VoucherCode.of('SOLO'),
      exclusive: true,
      ...percent(15),
    },
  }),
);

const grantArm = (grantId: string): PendingDiscount => ({
  discountSource: DiscountSource.Grant,
  grantId: CouponGrantId.of(grantId),
  resolved: grants.get(grantId) ?? null,
});
const codeArm = (code: string): PendingDiscount => ({
  discountSource: DiscountSource.Code,
  code,
  resolved: codes.get(VoucherCode.normalize(code)) ?? null,
});
const manual = (percentOff: number): PendingDiscount => ({
  discountSource: DiscountSource.Manual,
  value: {
    discountMethod: DiscountMethod.PercentOff,
    discountPercent: percentOff,
  },
});
const manualAmount = (amountCents: PriceCents): PendingDiscount => ({
  discountSource: DiscountSource.Manual,
  value: {
    discountMethod: DiscountMethod.FixedAmount,
    discountAmountCents: amountCents,
    discountCurrency: Currency.EUR,
  },
});

function settle(
  items: readonly PendingDiscount[],
  roles: readonly string[],
  existing: readonly AppliedDiscount[] = [],
) {
  return BillingSystem.settleDiscounts(
    { billPending: BillPending.Set, items },
    existing,
    OWNER,
    roles,
    Currency.EUR,
    NOW,
  );
}

/** A 40,00 € fade — the use-case spec's visit. */
const FADE = eur(4000);

describe('BillingSystem.settleDiscounts — the discounts on the bill', () => {
  it('takes a manual percent off from the front desk and stores it as a snapshot', () => {
    const settled = unwrapOk(settle([manual(10)], ['receptionist']));
    expect(settled).toEqual([
      {
        discountId: 'manual',
        discountSource: 'MANUAL',
        label: 'manual',
        appliedAtUtcMs: NOW,
        combinability: 'STACKABLE',
        discountMethod: 'PERCENT_OFF',
        discountPercent: 10,
      },
    ]);
    expect(BillingSystem.totalOf(FADE, settled)).toEqual(eur(3600));
  });

  it('refuses a NEW manual figure from a barber — forbidden, not malformed — but lets him keep one the desk set', () => {
    expect(unwrapErr(settle([manual(10)], ['barber'])).errorCode).toBe(
      'BOOKING_STAFF_EDIT_FORBIDDEN',
    );
    const storedManual: AppliedDiscount = {
      discountId: AppliedDiscountId.of('manual'),
      discountSource: DiscountSource.Manual,
      label: 'manual',
      appliedAtUtcMs: plus(NOW, -3_600_000),
      combinability: Combinability.Stackable,
      ...percent(10),
    };
    expect(unwrapOk(settle([manual(10)], ['barber'], [storedManual]))).toEqual([
      storedManual,
    ]);
  });

  it("honours the client's own grant — a barber may — and refuses another client's, a spent one, or none", () => {
    const honoured = unwrapOk(settle([grantArm('grant-1')], ['barber']));
    expect(honoured[0]).toMatchObject({
      discountId: 'grant:grant-1',
      discountSource: 'GRANT',
      label: 'Рожден ден',
      discountGrantId: 'grant-1',
      discountMethod: 'PERCENT_OFF',
      discountPercent: 20,
      combinability: 'EXCLUSIVE',
    });
    for (const grantId of ['grant-other', 'grant-spent', 'grant-unknown']) {
      expect(unwrapErr(settle([grantArm(grantId)], ['barber']))).toEqual({
        errorCode: StaffEditErrorCode.InvalidCommand,
        field: 'discounts',
      });
    }
  });

  it('opens a code the shop published, however it was typed, and refuses one it did not', () => {
    const opened = unwrapOk(settle([codeArm(' first10 ')], ['barber']));
    expect(opened[0]).toMatchObject({
      discountId: 'code:coupon-first10',
      discountSource: 'CODE',
      label: 'Първо посещение',
      discountCode: 'FIRST10',
    });
    expect(opened[0]).not.toHaveProperty('discountGrantId');
    expect(unwrapErr(settle([codeArm('SUMMER')], ['barber'])).errorCode).toBe(
      'BOOKING_STAFF_EDIT_INVALID_COMMAND',
    );
  });

  it("stacks what may stack, in the evaluator's order, and refuses an exclusive coupon beside anything", () => {
    const stacked = unwrapOk(
      settle([codeArm('FIRST10'), codeArm('BEARD5'), manual(10)], ['admin']),
    );
    expect(stacked).toHaveLength(3);
    // 40,00 − 5,00 = 35,00; then 10% and 10%: 35,00 → 31,50 → 28,35.
    expect(BillingSystem.totalOf(FADE, stacked)).toEqual(eur(2835));
    for (const items of [
      [codeArm('SOLO'), codeArm('FIRST10')],
      [grantArm('grant-1'), grantArm('grant-loyal')],
      [codeArm('FIRST10'), codeArm('first10')],
      [manual(10), manual(20)],
    ]) {
      expect(unwrapErr(settle(items, ['admin'])).errorCode).toBe(
        'BOOKING_STAFF_EDIT_INVALID_COMMAND',
      );
    }
    expect(settle([codeArm('SOLO')], ['barber']).ok).toBe(true);
  });

  it('keeps a stored discount whose coupon has since been retired, and carries the set when the batch says nothing', () => {
    const stored: AppliedDiscount = {
      discountId: AppliedDiscountId.of('code:coupon-retired'),
      discountSource: DiscountSource.Code,
      label: 'Лятна промоция',
      discountCode: VoucherCode.of('SUMMER'),
      appliedAtUtcMs: plus(NOW, -3_600_000),
      combinability: Combinability.Stackable,
      ...percent(15),
    };
    expect(unwrapOk(settle([codeArm('SUMMER')], ['barber'], [stored]))).toEqual(
      [stored],
    );
    expect(
      unwrapOk(
        BillingSystem.settleDiscounts(
          { billPending: BillPending.Keep },
          [stored],
          OWNER,
          [],
          Currency.EUR,
          NOW,
        ),
      ),
    ).toEqual([stored]);
    expect(unwrapOk(settle([], ['barber'], [stored]))).toEqual([]);
  });

  it('refuses a manual figure its guards refuse — a percent past 100, a zero amount', () => {
    expect(settle([manual(140)], ['admin']).ok).toBe(false);
    expect(settle([manualAmount(cents(0))], ['admin']).ok).toBe(false);
  });
});

/* ── The vouchers a staff save settles (settleVouchers) ──────────────── */

function voucher(
  id: string,
  code: string,
  balance: number,
  options: {
    readonly initial?: number;
    readonly expiresAtUtcMs?: UtcEpochMs | null;
    readonly lifecycle?: VoucherLifecycle;
  } = {},
): GiftVoucher {
  return {
    id: GiftVoucherId.of(id),
    code: VoucherCode.of(code),
    initialValueCents: cents(options.initial ?? balance),
    balanceCents: cents(balance),
    currency: Currency.EUR,
    issuedAtUtcMs: utcMs('2026-09-28T08:00:00+03:00'),
    expiresAtUtcMs: options.expiresAtUtcMs ?? null,
    expiresLocalDate: null,
    issuedToCustomerId: null,
    holderUserId: null,
    ...(options.lifecycle ?? VoucherLifecycle.active()),
  };
}

const named = (list: readonly string[]): PendingVouchers => ({
  billPending: BillPending.Set,
  codes: list,
});

describe('BillingSystem.settleVouchers — the vouchers paying the bill', () => {
  it('draws a voucher down by what the bill needs, and records the balance it leaves', () => {
    const settled = unwrapOk(
      BillingSystem.settleVouchers(
        named([' gift2025 ']),
        [],
        FADE,
        [voucher('v1', 'GIFT2025', 2500)],
        NOW,
      ),
    );
    expect(settled.voucherRedemptions).toEqual([
      {
        voucherId: 'v1',
        code: 'GIFT2025',
        amountCents: 2500,
        balanceAfterCents: 0,
        currency: 'EUR',
        appliedAtUtcMs: NOW,
        reversedAtUtcMs: null,
      },
    ]);
    expect(settled.touched.map((v) => v.balanceCents)).toEqual([0]);
    expect(
      BillingSystem.balanceDueOf(
        FADE,
        BillingSystem.redeemedOf(settled.voucherRedemptions, Currency.EUR),
      ),
    ).toEqual(eur(1500));
  });

  it('covers in order, after the discounts, and stops at the bill', () => {
    // 40,00 − 10% = 36,00; GIFT5 pays 5,00, GIFT2025 pays 25,00, 6,00 left.
    const afterDiscounts = eur(3600);
    const settled = unwrapOk(
      BillingSystem.settleVouchers(
        named(['GIFT5', 'GIFT2025']),
        [],
        afterDiscounts,
        [voucher('v5', 'GIFT5', 500), voucher('v1', 'GIFT2025', 2500)],
        NOW,
      ),
    );
    expect(settled.voucherRedemptions.map((l) => l.amountCents)).toEqual([
      500, 2500,
    ]);
    // Both drawn vouchers end at nothing (the legacy `balance('v5')`,
    // `balance('v1')`), in the order they covered the bill.
    expect(settled.touched.map((v) => [v.id, v.balanceCents])).toEqual([
      ['v5', 0],
      ['v1', 0],
    ]);
    expect(
      BillingSystem.balanceDueOf(
        afterDiscounts,
        BillingSystem.redeemedOf(settled.voucherRedemptions, Currency.EUR),
      ),
    ).toEqual(eur(600));

    const paid = unwrapOk(
      BillingSystem.settleVouchers(
        named(['GIFT9', 'GIFT5']),
        [],
        FADE,
        [voucher('v9', 'GIFT9', 9000), voucher('v5', 'GIFT5', 500)],
        NOW,
      ),
    );
    expect(paid.voucherRedemptions).toHaveLength(1);
    expect(paid.touched.map((v) => [v.id, v.balanceCents])).toEqual([
      ['v9', 5000],
      ['v5', 500],
    ]);
  });

  it('re-settles a saved draw when the bill shrinks, and gives everything back when the voucher is dropped', () => {
    const stored: VoucherRedemption = {
      voucherId: GiftVoucherId.of('v1'),
      code: VoucherCode.of('GIFT2025'),
      amountCents: cents(2500),
      balanceAfterCents: cents(0),
      currency: Currency.EUR,
      appliedAtUtcMs: utcMs('2026-09-28T08:00:00+03:00'),
      reversedAtUtcMs: null,
    };
    const empty = voucher('v1', 'GIFT2025', 0, { initial: 2500 });
    // A reprice to 10,00 € with nothing about vouchers in the batch.
    const shrunk = unwrapOk(
      BillingSystem.settleVouchers(
        { billPending: BillPending.Keep },
        [stored],
        eur(1000),
        [empty],
        NOW,
      ),
    );
    expect(shrunk.voucherRedemptions).toEqual([
      { ...stored, amountCents: 1000, balanceAfterCents: 1500 },
    ]);
    expect(shrunk.touched.map((v) => v.balanceCents)).toEqual([1500]);

    const dropped = unwrapOk(
      BillingSystem.settleVouchers(named([]), [stored], FADE, [empty], NOW),
    );
    expect(dropped.voucherRedemptions).toEqual([
      { ...stored, reversedAtUtcMs: NOW },
    ]);
    expect(dropped.touched.map((v) => v.balanceCents)).toEqual([2500]);
  });

  it('refuses a code that opens nothing, and a voucher spent, expired or void', () => {
    const seven = utcMs('2026-09-28T07:00:00+03:00');
    const vouchers = [
      voucher('empty', 'EMPTY001', 0, { initial: 1000 }),
      voucher('late', 'LATE0001', 1000, { expiresAtUtcMs: seven }),
      voucher('gone', 'GONE0001', 1000, {
        lifecycle: VoucherLifecycle.voided(seven, 'lost'),
      }),
      voucher('ok', 'GIFT5', 500),
    ];
    for (const list of [
      ['NOPE1234'],
      ['EMPTY001'],
      ['LATE0001'],
      ['GONE0001'],
    ]) {
      expect(
        unwrapErr(
          BillingSystem.settleVouchers(named(list), [], FADE, vouchers, NOW),
        ),
      ).toEqual({
        errorCode: StaffEditErrorCode.InvalidCommand,
        field: 'vouchers',
      });
    }
  });

  it('changes nothing for a visit with no voucher and none named', () => {
    const history = { ...redemption, reversedAtUtcMs: plus(NOW, -1) };
    expect(
      unwrapOk(
        BillingSystem.settleVouchers(
          { billPending: BillPending.Keep },
          [history],
          FADE,
          [],
          NOW,
        ),
      ),
    ).toEqual({ voucherRedemptions: [history], touched: [] });
  });
});

describe('BillingSystem — the settle’s quieter paths', () => {
  it('keeps a grant the visit already holds, as stored, whatever the resolver says now', () => {
    const kept = { ...birthday, appliedAtUtcMs: plus(NOW, -1) };
    expect(
      unwrapOk(
        settle(
          [
            {
              discountSource: DiscountSource.Grant,
              grantId: CouponGrantId.of('grant-1'),
              resolved: null,
            },
          ],
          ['barber'],
          [kept],
        ),
      ),
    ).toEqual([kept]);
  });

  it('refuses a manual amount that is not a whole, non-negative count of cents', () => {
    // A negative amount is a legal signed `PriceCents`, and the bill refuses it…
    expect(
      settle([manualAmount(unwrapOk(PriceCents.signed(-5)))], ['admin']).ok,
    ).toBe(false);
    // …while a fraction or an unsafe figure never becomes `PriceCents` at all.
    for (const amount of [1.5, Number.MAX_SAFE_INTEGER + 2]) {
      expect(PriceCents.of(amount).ok).toBe(false);
      expect(PriceCents.signed(amount).ok).toBe(false);
    }
  });

  it('finds a dropped voucher by its code when its id moved, and closes a line the bill no longer needs', () => {
    const stored: VoucherRedemption = {
      voucherId: GiftVoucherId.of('old-id'),
      code: VoucherCode.of('GIFT2025'),
      amountCents: cents(1000),
      balanceAfterCents: cents(1500),
      currency: Currency.EUR,
      appliedAtUtcMs: plus(NOW, -1),
      reversedAtUtcMs: null,
    };
    const byCode = voucher('v1', 'GIFT2025', 1500, { initial: 2500 });
    const dropped = unwrapOk(
      BillingSystem.settleVouchers(named([]), [stored], FADE, [byCode], NOW),
    );
    expect(dropped.touched.map((v) => v.balanceCents)).toEqual([2500]);

    // Named, but a bill of nothing leaves it nothing to cover.
    const kept: VoucherRedemption = {
      ...stored,
      voucherId: GiftVoucherId.of('v1'),
    };
    const free = unwrapOk(
      BillingSystem.settleVouchers(
        named(['GIFT2025']),
        [kept],
        eur(0),
        [byCode],
        NOW,
      ),
    );
    expect(free.voucherRedemptions).toEqual([
      { ...kept, reversedAtUtcMs: NOW },
    ]);
  });

  it('settles one voucher twice on its running balance — touched once, last word kept', () => {
    const a: VoucherRedemption = {
      voucherId: GiftVoucherId.of('v1'),
      code: VoucherCode.of('GIFT2025'),
      amountCents: cents(500),
      balanceAfterCents: cents(0),
      currency: Currency.EUR,
      appliedAtUtcMs: plus(NOW, -1),
      reversedAtUtcMs: null,
    };
    const settled = unwrapOk(
      BillingSystem.settleVouchers(
        named([]),
        [a, { ...a, appliedAtUtcMs: plus(NOW, -2) }],
        FADE,
        [voucher('v1', 'GIFT2025', 1000, { initial: 2500 })],
        NOW,
      ),
    );
    expect(settled.touched).toHaveLength(1);
  });
});

describe('BillingSystem.tipPresets — the tip tiles', () => {
  it('offers round-ups to the next whole euro, 5 and 10, then up to three coins', () => {
    expect(BillingSystem.tipPresets(cents(2350))).toEqual([
      { tipPreset: TipPreset.RoundUp, amountCents: 50, targetCents: 2400 },
      { tipPreset: TipPreset.RoundUp, amountCents: 150, targetCents: 2500 },
      { tipPreset: TipPreset.RoundUp, amountCents: 650, targetCents: 3000 },
      { tipPreset: TipPreset.Coin, amountCents: 100, targetCents: null },
      { tipPreset: TipPreset.Coin, amountCents: 200, targetCents: null },
      { tipPreset: TipPreset.Coin, amountCents: 500, targetCents: null },
    ]);
  });

  it('skips a round-up under 20 cents or over 40% of the bill, and a coin outside 3–50%', () => {
    // 10,00 €: every round-up is zero; coins 1, 2, 5 € (5 is exactly 50%).
    expect(
      BillingSystem.tipPresets(cents(1000)).map((p) => p.amountCents),
    ).toEqual([100, 200, 500]);
    // 1,99 €: round-up to 2 € is 1 cent; to 5 € is 3,01 (over 40%).
    expect(BillingSystem.tipPresets(cents(199))).toEqual([]);
  });

  it('offers nothing for an unknown or empty bill', () => {
    expect(BillingSystem.tipPresets(null)).toEqual([]);
    expect(BillingSystem.tipPresets(cents(0))).toEqual([]);
  });

  it('never offers one amount twice (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000 }), (total) => {
        const amounts = BillingSystem.tipPresets(cents(total)).map(
          (p) => p.amountCents,
        );
        expect(new Set(amounts).size).toBe(amounts.length);
      }),
    );
  });
});

describe('BillingSystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const appointment = deepFreeze(visit([birthday], [redemption]));
    expect(BillingSystem.evaluate(appointment)).toEqual(
      BillingSystem.evaluate(appointment),
    );
    const pending: PendingDiscounts = deepFreeze({
      billPending: BillPending.Set,
      items: [codeArm('FIRST10'), manual(10)],
    });
    const once = BillingSystem.settleDiscounts(
      pending,
      [],
      OWNER,
      ['admin'],
      Currency.EUR,
      NOW,
    );
    expect(
      BillingSystem.settleDiscounts(
        pending,
        [],
        OWNER,
        ['admin'],
        Currency.EUR,
        NOW,
      ),
    ).toEqual(once);
  });
});

/* ── Pass C: the drafted bill, the typed figure's cap, tips, pending ───── */

/** A drafted discount as the editor hands it in — its key, the order it was drafted in (the instant), its value. */
function drafted(
  key: string,
  index: number,
  value: CouponValue,
): DiscountInput {
  return {
    id: AppliedDiscountId.of(key),
    label: key,
    grantedAtUtcMs: unwrapOk(UtcEpochMs.of(index)),
    minSpendCents: null,
    ...value,
  };
}

/** The editor spec's 28,00 € visit. */
const SHEET = eur(2800);

describe('BillingSystem.draftBill — the bill being drafted', () => {
  it("lists every line in the evaluator's order with what it took — the 21,85 € stack and the 22,40 € gift", () => {
    // Picked in this order; the fixed sum comes off first, then 5 % of
    // what is left: 28,00 − 5,00 = 23,00, then 1,15.
    const stack = BillingSystem.draftBill(
      SHEET,
      [
        drafted('grant:grant-loyal', 0, percent(5)),
        drafted('code:BEARD5', 1, fixed(500)),
      ],
      [],
    );
    expect(stack.lines).toEqual([
      { id: 'code:BEARD5', amountCents: 500 },
      { id: 'grant:grant-loyal', amountCents: 115 },
    ]);
    expect(stack.totalCents).toBe(2185);
    expect(stack.discountTotalCents).toBe(615);
    expect(stack.balanceDueCents).toBe(2185);
    expect(stack.takenCents).toBe(615);
    const gift = BillingSystem.draftBill(
      SHEET,
      [drafted('grant:grant-birthday', 0, percent(20))],
      [],
    );
    expect(gift.totalCents).toBe(2240);
    expect(gift.takenCents).toBe(560);
  });

  it('cascades the vouchers over the total — −10,00 / «остават 0,00», −15,20 / «остават 34,80», then −25,20 without the first', () => {
    const first10 = [drafted('code:FIRST10', 0, percent(10))];
    const one = BillingSystem.draftBill(SHEET, first10, [cents(1000)]);
    expect(one.totalCents).toBe(2520);
    expect(one.covers).toEqual([1000]);
    expect(one.left).toEqual([0]);
    expect(one.balanceDueCents).toBe(1520);
    const two = BillingSystem.draftBill(SHEET, first10, [
      cents(1000),
      cents(5000),
    ]);
    expect(two.covers).toEqual([1000, 1520]);
    expect(two.left).toEqual([0, 3480]);
    expect(two.voucherTotalCents).toBe(2520);
    // Nothing left for a third to cover.
    expect(two.balanceDueCents).toBe(0);
    // What came off together: the discount and both vouchers.
    expect(two.takenCents).toBe(2800);
    const without = BillingSystem.draftBill(SHEET, first10, [cents(5000)]);
    expect(without.covers).toEqual([2520]);
    expect(without.left).toEqual([2480]);
  });

  it('keeps a line that took nothing, at zero — a percent after a fixed sum ate the bill, a sum in another currency', () => {
    const eaten = BillingSystem.draftBill(
      SHEET,
      [
        drafted('code:FIRST10', 0, percent(10)),
        drafted('manual', 1, fixed(3000)),
      ],
      [],
    );
    expect(eaten.lines).toEqual([
      { id: 'manual', amountCents: 2800 },
      { id: 'code:FIRST10', amountCents: 0 },
    ]);
    expect(eaten.totalCents).toBe(0);
    const leva = BillingSystem.draftBill(
      SHEET,
      [
        drafted(
          'code:LEVA',
          0,
          unwrapOk(CouponValue.fixedAmount(cents(500), Currency.BGN)),
        ),
        drafted('code:FIRST10', 1, percent(10)),
      ],
      [],
    );
    expect(leva.lines).toEqual([
      { id: 'code:LEVA', amountCents: 0 },
      { id: 'code:FIRST10', amountCents: 280 },
    ]);
    expect(leva.totalCents).toBe(2520);
  });

  it('has no total and nothing to cover without a subtotal — every line and cover zero', () => {
    expect(
      BillingSystem.draftBill(
        null,
        [
          drafted('code:BEARD5', 0, fixed(500)),
          drafted('code:FIRST10', 1, percent(10)),
        ],
        [cents(1000), cents(300)],
      ),
    ).toEqual({
      lines: [
        { id: 'code:BEARD5', amountCents: 0 },
        { id: 'code:FIRST10', amountCents: 0 },
      ],
      discountTotalCents: 0,
      totalCents: null,
      covers: [0, 0],
      left: [1000, 300],
      voucherTotalCents: 0,
      balanceDueCents: null,
      takenCents: 0,
    });
    expect(BillingSystem.draftBill(SHEET, [], [])).toMatchObject({
      lines: [],
      totalCents: 2800,
      balanceDueCents: 2800,
      takenCents: 0,
    });
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const subtotal = deepFreeze(SHEET);
    const discounts = deepFreeze([
      drafted('grant:grant-loyal', 0, percent(5)),
      drafted('code:BEARD5', 1, fixed(500)),
    ]);
    const available = deepFreeze([cents(1000), cents(5000)]);
    expect(BillingSystem.draftBill(subtotal, discounts, available)).toEqual(
      BillingSystem.draftBill(subtotal, discounts, available),
    );
    expect(discounts.map((entry) => entry.id)).toEqual([
      'grant:grant-loyal',
      'code:BEARD5',
    ]);
  });
});

describe('BillingSystem.capManual — a typed figure held to what the bill can take', () => {
  const typedPercent = (discountPercent: number): ManualDiscountValue => ({
    discountMethod: DiscountMethod.PercentOff,
    discountPercent,
  });
  const typedAmount = (
    minor: number,
    currency: Currency = Currency.EUR,
  ): ManualDiscountValue => ({
    discountMethod: DiscountMethod.FixedAmount,
    discountAmountCents: cents(minor),
    discountCurrency: currency,
  });

  it('snaps a percent past 100 to 100, and keeps one within it as it is', () => {
    expect(BillingSystem.capManual(typedPercent(101), SHEET)).toEqual(
      typedPercent(100),
    );
    expect(BillingSystem.capManual(typedPercent(125), null)).toEqual(
      typedPercent(100),
    );
    const whole = typedPercent(100);
    expect(BillingSystem.capManual(whole, SHEET)).toBe(whole);
    const ten = typedPercent(10);
    expect(BillingSystem.capManual(ten, SHEET)).toBe(ten);
  });

  it('snaps an amount past the subtotal to the subtotal, and keeps one under it — or with no subtotal, or in another currency — as it is', () => {
    expect(BillingSystem.capManual(typedAmount(3500), SHEET)).toEqual(
      typedAmount(2800),
    );
    const exact = typedAmount(2800);
    expect(BillingSystem.capManual(exact, SHEET)).toBe(exact);
    const under = typedAmount(500);
    expect(BillingSystem.capManual(under, SHEET)).toBe(under);
    const unbilled = typedAmount(3500);
    expect(BillingSystem.capManual(unbilled, null)).toBe(unbilled);
    const leva = typedAmount(3500, Currency.BGN);
    expect(BillingSystem.capManual(leva, SHEET)).toBe(leva);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const value = deepFreeze(typedAmount(3500));
    const subtotal = deepFreeze(SHEET);
    expect(BillingSystem.capManual(value, subtotal)).toEqual(
      BillingSystem.capManual(value, subtotal),
    );
    expect(
      value.discountMethod === DiscountMethod.FixedAmount &&
        value.discountAmountCents,
    ).toBe(3500);
  });
});

describe('BillingSystem — the manual percent range (DEP-6: the edge rule, homed once)', () => {
  it('settles a whole percent 1–100 and refuses 0, a fraction and 101', () => {
    expect(settle([manual(1)], ['admin']).ok).toBe(true);
    expect(settle([manual(100)], ['admin']).ok).toBe(true);
    for (const refused of [0, 12.5, 101]) {
      expect(unwrapErr(settle([manual(refused)], ['admin']))).toEqual({
        errorCode: StaffEditErrorCode.InvalidCommand,
        field: 'discounts',
      });
    }
  });
});

describe("BillingSystem.recordedTipsTotal — the day's tips, strictly", () => {
  const tipped = (
    minor: number | null,
    currency: Currency = Currency.EUR,
  ): Seat =>
    Seat.withTip(
      seat(2000, 10, 's', currency),
      minor === null ? null : cents(minor),
    );

  it('sums the recorded tips, skipping a seat with none — and says nothing when none is recorded', () => {
    expect(
      BillingSystem.recordedTipsTotal([tipped(200), tipped(null), tipped(150)]),
    ).toEqual(eur(350));
    expect(BillingSystem.recordedTipsTotal([tipped(0)])).toEqual(eur(0));
    expect(
      BillingSystem.recordedTipsTotal([tipped(null), tipped(null)]),
    ).toBeNull();
    expect(BillingSystem.recordedTipsTotal([])).toBeNull();
  });

  it('refuses a figure across two currencies — unlike tipsOf, which skips the other one', () => {
    const mixed = [tipped(200), tipped(500, Currency.BGN)];
    expect(BillingSystem.recordedTipsTotal(mixed)).toBeNull();
    expect(BillingSystem.tipsOf(mixed, Currency.EUR)).toEqual(eur(200));
    // A seat in another currency without a tip names no currency.
    expect(
      BillingSystem.recordedTipsTotal([
        tipped(null, Currency.BGN),
        tipped(300),
      ]),
    ).toEqual(eur(300));
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const seats = deepFreeze([tipped(200), tipped(150)]);
    expect(BillingSystem.recordedTipsTotal(seats)).toEqual(
      BillingSystem.recordedTipsTotal(seats),
    );
  });
});

describe("BillingSystem.recordTip — one seat's tip", () => {
  const S10 = SeatId.of('s10');

  it('refuses a seat the visit does not have', () => {
    expect(
      unwrapErr(
        BillingSystem.recordTip(visit(), SeatId.of('nope'), cents(200)),
      ),
    ).toEqual({
      errorCode: SchedulingErrorCode.AppointmentUnknownSeat,
      seatId: 'nope',
    });
  });

  it('records a tip on that seat alone, as BOOKING_TIP_RECORDED', () => {
    const appointment = visit();
    const recorded = unwrapOk(
      BillingSystem.recordTip(appointment, S10, cents(200)),
    );
    expect(recorded?.auditAction).toBe(AuditAction.BookingTipRecorded);
    expect(recorded?.seats.map((each) => each.tipCents)).toEqual([200, null]);
    expect(recorded?.seats[1]).toBe(appointment.seats[1]);
  });

  it('is no change for the same figure again — null — and clears a tip as BOOKING_TIP_CLEARED', () => {
    const tippedVisit: Appointment = {
      ...visit(),
      seats: [Seat.withTip(seat(2000, 10), cents(200)), seat(800, 11)],
    };
    expect(
      unwrapOk(BillingSystem.recordTip(tippedVisit, S10, cents(200))),
    ).toBeNull();
    expect(unwrapOk(BillingSystem.recordTip(visit(), S10, null))).toBeNull();
    const cleared = unwrapOk(BillingSystem.recordTip(tippedVisit, S10, null));
    expect(cleared?.auditAction).toBe(AuditAction.BookingTipCleared);
    expect(cleared?.seats.map((each) => each.tipCents)).toEqual([null, null]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const appointment = deepFreeze(visit());
    expect(BillingSystem.recordTip(appointment, S10, cents(300))).toEqual(
      BillingSystem.recordTip(appointment, S10, cents(300)),
    );
    expect(appointment.seats[0]?.tipCents).toBeNull();
  });
});

describe("BillingSystem.pendingDiscounts — the batch's discounts, resolved", () => {
  const resolvedGrants = [...grants.values()];
  const resolvedCodes = [...codes.values()];

  it('keeps the stored set when the batch said nothing', () => {
    expect(
      BillingSystem.pendingDiscounts(
        null,
        resolvedGrants,
        resolvedCodes,
        Currency.EUR,
      ),
    ).toEqual({ billPending: BillPending.Keep });
  });

  it("pairs each request with what was resolved for it — null where nothing was — and stamps a manual sum in the visit's currency", () => {
    const requests: readonly BookingCall.StaffDiscount[] = [
      {
        discountSource: DiscountSource.Grant,
        grantId: CouponGrantId.of('grant-loyal'),
      },
      {
        discountSource: DiscountSource.Grant,
        grantId: CouponGrantId.of('grant-unknown'),
      },
      { discountSource: DiscountSource.Code, code: VoucherCode.of('FIRST10') },
      { discountSource: DiscountSource.Code, code: VoucherCode.of('SUMMER') },
      {
        discountSource: DiscountSource.Manual,
        discountMethod: DiscountMethod.PercentOff,
        discountPercent: 10,
      },
      {
        discountSource: DiscountSource.Manual,
        discountMethod: DiscountMethod.FixedAmount,
        discountAmountCents: cents(300),
      },
    ];
    expect(
      BillingSystem.pendingDiscounts(
        requests,
        resolvedGrants,
        resolvedCodes,
        Currency.BGN,
      ),
    ).toEqual({
      billPending: BillPending.Set,
      items: [
        { ...grantArm('grant-loyal') },
        {
          discountSource: DiscountSource.Grant,
          grantId: 'grant-unknown',
          resolved: null,
        },
        { ...codeArm('FIRST10') },
        { discountSource: DiscountSource.Code, code: 'SUMMER', resolved: null },
        { ...manual(10) },
        {
          discountSource: DiscountSource.Manual,
          value: {
            discountMethod: DiscountMethod.FixedAmount,
            discountAmountCents: 300,
            discountCurrency: Currency.BGN,
          },
        },
      ],
    });
    expect(
      BillingSystem.pendingDiscounts(
        [],
        resolvedGrants,
        resolvedCodes,
        Currency.EUR,
      ),
    ).toEqual({ billPending: BillPending.Set, items: [] });
  });

  it('answers a grant named twice in what was resolved with the first', () => {
    const first = grants.get('grant-1') as ResolvedGrant;
    const second: ResolvedGrant = { ...first, label: 'Втори' };
    const pending = BillingSystem.pendingDiscounts(
      [
        {
          discountSource: DiscountSource.Grant,
          grantId: CouponGrantId.of('grant-1'),
        },
      ],
      [first, second],
      [],
      Currency.EUR,
    );
    expect(pending).toEqual({
      billPending: BillPending.Set,
      items: [
        {
          discountSource: DiscountSource.Grant,
          grantId: 'grant-1',
          resolved: first,
        },
      ],
    });
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const requests = deepFreeze([
      { discountSource: DiscountSource.Code, code: VoucherCode.of('BEARD5') },
    ] as const);
    const frozenGrants = deepFreeze(
      resolvedGrants.map((grant) => ({ ...grant })),
    );
    const frozenCodes = deepFreeze(resolvedCodes.map((code) => ({ ...code })));
    expect(
      BillingSystem.pendingDiscounts(
        requests,
        frozenGrants,
        frozenCodes,
        Currency.EUR,
      ),
    ).toEqual(
      BillingSystem.pendingDiscounts(
        requests,
        frozenGrants,
        frozenCodes,
        Currency.EUR,
      ),
    );
  });
});
