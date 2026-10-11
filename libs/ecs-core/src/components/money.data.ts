import { Currency } from '../primitives/currency.primitive';
import { defect } from '../primitives/defect';
import { PriceCents } from '../primitives/price-cents.primitive';
import { MoneyError } from './money-errors.data';
import { Result } from './result.data';

/**
 * How `Money.scale` resolves a quotient that falls between two minor units.
 * Names and semantics match dinero.js v2's divide functions one for one
 * (`down`, `up`, `halfUp`, `halfDown`, `halfEven`, `halfTowardsZero`,
 * `halfAwayFromZero`) — the property spec holds them to it.
 */
export const RoundingMode = {
  /** Toward −∞ (dinero `down`). */
  Floor: 'FLOOR',
  /** Toward +∞ (dinero `up`). */
  Ceil: 'CEIL',
  /** Nearest; a tie goes toward +∞ (`Math.round`, dinero `halfUp`). */
  HalfUp: 'HALF_UP',
  /** Nearest; a tie goes toward −∞ (dinero `halfDown`). */
  HalfDown: 'HALF_DOWN',
  /** Nearest; a tie goes to the even neighbour — banker's rounding. */
  HalfEven: 'HALF_EVEN',
  /** Nearest; a tie goes toward zero. */
  HalfTowardsZero: 'HALF_TOWARDS_ZERO',
  /** Nearest; a tie goes away from zero (commercial rounding). */
  HalfAwayFromZero: 'HALF_AWAY_FROM_ZERO',
} as const;
export type RoundingMode = (typeof RoundingMode)[keyof typeof RoundingMode];

/**
 * The system ARITHMETIC value (flatten-spec §1.4, F-14): an integer count of
 * the currency's minor units (cents, stotinki) beside its ISO 4217 code —
 * never a float, never a formatted string (formatting is the template
 * layer's `formatMoney`, `libs/infrastructure/i18n`). Never a field of an
 * entity, document or stored struct: those flatten to `…Cents: PriceCents`
 * beside one `currency: Currency` (N6).
 *
 * `Money.of` is the edge guard (a non-negative safe integer in a tradable
 * currency, the kernel's `fromMinorUnitsAndCode` invariant). Arithmetic is
 * plain integer math with a same-currency guard; `sub` may go below zero —
 * a difference is not a price, and clamping is the caller's decision.
 */
export type Money = {
  readonly amountCents: PriceCents;
  readonly currency: Currency;
};

