import { describe, expect, it } from 'vitest';
import { LocalDate } from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import { unwrapOk } from '@core/testing';
import {
  formatCents,
  formatInstant,
  formatWallClockRange,
  formatWeekdayLabels,
} from './wall-clock';

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

/*
 * Two shop days as one range (UI residue cleanup §2.6, P0 (4)): the
 * successor of `day-range.ts`'s per-call formatter over `noonOf(day)`
 * Dates. Pinned against that path, recomputed here through a local copy of
 * `noonOf` (the spec is the only place a `Date` may appear), for bg and en,
 * the option sets `dayRange` passes (`day` + `2-digit` month with and
 * without the year, the short weekday) and a long month, over a range
 * inside one month, one across months and one across years. Midnight on the
 * UTC axis reads the same day as noon: every face runs on `timeZone: 'UTC'`.
 */
describe('formatWallClockRange', () => {
  /** `day-range.ts`'s `noonOf`, verbatim: a shop day as a Date read back in UTC. */
  function noonOf(day: string): Date {
    const [year, month, date] = day.split('-').map(Number);
    return new Date(
      Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1, 12, 0, 0),
    );
  }

  /** Today's `dayRange` formatting path: a per-call formatter over two noons. */
  function legacyRange(
    from: string,
    until: string,
    lang: string,
    options: Intl.DateTimeFormatOptions,
  ): string {
    return new Intl.DateTimeFormat(lang, {
      ...options,
      timeZone: 'UTC',
    }).formatRange(noonOf(from), noonOf(until));
  }

  const day = (raw: string): LocalDate => unwrapOk(LocalDate.parse(raw));

  const RANGES: readonly (readonly [string, string])[] = [
    ['2026-09-04', '2026-09-06'], // inside one month
    ['2026-09-01', '2026-11-30'], // across months
    ['2026-12-30', '2027-01-02'], // across years
  ];
  const OPTIONS: readonly Intl.DateTimeFormatOptions[] = [
    { day: 'numeric', month: '2-digit' },
    { day: 'numeric', month: '2-digit', year: 'numeric' },
    { weekday: 'short' },
    { day: 'numeric', month: 'long' },
  ];

  for (const lang of ['bg', 'en']) {
    for (const [from, until] of RANGES) {
      it(`prints ${from} – ${until} in ${lang} as day-range.ts does`, () => {
        for (const options of OPTIONS) {
          expect(
            formatWallClockRange(day(from), day(until), lang, options),
          ).toBe(legacyRange(from, until, lang, options));
        }
      });
    }
  }

  it('prints the house range day-range.spec.ts pins, character for character', () => {
    const date: Intl.DateTimeFormatOptions = {
      day: 'numeric',
      month: '2-digit',
    };
    expect(
      formatWallClockRange(day('2026-09-01'), day('2026-11-30'), 'bg', date),
    ).toBe('1.09 – 30.11');
    expect(
      formatWallClockRange(day('2026-10-08'), day('2026-10-09'), 'en', date),
    ).toBe('10/8\u2009–\u200910/9');
  });

  it('answers the same text on every call (one cached formatter)', () => {
    const options: Intl.DateTimeFormatOptions = { weekday: 'short' };
    expect(
      formatWallClockRange(day('2026-10-01'), day('2026-10-02'), 'bg', options),
    ).toBe(
      formatWallClockRange(day('2026-10-01'), day('2026-10-02'), 'bg', options),
    );
  });
});
