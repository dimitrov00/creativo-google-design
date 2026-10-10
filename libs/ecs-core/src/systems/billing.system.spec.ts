import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type AppliedDiscount,
  AppliedDiscountSource,
} from '../components/applied-discount.data';
import { CouponCombinability } from '../components/coupon-combinability.data';
import { CouponValue, CouponValueKind } from '../components/coupon-value.data';
import type { Money } from '../components/money.data';
import { SchedulingErrorCode } from '../components/scheduling-errors.data';
import type { Seat } from '../components/seat.data';
import { ServiceTerms } from '../components/service-terms.data';
import { VoucherCode } from '../components/voucher-code.data';
import { VoucherRedemption } from '../components/voucher-redemption.data';
import { VoucherState } from '../components/voucher-state.data';
import type { AppointmentEntity } from '../entities/appointment.entity';
import { CouponGrantId } from '../entities/coupon-grant.entity';
import {
  type GiftVoucherEntity,
  GiftVoucherId,
} from '../entities/gift-voucher.entity';
import { UserId } from '../entities/user.entity';
import {
  appointmentFixture,
  deepFreeze,
  fixtureTodayAt,
  seatFixture,
  unwrapErr,
  unwrapOk,
} from '../testing';
import { AppointmentLifecycleSystem } from './appointment-lifecycle.system';
import { StaffEditErrorCode } from './appointment-edit.system';
import {
  BillPendingKind,
  BillingSystem,
  type PendingDiscount,
  type ResolvedCode,
  type ResolvedGrant,
  TipPresetKind,
} from './billing.system';

/*
 * The bill cases of libs/domain/scheduling/src/lib/applied-discount.spec.ts
 * (an appointment's discounts and voucher lines), the subtotal case of
 * appointment.spec.ts, and the bill's math of
 * apps/functions/src/use-cases/staff-edit-appointment.use-case.spec.ts
 * («the discounts on the bill», «the vouchers paying the bill») — the
 * callable's write re-targeted to the settle it decides with. Copied; the
 * originals keep running against their shims.
 */

const NOW = fixtureTodayAt(9);
const OWNER = UserId.of('user-owner');

function eur(minor: number): Money {
  return { amountMinorUnits: minor, currencyCode: 'EUR' };
}

function seat(
  priceMinorUnits: number,
  startHour: number,
  id = `s${startHour}`,
): Seat {
  return seatFixture({
    id: id as Seat['id'],
    terms: {
      ...ServiceTerms.unpadded(priceMinorUnits, 'EUR', 30),
      catalogPriceMinorUnits: null,
      catalogDurationMinutes: null,
    },
    startMs: fixtureTodayAt(startHour),
  });
}

/** A 20,00 € cut and an 8,00 € beard, confirmed. */
function visit(
  discounts: readonly AppliedDiscount[] = [],
  voucherRedemptions: readonly VoucherRedemption[] = [],
): AppointmentEntity {
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
  return unwrapOk(CouponValue.fixedAmount(eur(minor)));
}

const birthday: AppliedDiscount = {
  id: 'grant:grant-1',
  source: AppliedDiscountSource.Grant,
  value: percent(20),
  label: 'Рожден ден',
  grantId: CouponGrantId.of('grant-1'),
  code: null,
  appliedAtMs: NOW,
  combinability: CouponCombinability.stackable(),
};

