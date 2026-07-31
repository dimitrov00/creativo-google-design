import { JPY } from 'dinero.js';
import { describe, expect, it } from 'vitest';
import { formatMoney } from './format-money';
import { Money } from './money';

function money(minorUnits: number, code: string) {
  const result = Money.fromMinorUnitsAndCode(minorUnits, code);
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

/**
 * `Intl` emits U+00A0 (and U+202F) around the symbol — normalise so
 * assertions stay readable. Written as escapes, not the literal
 * characters: an invisible non-breaking space in source is
 * indistinguishable from a plain one on sight, and
 * `no-irregular-whitespace` rejects it.
 */
const normalise = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

describe('formatMoney', () => {
  it('keeps the currency’s own fraction digits on a whole amount', () => {
    // The bug this guards: a hand-tuned `maximumFractionDigits: 0` printed
    // `15 €`, which breaks tabular alignment against `17,50 €`.
    expect(normalise(formatMoney(money(1500, 'EUR'), 'bg-BG'))).toBe('15,00 €');
  });

  it('formats a fractional amount with the same shape', () => {
    expect(normalise(formatMoney(money(1750, 'EUR'), 'bg-BG'))).toBe('17,50 €');
  });

  it('follows the locale’s separator and symbol placement', () => {
    expect(normalise(formatMoney(money(1750, 'EUR'), 'en-GB'))).toBe('€17.50');
  });

  it('reads the currency off the VO rather than assuming one', () => {
    expect(normalise(formatMoney(money(1750, 'USD'), 'en-US'))).toBe('$17.50');
  });

  it('uses the currency’s exponent, not a hardcoded /100', () => {
    // JPY has exponent 0 — `1500` minor units IS ¥1,500, not ¥15. Built
    // through `fromMinorUnits`, which takes the currency directly: JPY is
    // deliberately absent from `CURRENCIES_BY_CODE`, and proving the
    // exponent is read is not a reason to widen that curated list.
    const result = Money.fromMinorUnits(1500, JPY);
    if (result.isFailure())
      throw new Error('unexpected failure in test fixture');
    expect(result.value.exponent()).toBe(0);
    expect(normalise(formatMoney(result.value, 'en-US'))).toBe('¥1,500');
  });
});
