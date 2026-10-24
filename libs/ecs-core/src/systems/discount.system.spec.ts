import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type AppliedDiscount,
  Combinability,
  CouponValue,
  DiscountSource,
  type Money,
  VoucherCode,
} from '@core/components';
import {
  Currency,
  AppliedDiscountId,
  CouponGrantId,
  PriceCents,
  UtcEpochMs,
} from '@core/primitives';
import { deepFreeze, unwrapOk, utcMs } from '@core/testing';
import { type DiscountInput, DiscountSystem } from './discount.system';

/*
 * The cases of the legacy engagement `discount-application.spec.ts` (deleted
 * in Phase 4b, ledger `docs/architecture/flips/phase-4b-delete.md` §11.1),
 * copied — `grantedAtUtcMs` is an instant, `minSpendCents` is `null` when
 * ungated, the cap is `null` when none.
 */

const BASE = utcMs('2026-01-01T00:00:00+02:00');

function cents(minor: number): PriceCents {
  return unwrapOk(PriceCents.of(minor));
}

function money(minor: number, currency: Currency): Money {
  return { amountCents: cents(minor), currency };
}

function eur(major: number): Money {
  return money(Math.round(major * 100), Currency.EUR);
}

function pct(percent: number): CouponValue {
  return unwrapOk(CouponValue.percentOff(percent));
}

function fixed(major: number): CouponValue {
  return unwrapOk(
    CouponValue.fixedAmount(cents(Math.round(major * 100)), Currency.EUR),
  );
}

function input(
  id: string,
  value: CouponValue,
  opts: { minSpend?: Money; grantedAtOffset?: number } = {},
): DiscountInput {
  return {
    id: AppliedDiscountId.of(id),
    label: id,
    grantedAtUtcMs: UtcEpochMs.plusMs(
      BASE,
      (opts.grantedAtOffset ?? 0) * 60_000,
    ),
    minSpendCents: opts.minSpend?.amountCents ?? null,
    ...value,
  };
}

describe('DiscountSystem.apply — single value', () => {
  it('applies a percent off the subtotal', () => {
    const out = DiscountSystem.apply(eur(100), [input('p', pct(15))], null);
    expect(out.discountTotalCents).toBe(1500);
    expect(out.totalCents).toBe(8500);
    expect(out.lines).toHaveLength(1);
    expect(out.currency).toBe('EUR');
  });

  it('no discounts ⇒ total equals subtotal, no lines', () => {
    const out = DiscountSystem.apply(eur(42), [], null);
    expect(out.lines).toHaveLength(0);
    expect(out.discountTotalCents).toBe(0);
    expect(out.totalCents).toBe(4200);
  });
});

describe('DiscountSystem.apply — stacking order (fixed → percent on remainder)', () => {
  it('two stackable percents bite sequentially (15% then 10% ⇒ 23.5%, not 25%)', () => {
    const out = DiscountSystem.apply(
      eur(100),
      [input('a', pct(15)), input('b', pct(10))],
      null,
    );
    expect(out.lines).toHaveLength(2);
    expect(out.discountTotalCents).toBe(2350);
    expect(out.totalCents).toBe(7650);
  });

  it('a fixed amount comes off before a percentage regardless of input order', () => {
    const orderA = DiscountSystem.apply(
      eur(100),
      [input('p', pct(20)), input('f', fixed(10))],
      null,
    );
    const orderB = DiscountSystem.apply(
      eur(100),
      [input('f', fixed(10)), input('p', pct(20))],
      null,
    );
    expect(orderA.lines[0]?.id).toBe('f');
    expect(orderA.totalCents).toBe(7200);
    expect(orderB.lines[0]?.id).toBe('f');
    expect(orderB.totalCents).toBe(7200);
  });
});

