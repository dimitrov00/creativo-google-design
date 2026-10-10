import { MoneyError } from './money-errors.data';
import { Result } from './result.data';

/**
 * The currencies a figure may carry — the ONLY source of these strings
 * (blueprint §2.7: `Currency = { EUR }`). `EUR` is the shop's currency; BGN
 * was retired in 2026 and is NOT recognised here: the one place leva still
 * appear is ClientStatsSystem's legacy rate (`client-stats.ts:19`,
 * `BGN_PER_EUR`), which converts a legacy seat's figure before it becomes
 * `Money`. Extend this dictionary when the business needs a currency, never
 * speculatively.
 */
export const Currency = {
  EUR: 'EUR',
} as const;
export type Currency = (typeof Currency)[keyof typeof Currency];

/** Every recognised currency, dictionary order — derived, never a second source. */
const CURRENCIES: readonly Currency[] = Object.values(Currency);

/**
 * How `Money.scale` resolves a quotient that falls between two minor units.
 * Names and semantics match dinero.js v2's divide functions one for one
 * (`down`, `up`, `halfUp`, `halfDown`, `halfEven`, `halfTowardsZero`,
 * `halfAwayFromZero`) — the property spec holds them to it.
 */
export const RoundingMode = {
  /** Toward −∞ (dinero `down`). */
  Floor: 'floor',
  /** Toward +∞ (dinero `up`). */
  Ceil: 'ceil',
  /** Nearest; a tie goes toward +∞ (`Math.round`, dinero `halfUp`). */
  HalfUp: 'half_up',
  /** Nearest; a tie goes toward −∞ (dinero `halfDown`). */
  HalfDown: 'half_down',
  /** Nearest; a tie goes to the even neighbour — banker's rounding. */
  HalfEven: 'half_even',
  /** Nearest; a tie goes toward zero. */
  HalfTowardsZero: 'half_towards_zero',
  /** Nearest; a tie goes away from zero (commercial rounding). */
  HalfAwayFromZero: 'half_away_from_zero',
} as const;
export type RoundingMode = (typeof RoundingMode)[keyof typeof RoundingMode];

/**
 * A money figure: an integer count of the currency's minor units (cents)
 * beside its ISO 4217 code — never a float, never a formatted string
 * (formatting is the template layer's `formatMoney`, `libs/infrastructure/i18n`).
 * A figure that stands alone on a document is this nested struct
 * (`Seat.tip`, `GiftVoucher.balance`, …); `ServiceTerms` keeps the flat
 * `priceMinorUnits` + `currencyCode` pair (blueprint §2.5).
 *
 * `Money.of` is the edge guard (a non-negative safe integer in a recognised
 * currency, the kernel's `fromMinorUnitsAndCode` invariant). Arithmetic is
 * plain integer math with a same-currency guard; `sub` may go below zero —
 * a difference is not a price, and clamping is the caller's decision.
 */
export type Money = {
  readonly amountMinorUnits: number;
  readonly currencyCode: string;
};

export const Money = {
  /**
   * The edge guard — the only way a raw amount and code become `Money`.
   * The code is trimmed and upper-cased (`'eur'` → `'EUR'`); the amount must
   * be a non-negative safe integer.
   */
  of(
    amountMinorUnits: number,
    currencyCode: string,
  ): Result<Money, MoneyError> {
    const currency = Money.currencyFrom(currencyCode);
    if (currency === null) {
      return Result.err(MoneyError.unknownCurrency(currencyCode));
    }
    if (!Number.isSafeInteger(amountMinorUnits) || amountMinorUnits < 0) {
      return Result.err(MoneyError.invalidAmount(amountMinorUnits));
    }
    // `+ 0` folds a negative zero, so `-0` never reaches a document.
    return Result.ok({
      amountMinorUnits: amountMinorUnits + 0,
      currencyCode: currency,
    });
  },

  /** Nothing, in `currencyCode` — the identity of `add` and the empty `sum`. */
  zero(currencyCode: string): Money {
    return { amountMinorUnits: 0, currencyCode };
  },

  /**
   * The recognised currency a raw code names (trimmed, case-insensitive),
   * or `null` — the kernel's `currencyFromCode`, minus dinero.
   */
  currencyFrom(raw: string): Currency | null {
    const code = raw.trim().toUpperCase();
    for (let i = 0; i < CURRENCIES.length; i++) {
      const currency = CURRENCIES[i] as Currency;
      if (currency === code) return currency;
    }
    return null;
  },

  add(a: Money, b: Money): Result<Money, MoneyError> {
    if (a.currencyCode !== b.currencyCode) {
      return Result.err(
        MoneyError.currencyMismatch(a.currencyCode, b.currencyCode),
      );
    }
    return Result.ok({
      amountMinorUnits: a.amountMinorUnits + b.amountMinorUnits,
      currencyCode: a.currencyCode,
    });
  },

  /** `a − b`; the result may be negative (a difference, not a price). */
  sub(a: Money, b: Money): Result<Money, MoneyError> {
    if (a.currencyCode !== b.currencyCode) {
      return Result.err(
        MoneyError.currencyMismatch(a.currencyCode, b.currencyCode),
      );
    }
    return Result.ok({
      amountMinorUnits: a.amountMinorUnits - b.amountMinorUnits,
      currencyCode: a.currencyCode,
    });
  },

  /**
   * The total of `items` in `currencyCode` — one linear scan, no
   * intermediate structs. The first figure in another currency refuses the
   * whole sum. An empty list sums to `zero(currencyCode)`.
   */
  sum(
    items: readonly Money[],
    currencyCode: string,
  ): Result<Money, MoneyError> {
    let total = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i] as Money;
      if (item.currencyCode !== currencyCode) {
        return Result.err(
          MoneyError.currencyMismatch(currencyCode, item.currencyCode),
        );
      }
      total += item.amountMinorUnits;
    }
    return Result.ok({ amountMinorUnits: total, currencyCode });
  },

  /**
   * `m × numerator / denominator`, rounded to a whole minor unit by `mode` —
   * integer-only: the product is exact (it must stay a safe integer) and the
   * quotient is resolved from the exact remainder, never from a float.
   * A 15 % discount is `scale(price, 15, 100, RoundingMode.HalfUp)`; the BGN
   * retirement rate is `scale(leva, 100_000, 195_583, …)`.
   *
   * Refuses a ratio that is not `integer / positive integer`
   * (`money.invalid_ratio`) and a product beyond the safe-integer range
   * (`money.invalid_amount`).
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
    const product = m.amountMinorUnits * numerator;
    if (!Number.isSafeInteger(product)) {
      return Result.err(MoneyError.invalidAmount(product));
    }
    return Result.ok({
      amountMinorUnits: divideRounded(product, denominator, mode),
      currencyCode: m.currencyCode,
    });
  },

  /** Same currency and same amount. */
  equals(a: Money, b: Money): boolean {
    return (
      a.currencyCode === b.currencyCode &&
      a.amountMinorUnits === b.amountMinorUnits
    );
  },

  /** `-1`, `0` or `1` for `a` below, equal to or above `b`; refuses mixed currencies. */
  compare(a: Money, b: Money): Result<-1 | 0 | 1, MoneyError> {
    if (a.currencyCode !== b.currencyCode) {
      return Result.err(
        MoneyError.currencyMismatch(a.currencyCode, b.currencyCode),
      );
    }
    const diff = a.amountMinorUnits - b.amountMinorUnits;
    return Result.ok(diff < 0 ? -1 : diff > 0 ? 1 : 0);
  },

  isZero(m: Money): boolean {
    return m.amountMinorUnits === 0;
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
