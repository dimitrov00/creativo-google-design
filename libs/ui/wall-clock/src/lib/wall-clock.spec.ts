import { describe, expect, it } from 'vitest';
import { Currency, LocalDate, MinuteOfDay } from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import {
  cents,
  duration,
  minute,
  trackMinute,
  unwrapOk,
  utcMs,
} from '@core/testing';
import {
  ClockClosing,
  formatClock,
  formatCents,
  formatCentsFigure,
  formatCount,
  formatDayLong,
  formatDayShort,
  formatInstant,
  formatMonthLong,
  formatMinutesRange,
  formatZoneName,
  formatWallClockParts,
  formatWallClockRange,
  formatWeekdayLabels,
  wallClockParts,
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
      formatInstant(utcMs('2026-06-15T10:00:00Z'), utc, 'en', {
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
  const eur = Currency.EUR;

  it('keeps the currency’s own fraction digits on a whole amount', () => {
    // The bug this guards: a hand-tuned `maximumFractionDigits: 0` printed
    // `15 €`, which breaks tabular alignment against `17,50 €`.
    expect(normalise(formatCents(cents(1500), eur, 'bg-BG'))).toBe('15,00 €');
  });

  it('formats a fractional amount with the same shape', () => {
    expect(normalise(formatCents(cents(1750), eur, 'bg-BG'))).toBe('17,50 €');
  });

  it('follows the locale’s separator and symbol placement', () => {
    expect(normalise(formatCents(cents(1750), eur, 'en-GB'))).toBe('€17.50');
  });

  it('reads the currency it is handed rather than assuming one', () => {
    const usd = unwrapOk(Currency.parse('USD'));
    expect(normalise(formatCents(cents(1750), usd, 'en-US'))).toBe('$17.50');
  });

  // Pass D (W2-U, §4.2 class 4 — unrepresentable on purpose): the JPY case
  // ("`1500` minor units IS ¥1,500") is dropped. The face now takes a
  // `Currency`, and `Currency.parse('JPY')` refuses — no stored amount can
  // reach it. The exponent is still read from the currency's own `Intl`
  // formatter (`exponentOf`), never a hard-coded `/100`.
});

/*
 * The zone's short name (pass D, X-1): the staff day's corner label,
 * moved off a per-read `new Intl.DateTimeFormat('en-GB', { timeZone,
 * timeZoneName: 'short' })` onto the shared cache — pinned against that
 * reference on both sides of Sofia's changeovers.
 */
describe('formatZoneName', () => {
  const sofia = unwrapOk(ZonedTimeSystem.checkZone('Europe/Sofia'));
  const london = unwrapOk(ZonedTimeSystem.checkZone('Europe/London'));
  const reference = (at: number, zone: string): string =>
    new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeZoneName: 'short' })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value ?? zone;

  it('names the zone as it reads at the instant — summer and winter', () => {
    expect(
      formatZoneName(utcMs('2026-08-05T09:00:00+03:00'), sofia, 'en-GB'),
    ).toBe('EEST');
    expect(
      formatZoneName(utcMs('2026-01-05T09:00:00+02:00'), sofia, 'en-GB'),
    ).toBe('EET');
    expect(
      formatZoneName(utcMs('2026-08-05T09:00:00+01:00'), london, 'en-GB'),
    ).toBe('BST');
  });

  it('is byte-identical to the per-read formatter it replaces, across the changeovers', () => {
    for (const iso of [
      '2026-03-29T00:59:00Z',
      '2026-03-29T01:00:00Z',
      '2026-10-25T00:59:00Z',
      '2026-10-25T01:00:00Z',
      '2026-10-25T01:10:00Z',
    ]) {
      const at = utcMs(iso);
      expect(formatZoneName(at, sofia, 'en-GB')).toBe(reference(at, sofia));
      expect(formatZoneName(at, london, 'en-GB')).toBe(reference(at, london));
    }
  });

  it('is pure: same input → same output', () => {
    const at = utcMs('2026-08-05T09:00:00+03:00');
    expect(formatZoneName(at, sofia, 'en-GB')).toBe(
      formatZoneName(at, sofia, 'en-GB'),
    );
  });
});

/*
 * The bare money figure (pass D, X-1): the visit sheet's typed-money face,
 * `formatCents`' digits without its symbol — pinned against the sheet's
 * per-call `Intl.NumberFormat(lang, { 2 fraction digits }).format(c / 100)`
 * for EUR, the shop's currency, in both languages.
 */