describe('DiscountSystem.apply — clamping + free service', () => {
  it('a fixed amount larger than the subtotal clamps to zero, never negative', () => {
    const out = DiscountSystem.apply(eur(5), [input('f', fixed(10))], null);
    expect(out.lines[0]?.amountCents).toBe(500);
    expect(out.totalCents).toBe(0);
  });

  it('free_service zeroes the running remainder, applied after percents', () => {
    const out = DiscountSystem.apply(
      eur(100),
      [input('free', CouponValue.freeService()), input('p', pct(10))],
      null,
    );
    expect(out.lines[0]?.id).toBe('p');
    expect(out.lines[1]?.id).toBe('free');
    expect(out.totalCents).toBe(0);
  });
});

describe('DiscountSystem.apply — min-spend gating', () => {
  it('drops a discount whose min-spend the subtotal does not clear', () => {
    const out = DiscountSystem.apply(
      eur(50),
      [input('p', pct(10), { minSpend: eur(100) })],
      null,
    );
    expect(out.lines).toHaveLength(0);
  });

  it('applies a discount once the subtotal meets the min-spend', () => {
    const out = DiscountSystem.apply(
      eur(100),
      [input('p', pct(10), { minSpend: eur(100) })],
      null,
    );
    expect(out.lines).toHaveLength(1);
  });
});

describe('DiscountSystem.apply — anti-abuse cap', () => {
  it('trims trailing lines so the total discount never exceeds the cap', () => {
    const out = DiscountSystem.apply(
      eur(100),
      [input('a', pct(40)), input('b', pct(40))],
      50,
    );
    expect(out.discountTotalCents).toBe(5000);
    expect(out.totalCents).toBe(5000);
  });

  it('leaves the breakdown untouched when under the cap', () => {
    const out = DiscountSystem.apply(eur(100), [input('a', pct(10))], 50);
    expect(out.discountTotalCents).toBe(1000);
  });
});

/* ── Property-based tests (blueprint §7.4) ────────────────────────────── */

const discountArb = fc
  .record({
    method: fc.constantFrom<'percent' | 'fixed' | 'free'>(
      'percent',
      'fixed',
      'free',
    ),
    percent: fc.integer({ min: 0, max: 100 }),
    fixedMajor: fc.integer({ min: 1, max: 50 }),
    offset: fc.integer({ min: 0, max: 1000 }),
  })
  .map((r) => ({
    value:
      r.method === 'percent'
        ? pct(r.percent)
        : r.method === 'fixed'
          ? fixed(r.fixedMajor)
          : CouponValue.freeService(),
    offset: r.offset,
  }));

function toInputs(
  items: readonly { value: CouponValue; offset: number }[],
): DiscountInput[] {
  return items.map((item, index) =>
    input(`d${index}`, item.value, { grantedAtOffset: item.offset }),
  );
}

