import { describe, expect, it } from 'vitest';
import { ZonedTimeSystem } from '@core/systems';
import { unwrapOk } from '@core/testing';
import { formatCents, formatInstant, formatWeekdayLabels } from './wall-clock';

/*
 * The week's short day names (Phase 4a): the cases of
 * `ZonedDateTime.weekdayLabels` (the legacy kernel's `zoned-date-time.spec.ts`,
 * deleted in Phase 4b; ledger `docs/architecture/flips/phase-4b-delete.md`
 * §11.1), with today's bg and en output pinned character for character
 * (recorded from the Luxon labels before the class was retired).
 */
describe('formatWeekdayLabels', () => {
  it('names the week Monday first in English', () => {
    const labels = formatWeekdayLabels('en');
    expect(labels).toHaveLength(7);
    expect(labels).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });

  it('names the week Monday first in Bulgarian', () => {
    expect(formatWeekdayLabels('bg')).toEqual([
      'пн',
      'вт',
      'ср',
      'чт',
      'пт',
      'сб',
      'нд',
    ]);
  });

  it('answers the same cached list on every call for a locale', () => {
    expect(formatWeekdayLabels('bg')).toBe(formatWeekdayLabels('bg'));
  });
});

/*
 * An instant in the locale's form (Phase 4b, `added:`): the
 * `toLocaleString()` case of the legacy kernel's `zoned-date-time.spec.ts`
 * (deleted in Phase 4b; ledger §11.1), same instant, zone, locale and
 * options, re-targeted to the template layer's `formatInstant`.
 */
describe('formatInstant', () => {
  it('formats an instant with the given locale and options, on the shop’s calendar', () => {
    const utc = unwrapOk(ZonedTimeSystem.checkZone('UTC'));
    expect(
      formatInstant(Date.UTC(2026, 5, 15, 10), utc, 'en', {
        weekday: 'short',
      }),
    ).toBe('Mon');
  });
});

/**
 * `Intl` emits U+00A0 (and U+202F) around the symbol — normalise so
 * assertions stay readable. Written as escapes, not the literal characters:
 * an invisible non-breaking space in source is indistinguishable from a
 * plain one on sight, and `no-irregular-whitespace` rejects it.
 */
const normalise = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

/*
 * The ONE money face (Phase 4b, `added:`): the five cases of the legacy
 * kernel's `format-money.spec.ts` (deleted in Phase 4b; ledger §11.1), same
 * amounts, locales and expected strings, re-targeted from `formatMoney`
 * over the dinero value object to `formatCents` over the stored pair — the
 * integer minor units beside their currency.
 */
describe('formatCents', () => {
  it('keeps the currency’s own fraction digits on a whole amount', () => {
    // The bug this guards: a hand-tuned `maximumFractionDigits: 0` printed
    // `15 €`, which breaks tabular alignment against `17,50 €`.
    expect(normalise(formatCents(1500, 'EUR', 'bg-BG'))).toBe('15,00 €');
  });

  it('formats a fractional amount with the same shape', () => {
    expect(normalise(formatCents(1750, 'EUR', 'bg-BG'))).toBe('17,50 €');
  });

  it('follows the locale’s separator and symbol placement', () => {
    expect(normalise(formatCents(1750, 'EUR', 'en-GB'))).toBe('€17.50');
  });

  it('reads the currency it is handed rather than assuming one', () => {
    expect(normalise(formatCents(1750, 'USD', 'en-US'))).toBe('$17.50');
  });

  it('uses the currency’s exponent, not a hardcoded /100', () => {
    // JPY has exponent 0 — `1500` minor units IS ¥1,500, not ¥15. The
    // stored `Currency` never holds JPY; proving the exponent is read is
    // not a reason to widen that list, so the face takes the code as text.
    expect(normalise(formatCents(1500, 'JPY', 'en-US'))).toBe('¥1,500');
  });
});
