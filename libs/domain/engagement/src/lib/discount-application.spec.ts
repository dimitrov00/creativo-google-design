import { Money, ZonedDateTime } from '@creativo/domain/kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CouponValue } from './coupon-value';
import { DiscountApplication, DiscountInput } from './discount-application';

const zone = 'Europe/Sofia';

function bgn(major: number): Money {
  const r = Money.fromMinorUnitsAndCode(Math.round(major * 100), 'BGN');
  if (r.isFailure()) throw new Error('bad fixture');
  return r.value;
}

function grantedAt(offsetMinutes: number): ZonedDateTime {
  const base = ZonedDateTime.fromISO('2026-01-01T00:00:00', zone);
  if (base.isFailure()) throw new Error('bad fixture');
  return base.value.plusMinutes(offsetMinutes);
}

function pct(percent: number): CouponValue {
  const r = CouponValue.percentOff(percent);
  if (r.isFailure()) throw new Error('bad fixture');
  return r.value;
}

function fixed(major: number): CouponValue {
  const r = CouponValue.fixedAmount(bgn(major));
  if (r.isFailure()) throw new Error('bad fixture');
  return r.value;
}

function input(
  id: string,
  value: CouponValue,
  opts: { minSpend?: Money; grantedAtOffset?: number } = {},
): DiscountInput {
  return {
    id,
    label: id,
    value,
    grantedAt: grantedAt(opts.grantedAtOffset ?? 0),
    ...(opts.minSpend !== undefined && { minSpend: opts.minSpend }),
  };
}

describe('DiscountApplication.apply — single value', () => {
  it('applies a percent off the subtotal', () => {
    const out = DiscountApplication.apply(bgn(100), [input('p', pct(15))]);
    expect(out.discountTotal.toMinorUnits()).toBe(1500);
    expect(out.total.toMinorUnits()).toBe(8500);
    expect(out.lines).toHaveLength(1);
  });

  it('no discounts ⇒ total equals subtotal, no lines', () => {
    const out = DiscountApplication.apply(bgn(42), []);
    expect(out.lines).toHaveLength(0);
    expect(out.discountTotal.toMinorUnits()).toBe(0);
    expect(out.total.toMinorUnits()).toBe(4200);
  });
});

describe('DiscountApplication.apply — stacking order (fixed → percent on remainder)', () => {
  it('two stackable percents bite sequentially (15% then 10% ⇒ 23.5%, not 25%)', () => {
    const out = DiscountApplication.apply(bgn(100), [
      input('a', pct(15)),
      input('b', pct(10)),
    ]);
    expect(out.lines).toHaveLength(2);
    expect(out.discountTotal.toMinorUnits()).toBe(2350);
    expect(out.total.toMinorUnits()).toBe(7650);
  });

  it('a fixed amount comes off before a percentage regardless of input order', () => {
    const orderA = DiscountApplication.apply(bgn(100), [
      input('p', pct(20)),
      input('f', fixed(10)),
    ]);
    const orderB = DiscountApplication.apply(bgn(100), [
      input('f', fixed(10)),
      input('p', pct(20)),
    ]);
    expect(orderA.lines[0]?.id).toBe('f');
    expect(orderA.total.toMinorUnits()).toBe(7200);
    expect(orderB.lines[0]?.id).toBe('f');
    expect(orderB.total.toMinorUnits()).toBe(7200);
  });
});

describe('DiscountApplication.apply — clamping + free service', () => {
  it('a fixed amount larger than the subtotal clamps to zero, never negative', () => {
    const out = DiscountApplication.apply(bgn(5), [input('f', fixed(10))]);
    expect(out.lines[0]?.amount.toMinorUnits()).toBe(500);
    expect(out.total.toMinorUnits()).toBe(0);
  });

  it('free_service zeroes the running remainder, applied after percents', () => {
    const out = DiscountApplication.apply(bgn(100), [
      input('free', CouponValue.freeService()),
      input('p', pct(10)),
    ]);
    expect(out.lines[0]?.id).toBe('p');
    expect(out.lines[1]?.id).toBe('free');
    expect(out.total.toMinorUnits()).toBe(0);
  });
});

