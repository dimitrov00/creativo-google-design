import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type AppliedDiscount,
  AppliedDiscountSource,
} from '../components/applied-discount.data';
import { CouponCombinability } from '../components/coupon-combinability.data';
import { CouponValue } from '../components/coupon-value.data';
import { EngagementErrorCode } from '../components/engagement-errors.data';
import {
  CouponGrantCapacity,
  CouponGrantExpiration,
  GrantState,
  GrantStatus,
} from '../components/grant-status.data';
import type { Money } from '../components/money.data';
import {
  type CouponGrantEntity,
  CouponGrantId,
} from '../entities/coupon-grant.entity';
import { CouponId } from '../entities/coupon.entity';
import { UserId } from '../entities/user.entity';
import { deepFreeze, unwrapOk } from '../testing';
import { type DiscountInput, DiscountSystem } from './discount.system';

/*
 * The cases of libs/domain/engagement/src/lib/discount-application.spec.ts
 * and of libs/application/engagement/.../apply-discounts.use-case.spec.ts
 * (the anti-abuse cap over a client's grants), copied — `grantedAt` is an
 * instant in ms, `minSpend` is `null` when ungated, the cap is `null` when
 * none. The originals keep running against the `DiscountApplication` shim.
 */

const BASE_MS = Date.UTC(2025, 11, 31, 22, 0);

function eur(major: number): Money {
  return { amountMinorUnits: Math.round(major * 100), currencyCode: 'EUR' };
}

function pct(percent: number): CouponValue {
  return unwrapOk(CouponValue.percentOff(percent));
}

function fixed(major: number): CouponValue {
  return unwrapOk(CouponValue.fixedAmount(eur(major)));
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
    grantedAtMs: BASE_MS + (opts.grantedAtOffset ?? 0) * 60_000,
    minSpend: opts.minSpend ?? null,
  };
}

describe('DiscountSystem.apply — single value', () => {
  it('applies a percent off the subtotal', () => {
    const out = DiscountSystem.apply(eur(100), [input('p', pct(15))], null);
    expect(out.discountTotal.amountMinorUnits).toBe(1500);
    expect(out.total.amountMinorUnits).toBe(8500);
    expect(out.lines).toHaveLength(1);
  });

  it('no discounts ⇒ total equals subtotal, no lines', () => {
    const out = DiscountSystem.apply(eur(42), [], null);
    expect(out.lines).toHaveLength(0);
    expect(out.discountTotal.amountMinorUnits).toBe(0);
    expect(out.total.amountMinorUnits).toBe(4200);
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
    expect(out.discountTotal.amountMinorUnits).toBe(2350);
    expect(out.total.amountMinorUnits).toBe(7650);
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
    expect(orderA.total.amountMinorUnits).toBe(7200);
    expect(orderB.lines[0]?.id).toBe('f');
    expect(orderB.total.amountMinorUnits).toBe(7200);
  });
});

describe('DiscountSystem.apply — clamping + free service', () => {
  it('a fixed amount larger than the subtotal clamps to zero, never negative', () => {
    const out = DiscountSystem.apply(eur(5), [input('f', fixed(10))], null);
    expect(out.lines[0]?.amount.amountMinorUnits).toBe(500);
    expect(out.total.amountMinorUnits).toBe(0);
  });

  it('free_service zeroes the running remainder, applied after percents', () => {
    const out = DiscountSystem.apply(
      eur(100),
      [input('free', CouponValue.freeService()), input('p', pct(10))],
      null,
    );
    expect(out.lines[0]?.id).toBe('p');
    expect(out.lines[1]?.id).toBe('free');
    expect(out.total.amountMinorUnits).toBe(0);
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
    expect(out.discountTotal.amountMinorUnits).toBe(5000);
    expect(out.total.amountMinorUnits).toBe(5000);
  });

  it('leaves the breakdown untouched when under the cap', () => {
    const out = DiscountSystem.apply(eur(100), [input('a', pct(10))], 50);
    expect(out.discountTotal.amountMinorUnits).toBe(1000);
  });

  it('capPercent rejects an out-of-range value', () => {
    expect(DiscountSystem.capPercent(-1).ok).toBe(false);
    expect(DiscountSystem.capPercent(101).ok).toBe(false);
    expect(DiscountSystem.capPercent(Number.NaN)).toEqual({
      ok: false,
      error: {
        code: EngagementErrorCode.DiscountCapInvalid,
        attempted: Number.NaN,
      },
    });
    expect(DiscountSystem.capPercent(50).ok).toBe(true);
  });
});

