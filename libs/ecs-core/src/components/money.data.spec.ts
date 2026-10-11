import {
  EUR,
  add as dineroAdd,
  dinero,
  down,
  halfAwayFromZero,
  halfDown,
  halfEven,
  halfTowardsZero,
  halfUp,
  multiply,
  subtract as dineroSubtract,
  toSnapshot,
  transformScale,
  up,
  type DineroDivideOperation,
} from 'dinero.js';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  Currency,
  PriceCents,
  MoneyErrorCode,
  type Result,
} from '@core/primitives';
import { Money, RoundingMode } from './money.data';

function value<T, E>(result: Result<T, E>): T {
  if (!result.ok)
    throw new Error(
      `unexpected failure in test fixture: ${JSON.stringify(result.error)}`,
    );
  return result.value;
}

function eur(amountCents: number): Money {
  return value(Money.of(amountCents, Currency.EUR));
}

/**
 * A legacy figure in leva AS STORED — a plain struct, because `BGN` is not a
 * recognised currency (§2.7 `Currency = { EUR }`), so `Money.of` refuses it.
 * The arithmetic compares currency strings, so it is the mismatch fixture.
 */
function bgn(amountCents: number): Money {
  return Money.fromCents(value(PriceCents.signed(amountCents)), Currency.BGN);
}

// The kernel's money.spec.ts cases, on the plain struct. Its USD fixtures
// become EUR (the shop currency) and its mismatch fixture a stored legacy
// BGN figure — neither USD nor BGN is recognised (§9 D4, §2.7).
describe('Money.of — the edge guard (kernel fromMinorUnits / fromMinorUnitsAndCode)', () => {
  it('accepts a non-negative integer amount', () => {
    expect(Money.of(3000, 'EUR')).toEqual({
      ok: true,
      value: { amountCents: 3000, currency: 'EUR' },
    });
  });

  it('accepts zero, and folds a negative zero into it', () => {
    expect(Money.of(0, 'EUR').ok).toBe(true);
    expect(Object.is(value(Money.of(-0, 'EUR')).amountCents, 0)).toBe(true);
  });

  it('rejects a negative amount', () => {
    expect(Money.of(-100, 'EUR')).toEqual({
      ok: false,
      error: { errorCode: MoneyErrorCode.InvalidAmount, rawAmount: -100 },
    });
  });

  it('rejects a non-integer amount', () => {
    const result = Money.of(30.5, 'EUR');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.errorCode).toBe('MONEY_INVALID_AMOUNT');
  });

  it('rejects an amount beyond the safe-integer range, and NaN', () => {
    expect(Money.of(Number.MAX_SAFE_INTEGER + 1, 'EUR').ok).toBe(false);
    expect(Money.of(Number.NaN, 'EUR').ok).toBe(false);
  });

  it('accepts a known currency code case-insensitively and stores it upper-cased', () => {
    const result = Money.of(1000, 'eur');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.currency).toBe('EUR');
    expect(value(Money.of(1000, ' eur ')).currency).toBe('EUR');
  });

  it('refuses retired leva at the edge — BGN is not a recognised currency', () => {
    expect(Money.of(1000, 'BGN')).toEqual({
      ok: false,
      error: { errorCode: MoneyErrorCode.UnknownCurrency, rawCode: 'BGN' },
    });
  });

  it('rejects an unknown currency code', () => {
    expect(Money.of(1000, 'XXX')).toEqual({
      ok: false,
      error: { errorCode: MoneyErrorCode.UnknownCurrency, rawCode: 'XXX' },
    });
    expect(Money.of(1000, 'USD').ok).toBe(false);
  });

  it('still rejects an invalid amount for a known currency code', () => {
    const result = Money.of(-100, 'EUR');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.errorCode).toBe('MONEY_INVALID_AMOUNT');
  });

  it('reports the unknown currency before the amount', () => {
    const result = Money.of(-1, 'XXX');
    expect(!result.ok && result.error.errorCode).toBe('MONEY_UNKNOWN_CURRENCY');
  });
});

