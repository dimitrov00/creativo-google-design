import { Result } from '../components/result.data';
import type { Brand } from './brand';
import { PrimitiveError, PrimitiveErrorCode } from './primitive-errors.data';

/**
 * An ISO-4217 currency code, upper-case — `'EUR'` for every new amount;
 * stored legacy amounts may read `'BGN'` (BGN was retired in 2026,
 * `formatMoney` renders `28,00 €`). Always beside a `…Cents` amount.
 */
export type Currency = Brand<string, 'Currency'>;

const EUR = 'EUR' as Currency;
const BGN = 'BGN' as Currency;
const USD = 'USD' as Currency;
const GBP = 'GBP' as Currency;

/**
 * Every code a stored amount may carry — the four `booking-decision.system.ts`
 * accepts as stored today (its `StoredCurrency`), dictionary order.
 */
const KNOWN: readonly Currency[] = [EUR, BGN, USD, GBP];

/** The codes a NEW amount may be priced in — EUR only (what `Money.of` accepts). */
const TRADABLE: readonly Currency[] = [EUR];

function find(set: readonly Currency[], raw: string): Currency | null {
  const code = raw.trim().toUpperCase();
  for (let i = 0; i < set.length; i++) {
    const currency = set[i] as Currency;
    if (currency === code) return currency;
  }
  return null;
}

export const Currency = {
  EUR,
  BGN,
  USD,
  GBP,

  /**
   * The smart constructor — trimmed, upper-cased (`' eur '` → `'EUR'`) and one
   * of the four known codes, or `PRIMITIVE_CURRENCY_UNKNOWN`.
   */
  parse(raw: string): Result<Currency, PrimitiveError> {
    const currency = find(KNOWN, raw);
    return currency === null
      ? Result.err(
          PrimitiveError.of(
            PrimitiveErrorCode.CurrencyUnknown,
            raw,
            'Currency',
          ),
        )
      : Result.ok(currency);
  },

  /**
   * The currency a NEW amount may be priced in, or `null` — EUR only (today's
   * `Money.currencyFrom`; the set `Money.of` accepts, unchanged).
   */
  tradable(raw: string): Currency | null {
    return find(TRADABLE, raw);
  },
} as const;
