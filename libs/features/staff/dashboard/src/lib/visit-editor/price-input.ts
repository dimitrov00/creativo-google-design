/**
 * Typed money → minor units, or `null` for anything that is not money.
 *
 * Takes what a phone keypad and a formatted label both produce: `18`,
 * `18,5`, `18.50`, `1.234,50`, `28,00 €`. The LAST separator is the decimal
 * one and may carry at most two digits; every other separator groups
 * thousands. Currency signs, spaces and letters are noise. Negative money
 * does not exist here, and neither does an empty answer.
 */
export function parsePriceInput(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,]/g, '');
  if (cleaned === '') return null;
  const last = Math.max(cleaned.lastIndexOf(','), cleaned.lastIndexOf('.'));
  const major =
    last === -1 ? cleaned : cleaned.slice(0, last).replace(/[.,]/g, '');
  const minor = last === -1 ? '' : cleaned.slice(last + 1);
  if (!/^\d*$/.test(major) || !/^\d{0,2}$/.test(minor)) return null;
  if (major === '' && minor === '') return null;
  const cents = Number(major || '0') * 100 + Number((minor + '00').slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}