describe('Currency', () => {
  it('trades in EUR, the shop currency, and nothing else (§2.7, flatten-spec §1.4)', () => {
    expect(Currency.EUR).toBe('EUR');
    expect(Money.of(100, 'BGN').ok).toBe(false);
    expect(Object.values(RoundingMode)).toEqual([
      'FLOOR',
      'CEIL',
      'HALF_UP',
      'HALF_DOWN',
      'HALF_EVEN',
      'HALF_TOWARDS_ZERO',
      'HALF_AWAY_FROM_ZERO',
    ]);
  });

  it('currencyFrom trims and upper-cases, or answers null', () => {
    expect(Money.currencyFrom(' eur ')).toBe(Currency.EUR);
    expect(Money.currencyFrom('BGN')).toBeNull();
    expect(Money.currencyFrom('GBP')).toBeNull();
    expect(Money.currencyFrom('')).toBeNull();
  });
});

describe('Money arithmetic', () => {
  it('adds two amounts in the same currency', () => {
    expect(value(Money.add(eur(1000), eur(500)))).toEqual(eur(1500));
  });

  it('subtracts two amounts in the same currency', () => {
    expect(value(Money.sub(eur(1000), eur(300))).amountCents).toBe(700);
  });

  it('subtracts below zero — a difference, not a price', () => {
    expect(value(Money.sub(eur(300), eur(1000))).amountCents).toBe(-700);
  });

  it('rejects adding mismatched currencies instead of throwing', () => {
    expect(Money.add(eur(1000), bgn(1000))).toEqual({
      ok: false,
      error: {
        errorCode: MoneyErrorCode.CurrencyMismatch,
        leftCurrency: 'EUR',
        rightCurrency: 'BGN',
      },
    });
  });

  it('rejects subtracting mismatched currencies', () => {
    const result = Money.sub(bgn(1000), eur(1));
    expect(!result.ok && result.error.errorCode).toBe(
      'MONEY_CURRENCY_MISMATCH',
    );
  });

  it('zero is the identity of add', () => {
    expect(Money.zero(Currency.EUR)).toEqual({
      amountCents: 0,
      currency: 'EUR',
    });
    expect(value(Money.add(eur(42), Money.zero(Currency.EUR)))).toEqual(
      eur(42),
    );
  });

  it('equals() compares amount and currency', () => {
    expect(Money.equals(eur(1000), eur(1000))).toBe(true);
    expect(Money.equals(eur(1000), eur(999))).toBe(false);
    expect(Money.equals(eur(1000), bgn(1000))).toBe(false);
  });

  it('isZero', () => {
    expect(Money.isZero(eur(0))).toBe(true);
    expect(Money.isZero(eur(1))).toBe(false);
  });

  it('compare orders amounts in one currency and refuses mixed currencies', () => {
    expect(value(Money.compare(eur(1), eur(2)))).toBe(-1);
    expect(value(Money.compare(eur(2), eur(2)))).toBe(0);
    expect(value(Money.compare(eur(3), eur(2)))).toBe(1);
    const mixed = Money.compare(eur(1), bgn(1));
    expect(!mixed.ok && mixed.error.errorCode).toBe('MONEY_CURRENCY_MISMATCH');
  });

  it('never mutates its arguments', () => {
    const a = Object.freeze(eur(1000));
    const b = Object.freeze(eur(250));
    expect(value(Money.add(a, b)).amountCents).toBe(1250);
    expect(value(Money.sub(a, b)).amountCents).toBe(750);
    expect(value(Money.scale(a, 1, 3, RoundingMode.HalfEven)).amountCents).toBe(
      333,
    );
    expect(a).toEqual(eur(1000));
    expect(b).toEqual(eur(250));
  });
});

describe('Money.fromCents — two brands already checked', () => {
  it('pairs them unchecked, the same struct Money.of builds', () => {
    expect(Money.fromCents(value(PriceCents.of(2800)), Currency.EUR)).toEqual(
      value(Money.of(2800, 'EUR')),
    );
  });
});

describe('Money.sum', () => {
  it('totals a list in one currency', () => {
    expect(
      value(Money.sum([eur(100), eur(250), eur(5)], Currency.EUR)),
    ).toEqual(eur(355));
  });

  it('sums an empty list to zero in the given currency', () => {
    expect(value(Money.sum([], Currency.BGN))).toEqual(
      Money.zero(Currency.BGN),
    );
  });

  it('refuses the whole sum on the first figure in another currency', () => {
    expect(Money.sum([eur(100), bgn(1), eur(5)], Currency.EUR)).toEqual({
      ok: false,
      error: {
        errorCode: MoneyErrorCode.CurrencyMismatch,
        leftCurrency: 'EUR',
        rightCurrency: 'BGN',
      },
    });
  });
});