describe('DiscountApplication.apply — min-spend gating', () => {
  it('drops a discount whose min-spend the subtotal does not clear', () => {
    const out = DiscountApplication.apply(bgn(50), [
      input('p', pct(10), { minSpend: bgn(100) }),
    ]);
    expect(out.lines).toHaveLength(0);
  });

  it('applies a discount once the subtotal meets the min-spend', () => {
    const out = DiscountApplication.apply(bgn(100), [
      input('p', pct(10), { minSpend: bgn(100) }),
    ]);
    expect(out.lines).toHaveLength(1);
  });
});

describe('DiscountApplication.apply — anti-abuse cap', () => {
  it('trims trailing lines so the total discount never exceeds the cap', () => {
    const out = DiscountApplication.apply(
      bgn(100),
      [input('a', pct(40)), input('b', pct(40))],
      { capPercent: 50 },
    );
    expect(out.discountTotal.toMinorUnits()).toBe(5000);
    expect(out.total.toMinorUnits()).toBe(5000);
  });

  it('leaves the breakdown untouched when under the cap', () => {
    const out = DiscountApplication.apply(bgn(100), [input('a', pct(10))], {
      capPercent: 50,
    });
    expect(out.discountTotal.toMinorUnits()).toBe(1000);
  });

  it('capPercent rejects an out-of-range value', () => {
    expect(DiscountApplication.capPercent(-1).isFailure()).toBe(true);
    expect(DiscountApplication.capPercent(101).isFailure()).toBe(true);
    expect(DiscountApplication.capPercent(50).isSuccess()).toBe(true);
  });
});

// ── Property-based tests (blueprint §7.4) ──────────────────────────

const discountArb = fc
  .record({
    kind: fc.constantFrom<'percent' | 'fixed' | 'free'>(
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
      r.kind === 'percent'
        ? pct(r.percent)
        : r.kind === 'fixed'
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

describe('DiscountApplication.apply — property tests', () => {
  it('never produces a negative total, with or without a cap', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.array(discountArb, { maxLength: 8 }),
        fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
        (subtotalMajor, items, capPercent) => {
          const out = DiscountApplication.apply(
            bgn(subtotalMajor),
            toInputs(items),
            {
              ...(capPercent !== undefined && { capPercent }),
            },
          );
          expect(out.total.toMinorUnits()).toBeGreaterThanOrEqual(0);
          expect(out.discountTotal.toMinorUnits()).toBeGreaterThanOrEqual(0);
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
          const subtotal = bgn(subtotalMajor);
          const out = DiscountApplication.apply(subtotal, toInputs(items), {
            capPercent,
          });
          const maxAllowed = Math.round(
            (subtotal.toMinorUnits() * capPercent) / 100,
          );
          expect(out.discountTotal.toMinorUnits()).toBeLessThanOrEqual(
            maxAllowed,
          );
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
        fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
        (subtotalMajor, items, capPercent) => {
          const subtotal = bgn(subtotalMajor);
          const inputs = toInputs(items);
          const shuffled = [...inputs].reverse();

          const outA = DiscountApplication.apply(subtotal, inputs, {
            ...(capPercent !== undefined && { capPercent }),
          });
          const outB = DiscountApplication.apply(subtotal, shuffled, {
            ...(capPercent !== undefined && { capPercent }),
          });

          expect(outB.discountTotal.toMinorUnits()).toBe(
            outA.discountTotal.toMinorUnits(),
          );
          expect(outB.total.toMinorUnits()).toBe(outA.total.toMinorUnits());
          expect(
            outB.lines.map((l) => [l.id, l.amount.toMinorUnits()]),
          ).toEqual(outA.lines.map((l) => [l.id, l.amount.toMinorUnits()]));
        },
      ),
      { numRuns: 200 },
    );
  });
});
