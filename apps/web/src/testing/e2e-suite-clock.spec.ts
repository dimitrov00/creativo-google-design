import { LocalDate, MinuteOfDay, type UtcEpochMs } from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import {
  BROWSER_PIN_MINUTE,
  EVENING_VISIT_START,
  SHOP_TIME_ZONE,
  browserPinOf,
  instantOfText,
  resolveSuiteInstant,
  shopDayOf,
} from '../../e2e/support/shop-clock';

/**
 * The e2e suite's clock, its PURE half (audit-hardening Phase 3 WS-A,
 * P3-DEP-3 / P3-DEP-4, P3-RU-5): the text grammar the suite shares with the
 * seed (`E2E_NOW` / `--now` / `SEED_NOW`, P3-RU-3), the instant a pinned
 * browser reads for a shop day, the fixed start of a pinned spec's "today"
 * visits, and the run's one instant — the only place the real day is
 * checked. `apps/web/e2e/**` has no type-checking target of its own; this is
 * the runner that compiles `shop-clock.ts`, so its guard lives under `src/`.
 * Every instant here is a fixed text: nothing reads the wall clock.
 */

/** An absolute ISO instant (with its offset), as epoch milliseconds. */
function at(iso: string): UtcEpochMs {
  const parsed = ZonedTimeSystem.parseOffsetIso(iso);
  if (!parsed.ok) throw new Error(`no instant ${iso}`);
  return parsed.value;
}

/** A shop day, proven. */
function day(raw: string): LocalDate {
  const parsed = LocalDate.parse(raw);
  if (!parsed.ok) throw new Error(`no day ${raw}`);
  return parsed.value;
}

/** A minute of the day, proven. */
function minute(raw: number): MinuteOfDay {
  const parsed = MinuteOfDay.of(raw);
  if (!parsed.ok) throw new Error(`no minute ${raw}`);
  return parsed.value;
}

// `test` rather than `it`, and a loop rather than `each`: apps/web lints with
// eslint-plugin-playwright, whose `no-standalone-expect` recognises `test()`
// only (as `e2e-appointment-seed.spec.ts` does).
describe('instantOfText — the seed’s grammar (P3-RU-3)', () => {
  test('reads epoch milliseconds written as digits', () => {
    expect(instantOfText('1793137200000')).toBe(1_793_137_200_000);
    expect(instantOfText('0')).toBe(0);
  });

  test('reads a wall time on the SHOP’s clock, equal to its offset and Z forms', () => {
    const late = instantOfText('2026-10-27T23:40');
    expect(late).toBe(at('2026-10-27T23:40:00.000+02:00'));
    expect(instantOfText('2026-10-27T23:40+02:00')).toBe(late);
    expect(instantOfText('2026-10-27T21:40Z')).toBe(late);
    // Summer time: the same wall time sits at +03:00.
    expect(instantOfText('2026-07-01T23:40')).toBe(
      at('2026-07-01T23:40:00.000+03:00'),
    );
  });

  for (const text of [
    '',
    'soon',
    'tomorrow 10:00',
    '-5',
    '1.5',
    '1e12',
    ' 1793137200000',
  ]) {
    test(`refuses ${JSON.stringify(text)} loudly, never falling back to a clock`, () => {
      expect(() => instantOfText(text)).toThrow(/is not valid/);
    });
  }

  test('refuses a wall time inside the spring-forward gap, naming DST_GAP_INVALID_TIME', () => {
    expect(() => instantOfText('2026-03-29T03:30')).toThrow(
      /DST_GAP_INVALID_TIME/,
    );
  });

  test('reads a fall-back repeat at the EARLIER offset (Law 7.3)', () => {
    expect(instantOfText('2026-10-25T03:30')).toBe(
      at('2026-10-25T03:30:00.000+03:00'),
    );
  });
});

describe('browserPinOf — the pinned browser’s instant for a shop day', () => {
  test('pins 10:00 on the shop’s clock', () => {
    expect(BROWSER_PIN_MINUTE).toBe(600);
    expect(browserPinOf(day('2026-10-27'))).toBe(
      at('2026-10-27T10:00:00.000+02:00'),
    );
  });

  // Either side of both of 2026's changes (spring forward 29 March, fall
  // back 25 October): the pin moves with the shop's offset, never its hour.
  for (const [raw, offset] of [
    ['2026-03-28', '+02:00'],
    ['2026-03-29', '+03:00'],
    ['2026-03-30', '+03:00'],
    ['2026-10-24', '+03:00'],
    ['2026-10-25', '+02:00'],
    ['2026-10-26', '+02:00'],
  ] as const) {
    test(`${raw} is that day at 10:00 (${offset}) across a DST change`, () => {
      const pin = browserPinOf(day(raw));
      expect(pin).toBe(at(`${raw}T10:00:00.000${offset}`));
      const local = ZonedTimeSystem.toLocal(pin, SHOP_TIME_ZONE);
      expect(local.localDate).toBe(raw);
      expect(local.minute).toBe(BROWSER_PIN_MINUTE);
      expect(shopDayOf(pin)).toBe(raw);
    });
  }
});