describe('formatCentsFigure', () => {
  const eur = Currency.EUR;
  const reference = (cents: number, lang: string): string =>
    new Intl.NumberFormat(lang, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);

  it('prints the figure with the currency’s own fraction digits, no symbol', () => {
    expect(formatCentsFigure(cents(1800), eur, 'bg')).toBe('18,00');
    expect(formatCentsFigure(cents(1750), eur, 'en')).toBe('17.50');
    expect(formatCentsFigure(cents(0), eur, 'bg')).toBe('0,00');
  });

  it('is byte-identical to the sheet’s figure for EUR in bg and en', () => {
    for (const lang of ['bg', 'en']) {
      for (const amount of [0, 5, 99, 100, 1750, 2800, 123_456, 9_999_999]) {
        expect(formatCentsFigure(cents(amount), eur, lang)).toBe(
          reference(amount, lang),
        );
      }
    }
  });

  it('is pure: same input → same output', () => {
    expect(formatCentsFigure(cents(2800), eur, 'bg')).toBe(
      formatCentsFigure(cents(2800), eur, 'bg'),
    );
  });
});

/*
 * A span of minutes (pass E, E-12): the catalogue presenter's per-call
 * `formatDurationRange` moved onto the shared cache. Its words were pinned
 * in bg and en on `6d64f69f` before the move (the literal cases, moved here
 * with the function), and the function itself is copied below verbatim as
 * the reference (a `type:ui` spec may not import the features), byte-
 * compared on every pair of ends a service can carry.
 */
describe('formatMinutesRange', () => {
  /** `catalog.presenter.ts` `formatDurationRange` on `6d64f69f`, verbatim. */
  function legacyDurationRange(
    min: number,
    max: number,
    locale: string,
  ): string {
    const formatter = new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: 'minute',
      unitDisplay: 'narrow',
    });
    if (min === max) return formatter.format(min);
    const ranged = formatter as Intl.NumberFormat & {
      formatRange?: (start: number, end: number) => string;
    };
    if (typeof ranged.formatRange === 'function') {
      return ranged.formatRange(min, max);
    }
    return `${new Intl.NumberFormat(locale, { useGrouping: false }).format(min)}–${formatter.format(max)}`;
  }

  it('prints a single value, an equal min/max and a range in bg', () => {
    expect(formatMinutesRange(duration(30), duration(30), 'bg')).toBe('30 мин');
    expect(formatMinutesRange(duration(30), duration(50), 'bg')).toBe(
      '30 \u2013 50 мин',
    );
    expect(formatMinutesRange(duration(5), duration(1440), 'bg')).toBe(
      '5 \u2013 1440 мин',
    );
  });

  it('prints a single value, an equal min/max and a range in en, grouped the locale’s way', () => {
    expect(formatMinutesRange(duration(30), duration(30), 'en')).toBe('30m');
    expect(formatMinutesRange(duration(30), duration(50), 'en')).toBe(
      '30\u201350m',
    );
    expect(formatMinutesRange(duration(1440), duration(1440), 'en')).toBe(
      '1,440m',
    );
    expect(formatMinutesRange(duration(5), duration(1440), 'en')).toBe(
      '5\u20131,440m',
    );
  });

  it('is byte-identical to the per-call formatter it replaces, in bg and en', () => {
    const ends = [1, 5, 15, 30, 45, 50, 90, 120, 999, 1000, 1440];
    for (const locale of ['bg', 'en']) {
      for (const min of ends) {
        for (const max of ends) {
          if (max < min) continue;
          expect(formatMinutesRange(duration(min), duration(max), locale)).toBe(
            legacyDurationRange(min, max, locale),
          );
        }
      }
    }
  });

  it('is pure: same input → same output', () => {
    expect(formatMinutesRange(duration(30), duration(50), 'bg')).toBe(
      formatMinutesRange(duration(30), duration(50), 'bg'),
    );
  });
});

/*
 * A count (pass E, E-12): the client card's `figure` and the rhythm
 * editor's `figure`, both a per-call `new Intl.NumberFormat(lang)`, moved
 * onto the shared cache — pinned in bg and en and byte-compared against
 * that per-call reference.
 */
