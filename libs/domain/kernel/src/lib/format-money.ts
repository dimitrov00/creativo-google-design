import { Money } from './money';

/**
 * The ONE way a `Money` becomes display text (v2 `lib/format-money`).
 *
 * Takes the VO, not a loose `(amount, currencyCode)` pair, so a caller can
 * never format an amount against the wrong currency — and reads the
 * currency's own exponent rather than assuming `/ 100`.
 *
 * Fraction digits are the CURRENCY's, never hand-tuned: `28,00 €` beside
 * `17,50 €` is the point. Dropping the zeros on whole amounts reads fine
 * in isolation but breaks the alignment every price in this app is styled
 * for — `font-variant-numeric: tabular-nums` only lines a column up when
 * the strings share a shape, and `28 €` next to `17,50 €` puts the
 * separators at different offsets. It also matches the platform
 * convention (NumberFormatter.currency never drops a currency's decimals).
 */
export function formatMoney(money: Money, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: money.currencyCode(),
  }).format(money.toMajorUnits());
}