function evaluate(appointment: AppointmentEntity) {
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
    expect(bill.subtotal).toEqual(eur(2800));
    expect(bill.total).toEqual(eur(2800));
    expect(bill.breakdown.lines).toEqual([]);
  });

  it('takes the discount off the bill through the one evaluator', () => {
    const bill = evaluate(visit([birthday]));
    expect(bill.breakdown.subtotal).toEqual(eur(2800));
    expect(bill.breakdown.discountTotal).toEqual(eur(560));
    expect(bill.breakdown.total).toEqual(eur(2240));
    expect(bill.breakdown.lines.map((line) => line.label)).toEqual([
      'Рожден ден',
    ]);
    expect(bill.total).toEqual(eur(2240));
  });

  it('clamps a fixed amount at the bill and a free service zeroes it', () => {
    const generous: AppliedDiscount = {
      ...birthday,
      id: 'manual',
      source: AppliedDiscountSource.Manual,
      label: 'manual',
      value: fixed(5000),
      grantId: null,
    };
    expect(evaluate(visit([generous])).total).toEqual(eur(0));
    const free: AppliedDiscount = {
      ...birthday,
      id: 'grant:grant-2',
      value: CouponValue.freeService(),
      grantId: CouponGrantId.of('grant-2'),
    };
    expect(evaluate(visit([free])).total).toEqual(eur(0));
  });

  it('survives every lifecycle move and can be replaced whole', () => {
    const discounted = visit([birthday]);
    const completed = unwrapOk(
      AppointmentLifecycleSystem.complete(discounted, NOW),
    );
    expect(completed.appointment.discounts).toHaveLength(1);
    expect(evaluate(completed.appointment).total).toEqual(eur(2240));
    const cleared = { ...discounted, discounts: [] };
    expect(evaluate(cleared).total).toEqual(eur(2800));
    expect(discounted.discounts).toHaveLength(1);
  });

  it("stacks on the running remainder, in the evaluator's order", () => {
    const stackable: AppliedDiscount = {
      ...birthday,
      id: 'code:first10',
      source: AppliedDiscountSource.Code,
      label: 'Първо посещение',
      value: percent(10),
      grantId: null,
      code: 'FIRST10',
    };
    const five: AppliedDiscount = {
      ...stackable,
      id: 'code:beard5',
      label: 'Брада −5 €',
      value: fixed(500),
      code: 'BEARD5',
      appliedAtMs: NOW + 60_000,
    };
    const bill = evaluate(visit([stackable, five]));
    expect(
      bill.breakdown.lines.map((line) => line.amount.amountMinorUnits),
    ).toEqual([500, 230]);
    expect(bill.total).toEqual(eur(2070));
  });

  it('refuses a bill with no seats, or seats in two currencies', () => {
    expect(unwrapErr(BillingSystem.subtotalOf([])).code).toBe(
      SchedulingErrorCode.AppointmentEmptySeats,
    );
    const usd = {
      ...seat(100, 12),
      terms: { ...seat(100, 12).terms, currencyCode: 'USD' },
    };
    expect(unwrapErr(BillingSystem.subtotalOf([seat(100, 10), usd]))).toEqual({
      code: SchedulingErrorCode.AppointmentMixedCurrency,
      expected: 'EUR',
      found: 'USD',
    });
  });
});

const redemption: VoucherRedemption = {
  voucherId: GiftVoucherId.of('v1'),
  code: 'GIFT2025',
  amount: eur(1000),
  balanceAfter: eur(1500),
  appliedAtMs: NOW,
  reversedAtMs: null,
};

