/**
 * The seed's ONE injectable instant (audit-hardening Phase 3, P3-DEP-1):
 * `seedNowOf` reads `--now=<text>` first, then env `SEED_NOW`, else hands
 * back the caller's live clock — it never reads a clock itself. One text
 * grammar (P3-RU-3): epoch milliseconds, a wall time on the SHOP's clock,
 * or an ISO instant with `Z` / an offset; a text that names no instant
 * throws, never falls back. The zone math is `ZonedTimeSystem`'s (Law 7.3):
 * a spring-forward gap time is refused, a fall-back repeat takes the
 * earlier offset.
 *
 * No case reads the wall clock: every "real" now is a pinned constant.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SEED_DEFAULT,
  SEED_NOW_ENV,
  seedNowOf,
  seedNowTextOf,
} from './calendar.mjs';
import * as book from './fixtures.mjs';

/** A pinned "real" clock, far from every instant the cases name. */
const REAL_NOW = Date.parse('2026-09-25T15:00:00+03:00');
/** 2026-10-27 23:40 in Sofia — winter time, +02:00. */
const LATE = Date.parse('2026-10-27T23:40:00+02:00');

const nowOf = ({ argv = ['node', 'seed-dev-catalog.mjs'], env = {} } = {}) =>
  seedNowOf({ argv, env, realNowMs: REAL_NOW });
const flag = (text) => ['node', 'seed-dev-catalog.mjs', `--now=${text}`];

