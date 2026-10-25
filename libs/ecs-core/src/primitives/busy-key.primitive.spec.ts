import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { deepFreeze, localDate } from '@core/testing';
import { BusyKey } from './busy-key.primitive';
import { BarberId } from './ids.primitive';
import { LocalDate } from './local-date.primitive';

/*
 * The successor of `components/busy-key.data.spec.ts` (flatten-spec §1.5):
 * the same text, the `localDate` half.
 */
const IVAN = BarberId.of('b_ivan');

describe('BusyKey — `${barberId}__${localDate}`', () => {
  it('of spells the key with a DOUBLE underscore', () => {
    expect(BusyKey.of(IVAN, localDate('2026-10-07'))).toBe(
      'b_ivan__2026-10-07',
    );
  });

  it('split splits at the LAST double underscore', () => {
    expect(
      BusyKey.split(BusyKey.of(BarberId.of('b__x'), localDate('2026-10-07'))),
    ).toEqual({ barberId: 'b__x', localDate: '2026-10-07' });
  });

  it('round-trips any parseable barber id and real day (property)', () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 1 })
          .filter((raw) => raw.trim().length > 0 && !raw.includes('/')),
        fc.integer({ min: -1000, max: 40_000 }),
        (rawBarber, epochDay) => {
          const barberId = BarberId.of(rawBarber);
          const day = LocalDate.fromEpochDay(epochDay);
          const key = BusyKey.of(barberId, day);
          expect(BusyKey.split(key)).toEqual({ barberId, localDate: day });
          expect(BusyKey.parse(key)).toBe(key);
        },
      ),
    );
  });

  it('parse rebuilds a valid key, or answers null', () => {
    expect(BusyKey.parse('b_ivan__2026-10-07')).toBe('b_ivan__2026-10-07');
    for (const raw of [
      'b_ivan_2026-10-07',
      '__2026-10-07',
      'b_ivan__2026-02-30',
      'b_ivan__',
      'a/b__2026-10-07',
      '   __2026-10-07',
      'ivan',
      '',
    ]) {
      expect(BusyKey.parse(raw)).toBeNull();
    }
  });

  it('a split of a key that is not a busy key is a programmer defect', () => {
    expect(() => BusyKey.split('nonsense' as BusyKey)).toThrow(/defect/);
  });

  it('is pure', () => {
    const key = deepFreeze(BusyKey.of(IVAN, localDate('2026-10-07')));
    expect(BusyKey.split(key)).toEqual(BusyKey.split(key));
  });
});

describe('BusyKey.is — the read-time door (edge hardening D-1)', () => {
  it('is ⇔ parse(x) !== null over keys valid and broken', () => {
    for (const raw of [
      'b_ivan__2026-10-07',
      'b__x__2026-10-07',
      'a___2026-10-07',
      'b_ivan__2024-02-29',
      'b_ivan__2026-02-29',
      'b_ivan__2026-10-7',
      'b_ivan__2026-10-07x',
      'b_ivan__2026-10-07__',
      '__2026-10-07',
      '  __2026-10-07',
      'a/b__2026-10-07',
      'b_ivan_2026-10-07',
      'b_ivan',
      '2026-10-07',
      '',
      '____',
    ]) {
      expect(BusyKey.is(raw), raw).toBe(BusyKey.parse(raw) !== null);
    }
  });

  it('is ⇔ parse(x) !== null for arbitrary keys (property)', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: fc.constantFrom('b', '_', ' ', '/') }),
        fc.string({
          minLength: 8,
          maxLength: 12,
          unit: fc.constantFrom('0', '1', '2', '9', '-', '_'),
        }),
        (barber, tail) => {
          const raw = `${barber}__${tail}`;
          return BusyKey.is(raw) === (BusyKey.parse(raw) !== null);
        },
      ),
    );
  });

  it('is answers false for every other type', () => {
    for (const raw of [null, undefined, 20261007, {}, ['b__2026-10-07']]) {
      expect(BusyKey.is(raw)).toBe(false);
    }
  });

  it('is pure: same input → same answer', () => {
    expect(BusyKey.is('b_ivan__2026-10-07')).toBe(
      BusyKey.is('b_ivan__2026-10-07'),
    );
  });
});