describe('Money.scale', () => {
  it('takes a percentage with an explicit rounding mode', () => {
    // 15 % of 28,45 € = 4,2675 € → 4,27 € half-up, 4,26 € floor.
    expect(
      value(Money.scale(eur(2845), 15, 100, RoundingMode.HalfUp)).amountCents,
    ).toBe(427);
    expect(
      value(Money.scale(eur(2845), 15, 100, RoundingMode.Floor)).amountCents,
    ).toBe(426);
  });

  it('converts legacy leva at the fixed retirement rate (1 € = 1,95583 лв.)', () => {
    // client-stats.ts: Math.round(minor / BGN_PER_EUR) — the half-up rule.
    const leva = bgn(5000);
    const euro = value(
      Money.scale(leva, 100_000, 195_583, RoundingMode.HalfUp),
    );
    expect(euro.amountCents).toBe(Math.round(5000 / 1.95583));
    expect(euro.currency).toBe('BGN');
  });

  it.each([
    // [numerator, denominator, mode, expected] on 25 minor units ÷ 10 = 2.5
    [1, 10, RoundingMode.Floor, 2],
    [1, 10, RoundingMode.Ceil, 3],
    [1, 10, RoundingMode.HalfUp, 3],
    [1, 10, RoundingMode.HalfDown, 2],
    [1, 10, RoundingMode.HalfEven, 2],
    [1, 10, RoundingMode.HalfTowardsZero, 2],
    [1, 10, RoundingMode.HalfAwayFromZero, 3],
    // ÷ 10 of −25 = −2.5
    [-1, 10, RoundingMode.Floor, -3],
    [-1, 10, RoundingMode.Ceil, -2],
    [-1, 10, RoundingMode.HalfUp, -2],
    [-1, 10, RoundingMode.HalfDown, -3],
    [-1, 10, RoundingMode.HalfEven, -2],
    [-1, 10, RoundingMode.HalfTowardsZero, -2],
    [-1, 10, RoundingMode.HalfAwayFromZero, -3],
    // 3 × 25 ÷ 10 = 7.5 → even neighbour is 8
    [3, 10, RoundingMode.HalfEven, 8],
    // 25 ÷ 4 = 6.25 (below half) and 25 × 3 ÷ 4 = 18.75 (above half)
    [1, 4, RoundingMode.HalfAwayFromZero, 6],
    [3, 4, RoundingMode.HalfTowardsZero, 19],
    // an exact quotient never rounds
    [2, 5, RoundingMode.Ceil, 10],
  ] as const)(
    'scales 25 by %i/%i with %s → %i',
    (numerator, denominator, mode, expected) => {
      expect(
        value(Money.scale(eur(25), numerator, denominator, mode)).amountCents,
      ).toBe(expected);
    },
  );

  it('refuses a ratio that is not integer / positive integer', () => {
    for (const [numerator, denominator] of [
      [1.5, 10],
      [1, 0],
      [1, -10],
      [1, 2.5],
      [Number.NaN, 1],
    ] as const) {
      expect(
        Money.scale(eur(25), numerator, denominator, RoundingMode.HalfUp),
      ).toEqual({
        ok: false,
        error: {
          errorCode: MoneyErrorCode.InvalidRatio,
          numerator,
          denominator,
        },
      });
    }
  });

  it('never yields a negative zero', () => {
    for (const mode of Object.values(RoundingMode)) {
      expect(
        Object.is(value(Money.scale(eur(0), -1, 1, mode)).amountCents, 0),
      ).toBe(true);
      expect(
        Object.is(value(Money.scale(eur(3), -1, 10, mode)).amountCents, -0),
      ).toBe(false);
    }
  });

  it('refuses a product beyond the safe-integer range', () => {
    const result = Money.scale(
      eur(Number.MAX_SAFE_INTEGER),
      2,
      1,
      RoundingMode.HalfUp,
    );
    expect(!result.ok && result.error.errorCode).toBe('MONEY_INVALID_AMOUNT');
  });
});