describe('BillingSystem — the vouchers on an appointment', () => {
  it('pays the bill without changing the price', () => {
    const bill = evaluate(visit([birthday], [redemption]));
    expect(bill.total).toEqual(eur(2240));
    expect(bill.redeemed).toEqual(eur(1000));
    expect(bill.balanceDue).toEqual(eur(1240));
  });

  it('keeps a reversed line as history that counts for nothing', () => {
    const reversed = VoucherRedemption.reversed(redemption, NOW + 1);
    expect(VoucherRedemption.isLive(reversed)).toBe(false);
    const paid = visit([], [reversed]);
    const bill = evaluate(paid);
    expect(bill.redeemed).toEqual(eur(0));
    expect(bill.balanceDue).toEqual(eur(2800));
    // History, not deletion: the visit still holds the line, and a save that
    // never mentions vouchers carries it forward untouched.
    expect(paid.voucherRedemptions).toHaveLength(1);
    const carried = unwrapOk(
      BillingSystem.settleVouchers(
        { kind: BillPendingKind.Keep },
        paid.voucherRedemptions,
        bill.total,
        [],
        NOW,
      ),
    );
    expect(carried.voucherRedemptions).toEqual([reversed]);
    expect(carried.touched).toEqual([]);
  });

  it('never owes less than nothing, and survives the lifecycle', () => {
    const generous = { ...redemption, amount: eur(5000) };
    const paid = visit([], [generous]);
    expect(evaluate(paid).balanceDue).toEqual(eur(0));
    const completed = unwrapOk(AppointmentLifecycleSystem.complete(paid, NOW));
    expect(completed.appointment.voucherRedemptions).toHaveLength(1);
  });

  it('counts the tips the seats recorded — a null tip is not zero', () => {
    expect(evaluate(visit()).tips).toBeNull();
    const tipped = {
      ...visit(),
      seats: [
        { ...seat(2000, 10), tip: eur(0) },
        { ...seat(800, 11), tip: eur(200) },
      ],
    };
    expect(evaluate(tipped).tips).toEqual(eur(200));
    const zero = { ...visit(), seats: [{ ...seat(2000, 10), tip: eur(0) }] };
    expect(evaluate(zero).tips).toEqual(eur(0));
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
                amount: eur(entry.amount),
                reversedAtMs: entry.reversed ? NOW : null,
              })),
            ),
          );
          expect(bill.balanceDue.amountMinorUnits).toBeGreaterThanOrEqual(0);
          expect(bill.balanceDue.amountMinorUnits).toBe(
            Math.max(
              0,
              bill.total.amountMinorUnits - bill.redeemed.amountMinorUnits,
            ),
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
      userId: OWNER,
      label: 'Рожден ден',
      value: percent(20),
      usable: true,
      exclusive: true,
    },
    'grant-loyal': {
      grantId: CouponGrantId.of('grant-loyal'),
      userId: OWNER,
      label: 'Постоянен клиент',
      value: percent(5),
      usable: true,
      exclusive: false,
    },
    'grant-spent': {
      grantId: CouponGrantId.of('grant-spent'),
      userId: OWNER,
      label: 'Рожден ден',
      value: percent(20),
      usable: false,
      exclusive: true,
    },
    'grant-other': {
      grantId: CouponGrantId.of('grant-other'),
      userId: UserId.of('user-2'),
      label: 'Чужд',
      value: percent(20),
      usable: true,
      exclusive: true,
    },
  }),
);

const codes: ReadonlyMap<string, ResolvedCode> = new Map(
  Object.entries({
    FIRST10: {
      couponId: 'coupon-first10',
      label: 'Първо посещение',
      value: percent(10),
      code: 'FIRST10',
      exclusive: false,
    },
    BEARD5: {
      couponId: 'coupon-beard5',
      label: 'Брада −5 €',
      value: fixed(500),
      code: 'BEARD5',
      exclusive: false,
    },
    SOLO: {
      couponId: 'coupon-solo',
      label: 'Само това',
      value: percent(15),
      code: 'SOLO',
      exclusive: true,
    },
  }),
);

const grantArm = (grantId: string): PendingDiscount => ({
  source: AppliedDiscountSource.Grant,
  grantId,
  resolved: grants.get(grantId) ?? null,
});
const codeArm = (code: string): PendingDiscount => ({
  source: AppliedDiscountSource.Code,
  code,
  resolved: codes.get(VoucherCode.normalize(code)) ?? null,
});
const manual = (percentOff: number): PendingDiscount => ({
  source: AppliedDiscountSource.Manual,
  value: { kind: CouponValueKind.PercentOff, percent: percentOff },
});