describe('DiscountSystem.apply — property tests', () => {
  it('never produces a negative total, with or without a cap', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.array(discountArb, { maxLength: 8 }),
        fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
        (subtotalMajor, items, capPercent) => {
          const out = DiscountSystem.apply(
            eur(subtotalMajor),
            toInputs(items),
            capPercent,
          );
          expect(out.totalCents).toBeGreaterThanOrEqual(0);
          expect(out.discountTotalCents).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('the cap is always respected', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.array(discountArb, { maxLength: 8 }),
        fc.integer({ min: 0, max: 100 }),
        (subtotalMajor, items, capPercent) => {
          const subtotal = eur(subtotalMajor);
          const out = DiscountSystem.apply(
            subtotal,
            toInputs(items),
            capPercent,
          );
          const maxAllowed = Math.round(
            (subtotal.amountCents * capPercent) / 100,
          );
          expect(out.discountTotalCents).toBeLessThanOrEqual(maxAllowed);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('the result is independent of the input array order', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.array(discountArb, { minLength: 1, maxLength: 8 }),
        fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
        (subtotalMajor, items, capPercent) => {
          const subtotal = eur(subtotalMajor);
          const inputs = toInputs(items);
          const shuffled = [...inputs].reverse();
          const outA = DiscountSystem.apply(subtotal, inputs, capPercent);
          const outB = DiscountSystem.apply(subtotal, shuffled, capPercent);
          expect(outB.discountTotalCents).toBe(outA.discountTotalCents);
          expect(outB.totalCents).toBe(outA.totalCents);
          expect(outB.lines.map((l) => [l.id, l.amountCents])).toEqual(
            outA.lines.map((l) => [l.id, l.amountCents]),
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it('discount and total always add up to the subtotal (no cap)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.array(discountArb, { maxLength: 8 }),
        (subtotalMajor, items) => {
          const subtotal = eur(subtotalMajor);
          const out = DiscountSystem.apply(subtotal, toInputs(items), null);
          expect(out.totalCents + out.discountTotalCents).toBe(
            subtotal.amountCents,
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});

/* ── The discounts on a visit ─────────────────────────────────────────── */

const birthday: AppliedDiscount = {
  discountId: AppliedDiscountId.of('grant:grant-1'),
  discountSource: DiscountSource.Grant,
  label: 'Рожден ден',
  discountGrantId: CouponGrantId.of('grant-1'),
  appliedAtUtcMs: BASE,
  combinability: Combinability.Stackable,
  ...pct(20),
};

describe('DiscountSystem — the discounts on a visit', () => {
  it('hands the evaluator its own shape, and compares as a promise', () => {
    expect(DiscountSystem.inputOf(birthday)).toEqual({
      id: 'grant:grant-1',
      label: 'Рожден ден',
      grantedAtUtcMs: BASE,
      minSpendCents: null,
      discountMethod: 'PERCENT_OFF',
      discountPercent: 20,
    });
    const later: AppliedDiscount = {
      ...birthday,
      appliedAtUtcMs: UtcEpochMs.plusMs(BASE, 86_400_000),
    };
    expect(DiscountSystem.samePromise(birthday, later)).toBe(true);
    const other: AppliedDiscount = { ...birthday, ...pct(10) };
    expect(DiscountSystem.samePromise(birthday, other)).toBe(false);
  });

  it('lets stackable promises share the bill and keeps an exclusive one alone', () => {
    const stackable: AppliedDiscount = {
      discountId: AppliedDiscountId.of('code:first10'),
      discountSource: DiscountSource.Code,
      label: 'Рожден ден',
      discountCode: VoucherCode.of('FIRST10'),
      appliedAtUtcMs: BASE,
      combinability: Combinability.Stackable,
      ...pct(10),
    };
    const exclusive: AppliedDiscount = {
      ...birthday,
      combinability: Combinability.Exclusive,
    };
    expect(DiscountSystem.isLegalSet([])).toBe(true);
    expect(DiscountSystem.isLegalSet([stackable, birthday])).toBe(true);
    expect(DiscountSystem.isLegalSet([exclusive])).toBe(true);
    expect(DiscountSystem.isLegalSet([exclusive, stackable])).toBe(false);
    expect(DiscountSystem.isLegalSet([stackable, stackable])).toBe(false);
  });

  it('takes one value off an amount — never more than it, zero across a currency line', () => {
    expect(DiscountSystem.amountOf(eur(10), fixed(20))).toEqual(eur(10));
    expect(
      DiscountSystem.amountOf(money(1000, Currency.BGN), fixed(5)),
    ).toEqual(money(0, Currency.BGN));
    expect(DiscountSystem.amountOf(eur(10), CouponValue.freeService())).toEqual(
      eur(10),
    );
  });
});

describe('DiscountSystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const subtotal = deepFreeze(eur(100));
    const inputs = deepFreeze([
      input('b', pct(10)),
      input('a', fixed(5)),
      input('c', pct(15), { minSpend: eur(10) }),
    ]);
    const once = DiscountSystem.apply(subtotal, inputs, 20);
    const twice = DiscountSystem.apply(subtotal, inputs, 20);
    expect(twice).toEqual(once);
    expect(inputs.map((entry) => entry.id)).toEqual(['b', 'a', 'c']);
  });
});