export const Money = {
  /**
   * The edge guard — the only way a raw amount and code become `Money`.
   * The code is trimmed and upper-cased (`'eur'` → `'EUR'`); the amount must
   * be a non-negative safe integer (a negative zero folds into `0`).
   */
  of(amountCents: number, currency: string): Result<Money, MoneyError> {
    const tradable = Money.currencyFrom(currency);
    if (tradable === null) {
      return Result.err(MoneyError.unknownCurrency(currency));
    }
    const cents = PriceCents.of(amountCents);
    if (!cents.ok) return Result.err(MoneyError.invalidAmount(amountCents));
    return Result.ok({ amountCents: cents.value, currency: tradable });
  },

  /** Two brands that are already checked — no guard (flatten-spec §1.4). */
  fromCents(amountCents: PriceCents, currency: Currency): Money {
    return { amountCents, currency };
  },

  /** Nothing, in `currency` — the identity of `add` and the empty `sum`. */
  zero(currency: Currency): Money {
    return { amountCents: PriceCents.ZERO, currency };
  },

  /**
   * The tradable currency a raw code names (trimmed, case-insensitive),
   * or `null` — the kernel's `currencyFromCode`, minus dinero.
   */
  currencyFrom(raw: string): Currency | null {
    return Currency.tradable(raw);
  },

  add(a: Money, b: Money): Result<Money, MoneyError> {
    if (a.currency !== b.currency) {
      return Result.err(MoneyError.currencyMismatch(a.currency, b.currency));
    }
    return Result.ok({
      amountCents: PriceCents.add(a.amountCents, b.amountCents),
      currency: a.currency,
    });
  },

  /** `a − b`; the result may be negative (a difference, not a price). */
  sub(a: Money, b: Money): Result<Money, MoneyError> {
    if (a.currency !== b.currency) {
      return Result.err(MoneyError.currencyMismatch(a.currency, b.currency));
    }
    return Result.ok({
      amountCents: PriceCents.sub(a.amountCents, b.amountCents),
      currency: a.currency,
    });
  },

  /**
   * The total of `items` in `currency` — one linear scan, no intermediate
   * structs. The first figure in another currency refuses the whole sum. An
   * empty list sums to `zero(currency)`.
   */
  sum(items: readonly Money[], currency: Currency): Result<Money, MoneyError> {
    let total = PriceCents.ZERO;
    for (let i = 0; i < items.length; i++) {
      const item = items[i] as Money;
      if (item.currency !== currency) {
        return Result.err(MoneyError.currencyMismatch(currency, item.currency));
      }
      total = PriceCents.add(total, item.amountCents);
    }
    return Result.ok({ amountCents: total, currency });
  },

  /**
   * `m × numerator / denominator`, rounded to a whole minor unit by `mode` —
   * integer-only: the product is exact (it must stay a safe integer) and the
   * quotient is resolved from the exact remainder, never from a float.
   * A 15 % discount is `scale(price, 15, 100, RoundingMode.HalfUp)`; the BGN
   * retirement rate is `scale(leva, 100_000, 195_583, …)`.
   *
   * Refuses a ratio that is not `integer / positive integer`
   * (`MONEY_INVALID_RATIO`) and a product beyond the safe-integer range
   * (`MONEY_INVALID_AMOUNT`).
   */
  scale(
    m: Money,
    numerator: number,
    denominator: number,
    mode: RoundingMode,
  ): Result<Money, MoneyError> {
    if (
      !Number.isSafeInteger(numerator) ||
      !Number.isSafeInteger(denominator) ||
      denominator <= 0
    ) {
      return Result.err(MoneyError.invalidRatio(numerator, denominator));
    }
    const product = m.amountCents * numerator;
    if (!Number.isSafeInteger(product)) {
      return Result.err(MoneyError.invalidAmount(product));
    }
    const scaled = PriceCents.signed(divideRounded(product, denominator, mode));
    return scaled.ok
      ? Result.ok({ amountCents: scaled.value, currency: m.currency })
      : defect('a quotient of a safe integer is a safe integer');
  },

  /** Same currency and same amount. */
  equals(a: Money, b: Money): boolean {
    return a.currency === b.currency && a.amountCents === b.amountCents;
  },

  /** `-1`, `0` or `1` for `a` below, equal to or above `b`; refuses mixed currencies. */
  compare(a: Money, b: Money): Result<-1 | 0 | 1, MoneyError> {
    if (a.currency !== b.currency) {
      return Result.err(MoneyError.currencyMismatch(a.currency, b.currency));
    }
    const diff = a.amountCents - b.amountCents;
    return Result.ok(diff < 0 ? -1 : diff > 0 ? 1 : 0);
  },

  isZero(m: Money): boolean {
    return m.amountCents === 0;
  },
} as const;

/**
 * `n / d` (`d > 0`, both safe integers) rounded by `mode`. JavaScript's `%`
 * is exact on safe integers and carries the dividend's sign, so `n − r` is an
 * exact multiple of `d` and `q` is the quotient truncated toward zero; the
 * remainder alone decides the step away from it.
 */
function divideRounded(n: number, d: number, mode: RoundingMode): number {
  const r = n % d;
  const q = (n - r) / d;
  if (r === 0) return q;
  const away = n < 0 ? q - 1 : q + 1;
  switch (mode) {
    case RoundingMode.Floor:
      return n < 0 ? away : q;
    case RoundingMode.Ceil:
      return n < 0 ? q : away;
    default: {
      const twice = 2 * Math.abs(r);
      if (twice < d) return q;
      if (twice > d) return away;
      return tieBreak(q, away, n < 0, mode);
    }
  }
}

/** Resolves an exact half between `q` (toward zero) and `away` (away from zero). */
function tieBreak(
  q: number,
  away: number,
  negative: boolean,
  mode: RoundingMode,
): number {
  switch (mode) {
    case RoundingMode.HalfUp:
      return negative ? q : away;
    case RoundingMode.HalfDown:
      return negative ? away : q;
    case RoundingMode.HalfEven:
      return q % 2 === 0 ? q : away;
    case RoundingMode.HalfTowardsZero:
      return q;
    default:
      return away;
  }
}