// Risk 10: the integer arithmetic held to dinero.js on random EUR amounts.
// The ONLY dinero import in ecs-core — deleted with the package in Phase 4.
describe('Money agrees with dinero.js (property)', () => {
  const amount = fc.integer({ min: 0, max: 1_000_000_000 });
  const toDinero = (minor: number) => dinero({ amount: minor, currency: EUR });
  const snapshotAmount = (d: ReturnType<typeof toDinero>) =>
    toSnapshot(d).amount;

  const dineroDivide = (mode: RoundingMode): DineroDivideOperation => {
    switch (mode) {
      case RoundingMode.Floor:
        return down;
      case RoundingMode.Ceil:
        return up;
      case RoundingMode.HalfUp:
        return halfUp;
      case RoundingMode.HalfDown:
        return halfDown;
      case RoundingMode.HalfEven:
        return halfEven;
      case RoundingMode.HalfTowardsZero:
        return halfTowardsZero;
      case RoundingMode.HalfAwayFromZero:
        return halfAwayFromZero;
    }
  };

  it('add', () => {
    fc.assert(
      fc.property(amount, amount, (a, b) => {
        expect(value(Money.add(eur(a), eur(b))).amountCents).toBe(
          snapshotAmount(dineroAdd(toDinero(a), toDinero(b))),
        );
      }),
    );
  });

  it('sub', () => {
    fc.assert(
      fc.property(amount, amount, (a, b) => {
        expect(value(Money.sub(eur(a), eur(b))).amountCents).toBe(
          snapshotAmount(dineroSubtract(toDinero(a), toDinero(b))),
        );
      }),
    );
  });

  it('sum', () => {
    fc.assert(
      fc.property(fc.array(amount, { maxLength: 40 }), (amounts) => {
        let expected = toDinero(0);
        for (const a of amounts) expected = dineroAdd(expected, toDinero(a));
        const items = amounts.map(eur);
        expect(value(Money.sum(items, Currency.EUR)).amountCents).toBe(
          snapshotAmount(expected),
        );
      }),
    );
  });

  it('scale by a decimal factor, every rounding mode', () => {
    fc.assert(
      fc.property(
        amount,
        fc.integer({ min: -100_000, max: 100_000 }),
        fc.integer({ min: 0, max: 4 }),
        fc.constantFrom(...Object.values(RoundingMode)),
        (a, factor, decimals, mode) => {
          const scaled = transformScale(
            multiply(toDinero(a), { amount: factor, scale: decimals }),
            EUR.exponent,
            dineroDivide(mode),
          );
          // `+ 0` folds dinero's negative zero (0 × −1); Money never makes one.
          expect(
            value(Money.scale(eur(a), factor, 10 ** decimals, mode))
              .amountCents,
          ).toBe(snapshotAmount(scaled) + 0);
        },
      ),
    );
  });

  it('scale by any integer ratio matches exact rational rounding', () => {
    // Denominators dinero cannot express (not a power of ten) — checked
    // against an exact BigInt reference instead.
    const reference = (n: bigint, d: bigint, mode: RoundingMode): number => {
      const q = n / d; // truncates toward zero
      const r = n - q * d;
      if (r === 0n) return Number(q);
      const negative = n < 0n;
      const away = negative ? q - 1n : q + 1n;
      const twice = 2n * (r < 0n ? -r : r);
      const pick = (towardsZero: boolean) => Number(towardsZero ? q : away);
      switch (mode) {
        case RoundingMode.Floor:
          return pick(!negative);
        case RoundingMode.Ceil:
          return pick(negative);
        default:
          if (twice < d) return pick(true);
          if (twice > d) return pick(false);
          switch (mode) {
            case RoundingMode.HalfUp:
              return pick(negative);
            case RoundingMode.HalfDown:
              return pick(!negative);
            case RoundingMode.HalfEven:
              return pick(q % 2n === 0n);
            case RoundingMode.HalfTowardsZero:
              return pick(true);
            default:
              return pick(false);
          }
      }
    };
    fc.assert(
      fc.property(
        amount,
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.constantFrom(...Object.values(RoundingMode)),
        (a, numerator, denominator, mode) => {
          expect(
            value(Money.scale(eur(a), numerator, denominator, mode))
              .amountCents,
          ).toBe(
            reference(BigInt(a) * BigInt(numerator), BigInt(denominator), mode),
          );
        },
      ),
    );
  });
});