function settle(
  items: readonly PendingDiscount[],
  roles: readonly string[],
  existing: readonly AppliedDiscount[] = [],
) {
  return BillingSystem.settleDiscounts(
    { kind: BillPendingKind.Set, items },
    existing,
    OWNER,
    roles,
    'EUR',
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
        id: 'manual',
        source: 'manual',
        value: { kind: 'percent_off', percent: 10 },
        label: 'manual',
        grantId: null,
        code: null,
        appliedAtMs: NOW,
        combinability: { kind: 'stackable' },
      },
    ]);
    expect(BillingSystem.totalOf(FADE, settled)).toEqual(eur(3600));
  });

  it('refuses a NEW manual figure from a barber — forbidden, not malformed — but lets him keep one the desk set', () => {
    expect(unwrapErr(settle([manual(10)], ['barber'])).code).toBe(
      'booking.staffEdit.forbidden',
    );
    const storedManual: AppliedDiscount = {
      id: 'manual',
      source: AppliedDiscountSource.Manual,
      value: percent(10),
      label: 'manual',
      grantId: null,
      code: null,
      appliedAtMs: NOW - 3_600_000,
      combinability: CouponCombinability.stackable(),
    };
    expect(unwrapOk(settle([manual(10)], ['barber'], [storedManual]))).toEqual([
      storedManual,
    ]);
  });

  it("honours the client's own grant — a barber may — and refuses another client's, a spent one, or none", () => {
    const honoured = unwrapOk(settle([grantArm('grant-1')], ['barber']));
    expect(honoured[0]).toMatchObject({
      id: 'grant:grant-1',
      source: 'grant',
      label: 'Рожден ден',
      grantId: 'grant-1',
      code: null,
      value: { kind: 'percent_off', percent: 20 },
      combinability: { kind: 'exclusive' },
    });
    for (const grantId of ['grant-other', 'grant-spent', 'grant-unknown']) {
      expect(unwrapErr(settle([grantArm(grantId)], ['barber']))).toEqual({
        code: StaffEditErrorCode.InvalidCommand,
        field: 'discounts',
      });
    }
  });

  it('opens a code the shop published, however it was typed, and refuses one it did not', () => {
    const opened = unwrapOk(settle([codeArm(' first10 ')], ['barber']));
    expect(opened[0]).toMatchObject({
      id: 'code:coupon-first10',
      source: 'code',
      label: 'Първо посещение',
      code: 'FIRST10',
      grantId: null,
    });
    expect(unwrapErr(settle([codeArm('SUMMER')], ['barber'])).code).toBe(
      'booking.staffEdit.invalid_command',
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
      expect(unwrapErr(settle(items, ['admin'])).code).toBe(
        'booking.staffEdit.invalid_command',
      );
    }
    expect(settle([codeArm('SOLO')], ['barber']).ok).toBe(true);
  });

  it('keeps a stored discount whose coupon has since been retired, and carries the set when the batch says nothing', () => {
    const stored: AppliedDiscount = {
      id: 'code:coupon-retired',
      source: AppliedDiscountSource.Code,
      value: percent(15),
      label: 'Лятна промоция',
      grantId: null,
      code: 'SUMMER',
      appliedAtMs: NOW - 3_600_000,
      combinability: CouponCombinability.stackable(),
    };
    expect(unwrapOk(settle([codeArm('SUMMER')], ['barber'], [stored]))).toEqual(
      [stored],
    );
    expect(
      unwrapOk(
        BillingSystem.settleDiscounts(
          { kind: BillPendingKind.Keep },
          [stored],
          OWNER,
          [],
          'EUR',
          NOW,
        ),
      ),
    ).toEqual([stored]);
    expect(unwrapOk(settle([], ['barber'], [stored]))).toEqual([]);
  });

  it('refuses a manual figure its guards refuse — a percent past 100, a zero amount', () => {
    expect(settle([manual(140)], ['admin']).ok).toBe(false);
    expect(
      settle(
        [
          {
            source: AppliedDiscountSource.Manual,
            value: { kind: CouponValueKind.FixedAmount, amountMinorUnits: 0 },
          },
        ],
        ['admin'],
      ).ok,
    ).toBe(false);
  });
});

/* ── The vouchers a staff save settles (settleVouchers) ──────────────── */

function voucher(
  id: string,
  code: string,
  balance: number,
  options: {
    readonly initial?: number;
    readonly expiresAtMs?: number | null;
    readonly state?: VoucherState;
  } = {},
): GiftVoucherEntity {
  return {
    id: GiftVoucherId.of(id),
    code: VoucherCode.of(code),
    initialValue: eur(options.initial ?? balance),
    balance: eur(balance),
    issuedAtMs: fixtureTodayAt(8),
    expiresAtMs: options.expiresAtMs ?? null,
    issuedToUserId: null,
    state: options.state ?? VoucherState.active(),
  };
}