describe('formatCount', () => {
  const reference = (value: number, lang: string): string =>
    new Intl.NumberFormat(lang).format(value);

  it('prints a single value and a count grouped the locale’s way', () => {
    expect(formatCount(7, 'bg')).toBe('7');
    expect(formatCount(1000, 'bg')).toBe('1000');
    expect(formatCount(12_450, 'bg')).toBe('12\u00a0450');
    expect(formatCount(7, 'en')).toBe('7');
    expect(formatCount(1000, 'en')).toBe('1,000');
    expect(formatCount(12_450, 'en')).toBe('12,450');
  });

  it('is byte-identical to the per-call formatter it replaces, in bg and en', () => {
    for (const lang of ['bg', 'en']) {
      for (const value of [
        0, 1, 7, 42, 999, 1000, 9999, 12_450, 1_234_567, 2.5,
      ]) {
        expect(formatCount(value, lang)).toBe(reference(value, lang));
      }
    }
  });

  it('is pure: same input → same output', () => {
    expect(formatCount(12_450, 'bg')).toBe(formatCount(12_450, 'bg'));
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

/*
 * The raw parts face (the UI residue cleanup's review): the day pill's
 * same-month branch and the dashboard's title-cased heading read a
 * reading's PARTS — the same cached formatter `formatWallClockParts` joins,
 * so a parts reader and a joined face never format one day apart.
 */
describe('wallClockParts', () => {
  const sept9 = unwrapOk(LocalDate.parse('2026-09-09'));
  const dayMonth: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
  };

  it('reads the locale’s own part order — the day leads in bg, the month in en', () => {
    const order = (locale: string) =>
      wallClockParts(sept9, null, locale, dayMonth)
        .filter((part) => part.type === 'day' || part.type === 'month')
        .map((part) => part.type);
    expect(order('bg')).toEqual(['day', 'month']);
    expect(order('en')).toEqual(['month', 'day']);
  });

  it('joins to exactly what formatWallClockParts prints', () => {
    const long: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' };
    for (const locale of ['bg', 'en']) {
      expect(
        wallClockParts(sept9, null, locale, long)
          .map((part) => part.value)
          .join(''),
      ).toBe(formatWallClockParts(sept9, null, locale, long));
    }
  });

  it('reads the shop day as stored, on the UTC axis — no zone moves it', () => {
    const parts = wallClockParts(sept9, minute(23 * 60 + 59), 'en', {
      day: 'numeric',
    });
    expect(parts.find((part) => part.type === 'day')?.value).toBe('9');
  });
});

/*
 * The 24-hour face (pass D, D-5): the seven hand-written faces it replaces,
 * copied here verbatim from their files on `cf91b43` as the reference
 * (a `type:ui` spec may not import the features), byte-compared on every
 * minute 0…1455 they can be handed.
 */
const HAND_FACES = {
  /** `visit-editor/staff-visit-editor.ts` `clockLabel` (wraps, % 1440). */
  editorClockLabel(minute: number): string {
    const wrapped = ((minute % 1440) + 1440) % 1440;
    const hour = Math.floor(wrapped / 60);
    return `${String(hour).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
  },
  /** `block-editor/staff-block-editor.ts` `clockLabel` (% 24 h). */
  blockClockLabel(minute: number): string {
    const hours = Math.floor(minute / 60) % 24;
    const minutes = minute % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  },
  /** `time-grid/grid-gesture.ts` `timeLabel` (% 24 h). */
  gridTimeLabel(minute: number): string {
    const hour = Math.floor(minute / 60) % 24;
    return `${String(hour).padStart(2, '0')}:${String(Math.abs(minute % 60)).padStart(2, '0')}`;
  },
  /** `time-grid/staff-time-grid.ts` `nowLabel`'s face (% 24 h). */
  gridNowLabel(minute: number): string {
    const hour = Math.floor(minute / 60) % 24;
    return `${String(hour).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  },
  /** `waitlisted-step/booking-waitlisted-step.ts` `clockFace` (no wrap). */
  waitlistedClockFace(minutes: number): string {
    const hours = String(Math.floor(minutes / 60)).padStart(2, '0');
    return `${hours}:${String(minutes % 60).padStart(2, '0')}`;
  },
  /** `pages/home/locations/locations.component.ts` `clockOf` (no wrap). */
  landingClockOf(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes - hours * 60).padStart(2, '0')}`;
  },
} as const;

/** `time-grid/grid-gesture.ts` `hourLabel` — the axis's whole-hour ticks (`HH:00`). */
function gridHourLabel(minute: number): string {
  const hour = Math.floor(minute / 60) % 24;
  return `${String(hour).padStart(2, '0')}:00`;
}

/** Every minute 0…1455 — the day, its closing midnight, and a late cut's tail. */
const AXIS: readonly number[] = Array.from({ length: 1456 }, (_, i) => i);

describe('formatClock — the one 24-hour HH:MM face', () => {
  it('prints a minute of the day zero-padded, whatever the closing', () => {
    for (const closing of [ClockClosing.Wrap, ClockClosing.EndOfDay]) {
      expect(formatClock(trackMinute(0), closing)).toBe('00:00');
      expect(formatClock(trackMinute(545), closing)).toBe('09:05');
      expect(formatClock(trackMinute(1439), closing)).toBe('23:59');
    }
  });

  it('WRAP prints the closing midnight and the minutes past it on the next day’s clock', () => {
    expect(formatClock(trackMinute(1440), ClockClosing.Wrap)).toBe('00:00');
    expect(formatClock(trackMinute(1455), ClockClosing.Wrap)).toBe('00:15');
    expect(formatClock(trackMinute(2880), ClockClosing.Wrap)).toBe('00:00');
  });

  it('END_OF_DAY prints the closing midnight as 24:00', () => {
    expect(formatClock(trackMinute(1440), ClockClosing.EndOfDay)).toBe('24:00');
  });

  it('is byte-identical to each WRAP hand face on every minute 0…1455', () => {
    for (const minute of AXIS) {
      const printed = formatClock(trackMinute(minute), ClockClosing.Wrap);
      expect(printed).toBe(HAND_FACES.editorClockLabel(minute));
      expect(printed).toBe(HAND_FACES.blockClockLabel(minute));
      expect(printed).toBe(HAND_FACES.gridTimeLabel(minute));
      expect(printed).toBe(HAND_FACES.gridNowLabel(minute));
    }
  });

  it('is byte-identical to the grid axis’s hour ticks on every whole hour 0…1440', () => {
    for (let minute = 0; minute <= 1440; minute += 60) {
      expect(formatClock(trackMinute(minute), ClockClosing.Wrap)).toBe(
        gridHourLabel(minute),
      );
    }
  });

  it('is byte-identical to each END_OF_DAY hand face on every minute 0…1455', () => {
    for (const minute of AXIS) {
      const printed = formatClock(trackMinute(minute), ClockClosing.EndOfDay);
      expect(printed).toBe(HAND_FACES.waitlistedClockFace(minute));
      expect(printed).toBe(HAND_FACES.landingClockOf(minute));
    }
  });

  it('reads back to itself through MinuteOfDay.parseClock for every minute of the day', () => {
    for (let minute = 0; minute < 1440; minute++) {
      const printed = formatClock(trackMinute(minute), ClockClosing.Wrap);
      expect(MinuteOfDay.parseClock(printed)).toEqual({
        ok: true,
        value: minute,
      });
    }
  });

  it('is pure: same input → same output', () => {
    const t = trackMinute(1455);
    expect(formatClock(t, ClockClosing.Wrap)).toBe(
      formatClock(t, ClockClosing.Wrap),
    );
    expect(formatClock(t, ClockClosing.EndOfDay)).toBe(
      formatClock(t, ClockClosing.EndOfDay),
    );
  });
});

/*
 * The house date forms (R59): the cases of the client card's
 * `dayShort`/`dayLong`/`monthLong` (`client-card.words.spec.ts`) and the
 * rhythm editor's `shortDay`/`longDay`/`monthWord`
 * (`admin-rhythm.words.spec.ts`), merged here with their one home.
 */
describe('the house date forms (R59)', () => {
  const day = (raw: string): LocalDate => unwrapOk(LocalDate.parse(raw));
  const TODAY = day('2026-09-28');

  it('prints a fact line’s date short, with the year only outside today’s', () => {
    expect(formatDayShort(day('2026-08-12'), TODAY, 'bg')).toBe('12.08');
    expect(formatDayShort(day('2026-09-01'), TODAY, 'bg')).toBe('1.09');
    expect(formatDayShort(day('2025-03-06'), TODAY, 'bg')).toBe('6.03.2025 г.');
    expect(formatDayShort(day('2025-03-01'), TODAY, 'bg')).toBe('1.03.2025 г.');
  });

  it('never moves a day across a zone', () => {
    expect(formatDayShort(day('2026-12-31'), TODAY, 'bg')).toBe('31.12');
    expect(formatDayShort(day('2026-01-01'), TODAY, 'bg')).toBe('1.01');
  });

  it('spells a date someone hears, the month in words', () => {
    expect(formatDayLong(day('2026-09-04'), TODAY, 'bg')).toBe('4 септември');
    expect(formatDayLong(day('2025-03-06'), TODAY, 'bg')).toBe(
      '6 март 2025 г.',
    );
    expect(formatDayLong(day('2026-09-04'), TODAY, 'en')).toBe('September 4');
  });

  it('says a month in words', () => {
    expect(formatMonthLong(day('2026-09-04'), 'bg')).toBe('септември');
  });
});
