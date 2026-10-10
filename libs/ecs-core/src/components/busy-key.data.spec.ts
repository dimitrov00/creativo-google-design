import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BarberId } from '../entities/barber.entity';
import { BusyKey } from './busy-key.data';
import { DayKey } from './day-key.data';

const IVAN = BarberId.of('ivan');
const DAY = DayKey.of('2026-10-07');

describe('BusyKey.of — the only builder', () => {
  it('joins the barber and the day with a DOUBLE underscore', () => {
    expect(BusyKey.of(IVAN, DAY)).toBe('ivan__2026-10-07');
  });
});

describe('BusyKey.split', () => {
  it('splits at the LAST double underscore', () => {
    expect(BusyKey.split(BusyKey.of(IVAN, DAY))).toEqual({
      barberId: 'ivan',
      dayKey: '2026-10-07',
    });
  });

  it('keeps a barber id that itself contains a double underscore whole', () => {
    const odd = BarberId.of('b__x');
    expect(BusyKey.split(BusyKey.of(odd, DAY))).toEqual({
      barberId: 'b__x',
      dayKey: '2026-10-07',
    });
  });

  it('round-trips any barber id and real day (property)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.integer({ min: -1000, max: 40_000 }),
        (rawBarber, epochDay) => {
          const barberId = BarberId.of(rawBarber);
          const dayKey = DayKey.fromEpochDay(epochDay);
          const key = BusyKey.of(barberId, dayKey);
          expect(BusyKey.split(key)).toEqual({ barberId, dayKey });
          expect(BusyKey.parse(key)).toBe(key);
        },
      ),
    );
  });
});

describe('BusyKey.parse — the edge guard', () => {
  it('accepts a stored key, spelt exactly as a built one', () => {
    expect(BusyKey.parse('ivan__2026-10-07')).toBe(BusyKey.of(IVAN, DAY));
  });

  it.each([
    'ivan_2026-10-07',
    '__2026-10-07',
    'ivan__2026-02-30',
    'ivan__',
    'ivan',
    '',
  ])('refuses %j', (raw) => {
    expect(BusyKey.parse(raw)).toBeNull();
  });
});