describe('the seed instant (seedNowOf)', () => {
  it('is the caller’s clock when neither --now nor SEED_NOW is given', () => {
    expect(SEED_DEFAULT).toBe('LIVE');
    expect(nowOf()).toBe(REAL_NOW);
    expect(nowOf({ argv: ['node', 'x', '--catalog-only'] })).toBe(REAL_NOW);
    expect(seedNowTextOf({ argv: [], env: {} })).toBeNull();
    // Another variable is not the seed's.
    expect(nowOf({ env: { E2E_NOW: String(LATE) } })).toBe(REAL_NOW);
  });

  it('reads epoch milliseconds written as digits', () => {
    expect(nowOf({ argv: flag(String(LATE)) })).toBe(LATE);
    expect(nowOf({ env: { [SEED_NOW_ENV]: String(LATE) } })).toBe(LATE);
    expect(nowOf({ env: { SEED_NOW: '0' } })).toBe(0);
  });

  it('reads a shop wall time on the shop’s clock, equal to its offset and Z forms', () => {
    const wall = nowOf({ argv: flag('2026-10-27T23:40') });
    expect(wall).toBe(LATE);
    expect(nowOf({ argv: flag('2026-10-27T23:40+02:00') })).toBe(wall);
    expect(nowOf({ argv: flag('2026-10-27T21:40Z') })).toBe(wall);
    expect(nowOf({ argv: flag('2026-10-27T21:40:00.000Z') })).toBe(wall);
    // Summer time on the same clock: +03:00.
    expect(nowOf({ env: { SEED_NOW: '2026-07-01T10:00' } })).toBe(
      Date.parse('2026-07-01T10:00:00+03:00'),
    );
    // A date alone is its shop midnight.
    expect(nowOf({ env: { SEED_NOW: '2026-10-27' } })).toBe(
      Date.parse('2026-10-27T00:00:00+02:00'),
    );
  });

  it('lets --now= beat SEED_NOW, and the last --now= beat an earlier one', () => {
    const env = { SEED_NOW: '2026-01-15T10:00' };
    expect(nowOf({ argv: flag('2026-10-27T23:40'), env })).toBe(LATE);
    expect(
      nowOf({
        argv: ['node', 'x', '--now=2026-01-15T10:00', '--now=2026-10-27T23:40'],
      }),
    ).toBe(LATE);
    expect(seedNowTextOf({ argv: flag('1'), env })).toEqual({
      source: '--now',
      text: '1',
    });
    expect(seedNowTextOf({ argv: [], env })).toEqual({
      source: 'SEED_NOW',
      text: '2026-01-15T10:00',
    });
  });

  it.each([
    ['empty', ''],
    ['garbage', 'tomorrow'],
    ['negative', '-1793137200000'],
    ['fractional', '1793137200000.5'],
    ['an exponent', '1.7e12'],
    ['a time with no day', '23:40'],
    ['an hour past the day', '2026-10-27T24:10'],
    ['past the instants a document holds', '253402300800000'],
  ])(
    'throws on %s text, from either source, never falling back',
    (_label, text) => {
      expect(() => nowOf({ argv: flag(text) })).toThrow(
        `seed: --now '${text}' is no instant (`,
      );
      expect(() => nowOf({ env: { SEED_NOW: text } })).toThrow(
        `seed: SEED_NOW '${text}' is no instant (`,
      );
    },
  );

  it('throws on a bare --now: the flag never takes the next argument', () => {
    expect(() => nowOf({ argv: ['node', 'x', '--now', String(LATE)] })).toThrow(
      "seed: --now takes its instant after '=' (--now=<text>)",
    );
  });

  it('refuses a wall time inside the spring-forward gap, naming DST_GAP_INVALID_TIME', () => {
    expect(() => nowOf({ argv: flag('2026-03-29T03:30') })).toThrow(
      "seed: --now '2026-03-29T03:30' is no instant (DST_GAP_INVALID_TIME)",
    );
    // Either side of the gap is a time of the shop's clock.
    expect(nowOf({ argv: flag('2026-03-29T02:59') })).toBe(
      Date.parse('2026-03-29T02:59:00+02:00'),
    );
    expect(nowOf({ argv: flag('2026-03-29T04:00') })).toBe(
      Date.parse('2026-03-29T04:00:00+03:00'),
    );
  });

  it('reads a fall-back repeat at the EARLIER offset', () => {
    expect(nowOf({ argv: flag('2026-10-25T03:30') })).toBe(
      Date.parse('2026-10-25T03:30:00+03:00'),
    );
    // The later reading stays reachable through its explicit offset.
    expect(nowOf({ argv: flag('2026-10-25T03:30+02:00') })).toBe(
      Date.parse('2026-10-25T03:30:00+02:00'),
    );
  });

  it('reads the given zone, not the machine’s', () => {
    expect(
      seedNowOf({
        argv: flag('2026-10-27T23:40'),
        env: {},
        realNowMs: REAL_NOW,
        timeZone: 'UTC',
      }),
    ).toBe(Date.parse('2026-10-27T23:40:00Z'));
  });

  it('is pure: the same input gives the same instant, the input untouched', () => {
    const argv = Object.freeze(flag('2026-10-27T23:40'));
    const env = Object.freeze({ SEED_NOW: '1' });
    const once = seedNowOf({ argv, env, realNowMs: REAL_NOW });
    expect(seedNowOf({ argv, env, realNowMs: REAL_NOW })).toBe(once);
    expect(argv).toEqual(flag('2026-10-27T23:40'));
    expect(env).toEqual({ SEED_NOW: '1' });
  });

  it('is handed out through the bundle’s book namespace', () => {
    expect(book.seedNowOf).toBe(seedNowOf);
    expect(book.seedNowTextOf).toBe(seedNowTextOf);
    expect(book.SEED_NOW_ENV).toBe('SEED_NOW');
    expect(book.SEED_DEFAULT).toBe(SEED_DEFAULT);
  });
});

describe('the seed script reads it once', () => {
  const script = readFileSync(
    resolve(__dirname, '../seed-dev-catalog.mjs'),
    'utf8',
  );
  const count = (text) => script.split(text).length - 1;

  it('anchors the one client book at the seed instant, never at Date.now() directly', () => {
    expect(count('buildClientBook(')).toBe(1);
    expect(count('buildClientBook(seedNowMs)')).toBe(1);
    expect(count('buildClientBook(Date.now())')).toBe(0);
    expect(count('seedNowOf({ ...seedNow, realNowMs: Date.now() })')).toBe(1);
    expect(script).toContain('seed: instant ');
  });

  // P3-RU-2: the stats projection answers what the functions' trigger
  // answers on the real clock, and verify:p0 (c) compares the two.
  it('keeps the stats projection on the live clock', () => {
    expect(count('nowUtcMs: () => Date.now()')).toBe(1);
    expect(script.indexOf('nowUtcMs: () => Date.now()')).toBeGreaterThan(
      script.indexOf('seed.projectClientStats('),
    );
  });
});
