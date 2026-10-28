import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AppliedDiscount,
  Combinability,
  CouponExpiryRule,
  CouponStatus,
  CouponValue,
  DiscountProvenance,
  DiscountSource,
  type Money,
  VoucherCode,
} from '@core/components';
import {
  Currency,
  AppliedDiscountId,
  CouponGrantId,
  CouponId,
  PriceCents,
  UtcEpochMs,
} from '@core/primitives';
import type { Coupon } from '@core/entities';
import { deepFreeze, unwrapOk, utcMs } from '@core/testing';
import {
  type DiscountInput,
  type DiscountPromise,
  DiscountSystem,
} from './discount.system';

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
    expect(AppliedDiscount.isLegalSelection([])).toBe(true);
    expect(AppliedDiscount.isLegalSelection([stackable, birthday])).toBe(true);
    expect(AppliedDiscount.isLegalSelection([exclusive])).toBe(true);
    expect(AppliedDiscount.isLegalSelection([exclusive, stackable])).toBe(
      false,
    );
    expect(AppliedDiscount.isLegalSelection([stackable, stackable])).toBe(
      false,
    );
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

/* ── Pass C: the order, the drafted set, the offers, the code resolver ── */

describe("DiscountSystem.ordered — the evaluator's total order", () => {
  it('orders by method rank, magnitude, then the grant instant, then id — every input kept, a min-spend gate included', () => {
    const inputs = [
      input('b', pct(10)),
      input('free', CouponValue.freeService()),
      input('c', pct(15), { minSpend: eur(500) }),
      input('d', pct(10), { grantedAtOffset: 5 }),
      input('a', fixed(5)),
      input('e', pct(10)),
    ];
    expect(DiscountSystem.ordered(inputs).map((entry) => entry.id)).toEqual([
      'a',
      'b',
      'e',
      'd',
      'c',
      'free',
    ]);
    expect(DiscountSystem.ordered([])).toEqual([]);
  });

  it('is the order the evaluator applies its lines in', () => {
    const inputs = [
      input('p15', pct(15)),
      input('f5', fixed(5)),
      input('p10', pct(10)),
    ];
    const lines = DiscountSystem.apply(eur(100), inputs, null).lines;
    expect(lines.map((line) => line.id)).toEqual(
      DiscountSystem.ordered(inputs).map((entry) => entry.id),
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const inputs = deepFreeze([input('b', pct(10)), input('a', fixed(5))]);
    const once = DiscountSystem.ordered(inputs);
    expect(DiscountSystem.ordered(inputs)).toEqual(once);
    expect(once).not.toBe(inputs);
    expect(inputs.map((entry) => entry.id)).toEqual(['b', 'a']);
  });
});

describe('DiscountSystem.samePromise — any provenance and value slice', () => {
  it('compares a drafted promise that is not an applied discount', () => {
    const typed = {
      ...DiscountProvenance.code(VoucherCode.of('FIRST10')),
      ...pct(10),
    };
    expect(
      DiscountSystem.samePromise(typed, {
        ...DiscountProvenance.code(VoucherCode.of('FIRST10')),
        ...pct(10),
      }),
    ).toBe(true);
    expect(
      DiscountSystem.samePromise(typed, {
        ...DiscountProvenance.code(VoucherCode.of('BEARD5')),
        ...pct(10),
      }),
    ).toBe(false);
    expect(
      DiscountSystem.samePromise(
        { ...DiscountProvenance.manual(), ...pct(10) },
        { ...DiscountProvenance.manual(), ...fixed(10) },
      ),
    ).toBe(false);
  });

  it('tells a grant line apart from the same grant offered at another value (DEP-12 — the editor compared ids alone)', () => {
    const stale = {
      ...DiscountProvenance.grant(CouponGrantId.of('grant-1')),
      ...pct(10),
    };
    const offered = {
      ...DiscountProvenance.grant(CouponGrantId.of('grant-1')),
      ...pct(20),
    };
    expect(DiscountSystem.samePromise(stale, offered)).toBe(false);
    expect(DiscountSystem.samePromise(offered, birthday)).toBe(true);
  });
});

/** A drafted line as a caller holds it — its own key beside the promise it reads. */
type Drafted = { readonly key: string; readonly promise: DiscountPromise };

const drafted = (
  key: string,
  provenance: DiscountProvenance,
  value: CouponValue,
  combinability: Combinability = Combinability.Stackable,
): Drafted => ({ key, promise: { combinability, ...provenance, ...value } });

const promiseOf = (line: Drafted): DiscountPromise => line.promise;
const keys = (lines: readonly Drafted[]): string[] =>
  lines.map((line) => line.key);

const loyal = drafted(
  'grant:grant-loyal',
  DiscountProvenance.grant(CouponGrantId.of('grant-loyal')),
  pct(5),
);
const birthdayGift = drafted(
  'grant:grant-birthday',
  DiscountProvenance.grant(CouponGrantId.of('grant-birthday')),
  pct(20),
  Combinability.Exclusive,
);
const beard5 = drafted(
  'code:BEARD5',
  DiscountProvenance.code(VoucherCode.of('BEARD5')),
  fixed(5),
);
const first10 = drafted(
  'code:FIRST10',
  DiscountProvenance.code(VoucherCode.of('FIRST10')),
  pct(10),
);
const manual10 = drafted('manual', DiscountProvenance.manual(), pct(10));

describe('DiscountSystem.withAdded — what the drafted set becomes', () => {
  it('changes nothing for the same promise twice — the same array comes back', () => {
    const current = [loyal, beard5];
    expect(DiscountSystem.withAdded(current, beard5, promiseOf)).toBe(current);
    expect(
      DiscountSystem.withAdded(
        [manual10],
        drafted('manual', DiscountProvenance.manual(), pct(10)),
        promiseOf,
      ),
    ).toEqual([manual10]);
  });

  it('stacks what may stack, the newcomer last', () => {
    const once = DiscountSystem.withAdded([], loyal, promiseOf);
    expect(keys(once)).toEqual(['grant:grant-loyal']);
    expect(keys(DiscountSystem.withAdded(once, beard5, promiseOf))).toEqual([
      'grant:grant-loyal',
      'code:BEARD5',
    ]);
  });

  it('lets an exclusive coupon take the others off, and makes an exclusive line give way to whatever comes next', () => {
    const alone = DiscountSystem.withAdded(
      [loyal, beard5],
      birthdayGift,
      promiseOf,
    );
    expect(keys(alone)).toEqual(['grant:grant-birthday']);
    expect(keys(DiscountSystem.withAdded(alone, first10, promiseOf))).toEqual([
      'code:FIRST10',
    ]);
  });

  it('replaces the manual figure with the next one — the counter corrects, it does not pile up', () => {
    const next = drafted('manual', DiscountProvenance.manual(), fixed(3));
    expect(
      DiscountSystem.withAdded([manual10, first10], next, promiseOf).map(
        (line) => line.promise,
      ),
    ).toEqual([first10.promise, next.promise]);
    expect(
      keys(DiscountSystem.withAdded([manual10], first10, promiseOf)),
    ).toEqual(['manual', 'code:FIRST10']);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const current = deepFreeze([loyal, birthdayGift, manual10]);
    const candidate = deepFreeze(beard5);
    const once = DiscountSystem.withAdded(current, candidate, promiseOf);
    expect(DiscountSystem.withAdded(current, candidate, promiseOf)).toEqual(
      once,
    );
    expect(keys(current)).toEqual([
      'grant:grant-loyal',
      'grant:grant-birthday',
      'manual',
    ]);
  });
});

describe("DiscountSystem.offerablePromos — a held coupon's code is not offered again", () => {
  const promos = [
    { code: 'FIRST10', couponId: CouponId.of('coupon-first10') },
    { code: 'BEARD5', couponId: CouponId.of('coupon-beard5') },
    { code: 'ALONE20', couponId: CouponId.of('coupon-alone20') },
  ];
  const couponIdOf = (promo: (typeof promos)[number]): CouponId =>
    promo.couponId;

  it('leaves out the codes whose coupon the client holds as a grant, the rest in their order', () => {
    expect(
      DiscountSystem.offerablePromos(
        promos,
        [CouponId.of('coupon-beard5')],
        couponIdOf,
      ).map((promo) => promo.code),
    ).toEqual(['FIRST10', 'ALONE20']);
    expect(DiscountSystem.offerablePromos(promos, [], couponIdOf)).toEqual(
      promos,
    );
    expect(
      DiscountSystem.offerablePromos(
        [],
        [CouponId.of('coupon-beard5')],
        couponIdOf,
      ),
    ).toEqual([]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const frozen = deepFreeze(promos.map((promo) => ({ ...promo })));
    const held = deepFreeze([CouponId.of('coupon-first10')]);
    expect(DiscountSystem.offerablePromos(frozen, held, couponIdOf)).toEqual(
      DiscountSystem.offerablePromos(frozen, held, couponIdOf),
    );
  });
});

describe('DiscountSystem.resolvedCode — a coupon a typed code opened', () => {
  const coupon = (combinability: Combinability): Coupon => ({
    id: CouponId.of('coupon-first10'),
    name: 'Първо посещение',
    code: VoucherCode.of('FIRST10'),
    combinability,
    usageLimit: null,
    couponStatus: CouponStatus.Enabled,
    couponOccasion: null,
    ...pct(10),
    ...CouponExpiryRule.never(),
  });

  it('labels it with its name, keeps the code as matched, and reads its own rule and value', () => {
    expect(
      DiscountSystem.resolvedCode(
        coupon(Combinability.Stackable),
        VoucherCode.of('FIRST10'),
      ),
    ).toEqual({
      couponId: 'coupon-first10',
      label: 'Първо посещение',
      code: 'FIRST10',
      exclusive: false,
      discountMethod: 'PERCENT_OFF',
      discountPercent: 10,
    });
    expect(
      DiscountSystem.resolvedCode(
        coupon(Combinability.Exclusive),
        VoucherCode.of('FIRST10'),
      ).exclusive,
    ).toBe(true);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const frozen = deepFreeze(coupon(Combinability.Stackable));
    expect(
      DiscountSystem.resolvedCode(frozen, VoucherCode.of('FIRST10')),
    ).toEqual(DiscountSystem.resolvedCode(frozen, VoucherCode.of('FIRST10')));
  });
});

describe('DiscountSystem.isOffered — the counter’s offer rule, said once (pass D)', () => {
  const coupon = (
    code: VoucherCode | null,
    couponStatus: CouponStatus,
  ): Coupon => ({
    id: CouponId.of('coupon-first10'),
    name: 'Първо посещение',
    code,
    combinability: Combinability.Stackable,
    usageLimit: null,
    couponStatus,
    couponOccasion: null,
    ...pct(10),
    ...CouponExpiryRule.never(),
  });

  it('offers an enabled coupon that carries a code', () => {
    expect(
      DiscountSystem.isOffered(
        coupon(VoucherCode.of('FIRST10'), CouponStatus.Enabled),
      ),
    ).toBe(true);
  });

  it('never offers a grant-only (code-less) coupon, nor a disabled one', () => {
    expect(DiscountSystem.isOffered(coupon(null, CouponStatus.Enabled))).toBe(
      false,
    );
    expect(
      DiscountSystem.isOffered(
        coupon(VoucherCode.of('FIRST10'), CouponStatus.Disabled),
      ),
    ).toBe(false);
    expect(DiscountSystem.isOffered(coupon(null, CouponStatus.Disabled))).toBe(
      false,
    );
  });

  it('narrows to a coupon whose code is a VoucherCode', () => {
    const offered: readonly Coupon[] = [
      coupon(VoucherCode.of('FIRST10'), CouponStatus.Enabled),
      coupon(null, CouponStatus.Enabled),
    ];
    const codes: VoucherCode[] = [];
    for (const entry of offered.filter(DiscountSystem.isOffered)) {
      codes.push(entry.code);
    }
    expect(codes).toEqual(['FIRST10']);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const frozen = deepFreeze(
      coupon(VoucherCode.of('FIRST10'), CouponStatus.Enabled),
    );
    expect(DiscountSystem.isOffered(frozen)).toBe(
      DiscountSystem.isOffered(frozen),
    );
    expect(frozen.code).toBe('FIRST10');
  });
});