/* ── Property-based tests (blueprint §7.4) ────────────────────────────── */

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
          expect(out.total.amountMinorUnits).toBeGreaterThanOrEqual(0);
          expect(out.discountTotal.amountMinorUnits).toBeGreaterThanOrEqual(0);
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
            (subtotal.amountMinorUnits * capPercent) / 100,
          );
          expect(out.discountTotal.amountMinorUnits).toBeLessThanOrEqual(
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
        fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
        (subtotalMajor, items, capPercent) => {
          const subtotal = eur(subtotalMajor);
          const inputs = toInputs(items);
          const shuffled = [...inputs].reverse();
          const outA = DiscountSystem.apply(subtotal, inputs, capPercent);
          const outB = DiscountSystem.apply(subtotal, shuffled, capPercent);
          expect(outB.discountTotal).toEqual(outA.discountTotal);
          expect(outB.total).toEqual(outA.total);
          expect(
            outB.lines.map((l) => [l.id, l.amount.amountMinorUnits]),
          ).toEqual(outA.lines.map((l) => [l.id, l.amount.amountMinorUnits]));
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
          expect(
            out.total.amountMinorUnits + out.discountTotal.amountMinorUnits,
          ).toBe(subtotal.amountMinorUnits);
        },
      ),
      { numRuns: 200 },
    );
  });
});

/* ── The client's grants (ApplyDiscountsUseCase) ──────────────────────── */

const NOW_MS = Date.UTC(2026, 0, 1);
const USER = UserId.of('user_1');

function grant(id: string, value: CouponValue): CouponGrantEntity {
  return {
    id: CouponGrantId.of(id),
    userId: USER,
    couponId: CouponId.of(`coupon_${id}`),
    value,
    grantedAtMs: NOW_MS,
    state: GrantStatus.active(
      CouponGrantCapacity.singleUse(),
      CouponGrantExpiration.none(),
    ),
  };
}

describe('DiscountSystem.inputsFromGrants — the client’s usable grants', () => {
  it('applies a fixed-amount grant against the cart subtotal', () => {
    const inputs = DiscountSystem.inputsFromGrants(
      [{ grant: grant('grant_1', fixed(5)), label: '5 EUR off' }],
      NOW_MS,
    );
    const out = DiscountSystem.apply(eur(20), inputs, null);
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0]?.label).toBe('5 EUR off');
    expect(out.total.amountMinorUnits).toBe(1500);
  });

  it('respects the anti-abuse cap across multiple grants', () => {
    const inputs = DiscountSystem.inputsFromGrants(
      [
        { grant: grant('grant_1', pct(50)), label: '50% off' },
        { grant: grant('grant_2', pct(20)), label: '20% off' },
      ],
      NOW_MS,
    );
    const out = DiscountSystem.apply(eur(100), inputs, 30);
    expect(out.discountTotal.amountMinorUnits).toBeLessThanOrEqual(3000);
  });

  it('leaves out a grant that is no longer usable', () => {
    const spent: CouponGrantEntity = {
      ...grant('grant_3', pct(10)),
      state: { kind: GrantState.Used, usedAtMs: NOW_MS, note: '' },
    };
    expect(
      DiscountSystem.inputsFromGrants([{ grant: spent, label: 'x' }], NOW_MS),
    ).toEqual([]);
  });
});

/* ── The discounts on a visit ─────────────────────────────────────────── */

const birthday: AppliedDiscount = {
  id: 'grant:grant-1',
  source: AppliedDiscountSource.Grant,
  value: pct(20),
  label: 'Рожден ден',
  grantId: CouponGrantId.of('grant-1'),
  code: null,
  appliedAtMs: BASE_MS,
  combinability: CouponCombinability.stackable(),
};

describe('DiscountSystem — the discounts on a visit', () => {
  it('hands the evaluator its own shape, and compares as a promise', () => {
    expect(DiscountSystem.inputOf(birthday)).toEqual({
      id: 'grant:grant-1',
      label: 'Рожден ден',
      value: pct(20),
      grantedAtMs: BASE_MS,
      minSpend: null,
    });
    const later = { ...birthday, appliedAtMs: BASE_MS + 86_400_000 };
    expect(DiscountSystem.samePromise(birthday, later)).toBe(true);
    const other = { ...birthday, value: pct(10) };
    expect(DiscountSystem.samePromise(birthday, other)).toBe(false);
  });

  it('lets stackable promises share the bill and keeps an exclusive one alone', () => {
    const stackable: AppliedDiscount = {
      ...birthday,
      id: 'code:first10',
      source: AppliedDiscountSource.Code,
      value: pct(10),
      grantId: null,
      code: 'FIRST10',
    };
    const exclusive: AppliedDiscount = {
      ...birthday,
      combinability: CouponCombinability.exclusive(),
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
      DiscountSystem.amountOf(
        { amountMinorUnits: 1000, currencyCode: 'BGN' },
        fixed(5),
      ),
    ).toEqual({ amountMinorUnits: 0, currencyCode: 'BGN' });
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