const named = (list: readonly string[]) => ({
  kind: BillPendingKind.Set,
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
        amount: eur(2500),
        balanceAfter: eur(0),
        appliedAtMs: NOW,
        reversedAtMs: null,
      },
    ]);
    expect(settled.touched.map((v) => v.balance)).toEqual([eur(0)]);
    expect(
      BillingSystem.balanceDueOf(
        FADE,
        BillingSystem.redeemedOf(settled.voucherRedemptions, 'EUR'),
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
    expect(
      settled.voucherRedemptions.map((l) => l.amount.amountMinorUnits),
    ).toEqual([500, 2500]);
    // Both drawn vouchers end at nothing (the legacy `balance('v5')`,
    // `balance('v1')`), in the order they covered the bill.
    expect(
      settled.touched.map((v) => [v.id, v.balance.amountMinorUnits]),
    ).toEqual([
      ['v5', 0],
      ['v1', 0],
    ]);
    expect(
      BillingSystem.balanceDueOf(
        afterDiscounts,
        BillingSystem.redeemedOf(settled.voucherRedemptions, 'EUR'),
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
    expect(paid.touched.map((v) => [v.id, v.balance.amountMinorUnits])).toEqual(
      [
        ['v9', 5000],
        ['v5', 500],
      ],
    );
  });

  it('re-settles a saved draw when the bill shrinks, and gives everything back when the voucher is dropped', () => {
    const stored: VoucherRedemption = {
      voucherId: GiftVoucherId.of('v1'),
      code: 'GIFT2025',
      amount: eur(2500),
      balanceAfter: eur(0),
      appliedAtMs: fixtureTodayAt(8),
      reversedAtMs: null,
    };
    const empty = voucher('v1', 'GIFT2025', 0, { initial: 2500 });
    // A reprice to 10,00 € with nothing about vouchers in the batch.
    const shrunk = unwrapOk(
      BillingSystem.settleVouchers(
        { kind: BillPendingKind.Keep },
        [stored],
        eur(1000),
        [empty],
        NOW,
      ),
    );
    expect(shrunk.voucherRedemptions).toEqual([
      { ...stored, amount: eur(1000), balanceAfter: eur(1500) },
    ]);
    expect(shrunk.touched.map((v) => v.balance)).toEqual([eur(1500)]);

    const dropped = unwrapOk(
      BillingSystem.settleVouchers(named([]), [stored], FADE, [empty], NOW),
    );
    expect(dropped.voucherRedemptions).toEqual([
      { ...stored, reversedAtMs: NOW },
    ]);
    expect(dropped.touched.map((v) => v.balance)).toEqual([eur(2500)]);
  });

  it('refuses a code that opens nothing, and a voucher spent, expired or void', () => {
    const vouchers = [
      voucher('empty', 'EMPTY001', 0, { initial: 1000 }),
      voucher('late', 'LATE0001', 1000, { expiresAtMs: fixtureTodayAt(7) }),
      voucher('gone', 'GONE0001', 1000, {
        state: VoucherState.voided(fixtureTodayAt(7), 'lost'),
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
      ).toEqual({ code: StaffEditErrorCode.InvalidCommand, field: 'vouchers' });
    }
  });

  it('changes nothing for a visit with no voucher and none named', () => {
    const history = { ...redemption, reversedAtMs: NOW - 1 };
    expect(
      unwrapOk(
        BillingSystem.settleVouchers(
          { kind: BillPendingKind.Keep },
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
    const kept = { ...birthday, appliedAtMs: NOW - 1 };
    expect(
      unwrapOk(
        settle(
          [
            {
              source: AppliedDiscountSource.Grant,
              grantId: 'grant-1',
              resolved: null,
            },
          ],
          ['barber'],
          [kept],
        ),
      ),
    ).toEqual([kept]);
  });

  it('refuses a manual amount that is not a whole, non-negative count of minor units', () => {
    for (const amountMinorUnits of [-5, 1.5, Number.MAX_SAFE_INTEGER + 2]) {
      expect(
        settle(
          [
            {
              source: AppliedDiscountSource.Manual,
              value: { kind: CouponValueKind.FixedAmount, amountMinorUnits },
            },
          ],
          ['admin'],
        ).ok,
      ).toBe(false);
    }
  });

  it('finds a dropped voucher by its code when its id moved, and closes a line the bill no longer needs', () => {
    const stored: VoucherRedemption = {
      voucherId: GiftVoucherId.of('old-id'),
      code: 'GIFT2025',
      amount: eur(1000),
      balanceAfter: eur(1500),
      appliedAtMs: NOW - 1,
      reversedAtMs: null,
    };
    const byCode = voucher('v1', 'GIFT2025', 1500, { initial: 2500 });
    const dropped = unwrapOk(
      BillingSystem.settleVouchers(named([]), [stored], FADE, [byCode], NOW),
    );
    expect(dropped.touched.map((v) => v.balance)).toEqual([eur(2500)]);

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
    expect(free.voucherRedemptions).toEqual([{ ...kept, reversedAtMs: NOW }]);
  });

  it('settles one voucher twice on its running balance — touched once, last word kept', () => {
    const a: VoucherRedemption = {
      voucherId: GiftVoucherId.of('v1'),
      code: 'GIFT2025',
      amount: eur(500),
      balanceAfter: eur(0),
      appliedAtMs: NOW - 1,
      reversedAtMs: null,
    };
    const settled = unwrapOk(
      BillingSystem.settleVouchers(
        named([]),
        [a, { ...a, appliedAtMs: NOW - 2 }],
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
    expect(BillingSystem.tipPresets(2350)).toEqual([
      {
        kind: TipPresetKind.RoundUp,
        amountMinorUnits: 50,
        targetMinorUnits: 2400,
      },
      {
        kind: TipPresetKind.RoundUp,
        amountMinorUnits: 150,
        targetMinorUnits: 2500,
      },
      {
        kind: TipPresetKind.RoundUp,
        amountMinorUnits: 650,
        targetMinorUnits: 3000,
      },
      {
        kind: TipPresetKind.Coin,
        amountMinorUnits: 100,
        targetMinorUnits: null,
      },
      {
        kind: TipPresetKind.Coin,
        amountMinorUnits: 200,
        targetMinorUnits: null,
      },
      {
        kind: TipPresetKind.Coin,
        amountMinorUnits: 500,
        targetMinorUnits: null,
      },
    ]);
  });

  it('skips a round-up under 20 cents or over 40% of the bill, and a coin outside 3–50%', () => {
    // 10,00 €: every round-up is zero; coins 1, 2, 5 € (5 is exactly 50%).
    expect(
      BillingSystem.tipPresets(1000).map((p) => p.amountMinorUnits),
    ).toEqual([100, 200, 500]);
    // 1,99 €: round-up to 2 € is 1 cent; to 5 € is 3,01 (over 40%).
    expect(BillingSystem.tipPresets(199)).toEqual([]);
  });

  it('offers nothing for an unknown or empty bill', () => {
    expect(BillingSystem.tipPresets(null)).toEqual([]);
    expect(BillingSystem.tipPresets(0)).toEqual([]);
  });

  it('never offers one amount twice (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000 }), (total) => {
        const amounts = BillingSystem.tipPresets(total).map(
          (p) => p.amountMinorUnits,
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
    const pending = deepFreeze({
      kind: BillPendingKind.Set,
      items: [codeArm('FIRST10'), manual(10)],
    });
    const once = BillingSystem.settleDiscounts(
      pending,
      [],
      OWNER,
      ['admin'],
      'EUR',
      NOW,
    );
    expect(
      BillingSystem.settleDiscounts(pending, [], OWNER, ['admin'], 'EUR', NOW),
    ).toEqual(once);
  });
});