describe('EVENING_VISIT_START — where a pinned spec’s “today” visits start', () => {
  test('is 21:00, ahead of the pinned 10:00, and the 30-minute chair ends 21:30 the same day', () => {
    expect(EVENING_VISIT_START).toBe('21:00:00');
    const [hour = '', minutes = '', seconds = ''] =
      EVENING_VISIT_START.split(':');
    expect(seconds).toBe('00');
    const start = minute(Number(hour) * 60 + Number(minutes));
    expect(start).toBe(21 * 60);
    expect(start).toBeGreaterThan(BROWSER_PIN_MINUTE);
    // `MinuteOfDay.of` holds the end below 1440: the visit ends the same day.
    expect(minute(start + 30)).toBe(21 * 60 + 30);
  });
});

describe('resolveSuiteInstant — the run’s ONE instant', () => {
  // The real clock of a run, fixed: 08:15 on the shop's 2026-10-27.
  const realNow = at('2026-10-27T08:15:00.000+02:00');

  test('is the real instant when no E2E_NOW is given', () => {
    expect(resolveSuiteInstant(null, realNow)).toBe(realNow);
  });

  for (const text of [
    '2026-10-27T23:40',
    '2026-10-27T00:00',
    '2026-10-27T21:40Z',
    '1793095200000', // 2026-10-27T12:00+02:00
  ]) {
    test(`takes ${JSON.stringify(text)}, which falls on the real shop day`, () => {
      const instant = resolveSuiteInstant(text, realNow);
      expect(instant).toBe(instantOfText(text));
      expect(shopDayOf(instant)).toBe('2026-10-27');
    });
  }

  test('pins 23:40 of the real day to that instant', () => {
    expect(resolveSuiteInstant('2026-10-27T23:40', realNow)).toBe(
      at('2026-10-27T23:40:00.000+02:00'),
    );
    expect(at('2026-10-27T12:00:00.000+02:00')).toBe(1_793_095_200_000);
  });

  for (const text of [
    '2026-10-26T23:40',
    '2026-10-28T00:10',
    // 22:30Z is already the 28th on the shop's clock.
    '2026-10-27T22:30Z',
  ]) {
    test(`refuses ${JSON.stringify(text)}, which falls on another shop day`, () => {
      expect(() => resolveSuiteInstant(text, realNow)).toThrow(
        /not on today's 2026-10-27/,
      );
    });
  }

  test('refuses a text that is no instant at all', () => {
    expect(() => resolveSuiteInstant('soon', realNow)).toThrow(/is not valid/);
  });

  test('is the ONLY day check: a worker after the real midnight keeps the run’s day', () => {
    // Global setup ran at 23:39 on the 27th and wrote the digits; a worker
    // (re)started at 00:20 on the 28th reads them through `instantOfText`
    // (`suiteNowUtcMs`), which never compares days — the run's day stays
    // the 27th, and its browser stays pinned to the 27th's 10:00.
    const fixed = resolveSuiteInstant(
      '2026-10-27T23:40',
      at('2026-10-27T23:39:00.000+02:00'),
    );
    const inherited = String(fixed);
    const afterMidnight = at('2026-10-28T00:20:00.000+02:00');
    expect(shopDayOf(afterMidnight)).toBe('2026-10-28');
    expect(instantOfText(inherited)).toBe(fixed);
    expect(shopDayOf(instantOfText(inherited))).toBe('2026-10-27');
    expect(browserPinOf(shopDayOf(instantOfText(inherited)))).toBe(
      at('2026-10-27T10:00:00.000+02:00'),
    );
    // Only global setup's resolve would have refused it after midnight.
    expect(() => resolveSuiteInstant(inherited, afterMidnight)).toThrow(
      /not on today's 2026-10-28/,
    );
  });

  test('is pure: the same input gives the same instant', () => {
    expect(resolveSuiteInstant('2026-10-27T23:40', realNow)).toBe(
      resolveSuiteInstant('2026-10-27T23:40', realNow),
    );
  });
});
