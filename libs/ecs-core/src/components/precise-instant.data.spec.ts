import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { UtcEpochMs } from '@core/primitives';
import { unwrapOk } from '@core/testing';
import { PreciseInstant } from './precise-instant.data';

/** An instant literal in epoch ms. */
const at = (ms: number): UtcEpochMs => unwrapOk(UtcEpochMs.of(ms));

const instant = (seconds: number, nanos: number): PreciseInstant => {
  const value = PreciseInstant.of(seconds, nanos);
  if (value === null) throw new Error('unexpected failure in test fixture');
  return value;
};

describe('PreciseInstant.of', () => {
  it('accepts integral seconds and nanos in [0, 1e9)', () => {
    expect(PreciseInstant.of(1_760_000_000, 123_456_789)).toEqual({
      seconds: 1_760_000_000,
      nanos: 123_456_789,
    });
    expect(PreciseInstant.of(0, 0)).toEqual({ seconds: 0, nanos: 0 });
    expect(Object.is(PreciseInstant.of(-0, 0)?.seconds, 0)).toBe(true);
  });

  it('rejects anything else', () => {
    expect(PreciseInstant.of(1.5, 0)).toBeNull();
    expect(PreciseInstant.of(1, -1)).toBeNull();
    expect(PreciseInstant.of(1, 1_000_000_000)).toBeNull();
    expect(PreciseInstant.of(1, 0.5)).toBeNull();
    expect(PreciseInstant.of(Number.NaN, 0)).toBeNull();
    expect(PreciseInstant.of(2 ** 53, 0)).toBeNull();
  });
});

describe('PreciseInstant.compare', () => {
  it('orders two changes inside one millisecond — the microseconds count (§9 D17)', () => {
    // 2026-10-10T10:00:00.123456Z vs …123457Z: equal as epoch ms.
    const a = instant(1_760_090_400, 123_456_000);
    const b = instant(1_760_090_400, 123_457_000);
    expect(PreciseInstant.toEpochMs(a)).toBe(PreciseInstant.toEpochMs(b));
    expect(PreciseInstant.compare(a, b)).toBeLessThan(0);
    expect(PreciseInstant.compare(b, a)).toBeGreaterThan(0);
    expect(PreciseInstant.compare(a, a)).toBe(0);
    expect(PreciseInstant.equals(a, instant(1_760_090_400, 123_456_000))).toBe(
      true,
    );
    expect(PreciseInstant.equals(a, b)).toBe(false);
  });

  it('whole seconds decide before the fraction', () => {
    expect(
      PreciseInstant.compare(instant(10, 999_999_999), instant(11, 0)),
    ).toBeLessThan(0);
  });

  it('agrees with the epoch-ms order wherever the milliseconds differ', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1e12, max: 1e13 }),
        fc.integer({ min: -1e12, max: 1e13 }),
        (x, y) => {
          const order = PreciseInstant.compare(
            PreciseInstant.fromEpochMs(at(x)),
            PreciseInstant.fromEpochMs(at(y)),
          );
          expect(Math.sign(order)).toBe(Math.sign(x - y));
        },
      ),
    );
  });
});

describe('PreciseInstant.fromEpochMs / toEpochMs', () => {
  it('round-trips any integral epoch ms, before 1970 included', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e13, max: 1e13 }), (ms) => {
        const value = PreciseInstant.fromEpochMs(at(ms));
        expect(value.nanos).toBeGreaterThanOrEqual(0);
        expect(value.nanos).toBeLessThan(1_000_000_000);
        expect(PreciseInstant.toEpochMs(value)).toBe(ms);
      }),
    );
  });

  it('splits a literal instant into seconds and nanos', () => {
    expect(PreciseInstant.fromEpochMs(at(1_760_090_400_123))).toEqual({
      seconds: 1_760_090_400,
      nanos: 123_000_000,
    });
    expect(PreciseInstant.fromEpochMs(at(-1))).toEqual({
      seconds: -1,
      nanos: 999_000_000,
    });
  });

  it('toEpochMs truncates the sub-millisecond part, and is null past the UtcEpochMs window', () => {
    expect(PreciseInstant.toEpochMs(instant(1, 999_999))).toBe(1000);
    expect(PreciseInstant.toEpochMs(instant(2 ** 52, 0))).toBeNull();
  });
});

describe('PreciseInstant.LATEST / fromWholeSecond', () => {
  it('LATEST is the D17 bound — the largest safe second, its last nanosecond — and no instant is after it', () => {
    expect(PreciseInstant.LATEST).toEqual(
      PreciseInstant.of(Number.MAX_SAFE_INTEGER, 999_999_999),
    );
    expect(
      PreciseInstant.compare(instant(1_760_090_400, 0), PreciseInstant.LATEST),
    ).toBe(-1);
    expect(
      PreciseInstant.compare(PreciseInstant.LATEST, PreciseInstant.LATEST),
    ).toBe(0);
  });

  it('reads a whole-second instant and its fraction’s nanoseconds as one instant', () => {
    // 2026-10-10T10:00:00.123456789Z: the seconds through the offset, the fraction to the nanosecond.
    expect(
      PreciseInstant.fromWholeSecond(at(1_760_090_400_000), 123_456_789),
    ).toEqual({ seconds: 1_760_090_400, nanos: 123_456_789 });
    expect(PreciseInstant.fromWholeSecond(at(0), 0)).toEqual({
      seconds: 0,
      nanos: 0,
    });
    // Before 1970 the whole second is still the floored quotient.
    expect(PreciseInstant.fromWholeSecond(at(-1000), 5)).toEqual({
      seconds: -1,
      nanos: 5,
    });
  });

  it('is exactly PreciseInstant.of on the floored second — null on nanos outside [0, 1e9)', () => {
    expect(PreciseInstant.fromWholeSecond(at(1000), 1_000_000_000)).toBeNull();
    expect(PreciseInstant.fromWholeSecond(at(1000), -1)).toBeNull();
    fc.assert(
      fc.property(
        fc.integer({ min: -1e10, max: 1e10 }),
        fc.integer({ min: 0, max: 999_999_999 }),
        (seconds, nanos) => {
          expect(
            PreciseInstant.fromWholeSecond(at(seconds * 1000), nanos),
          ).toEqual(PreciseInstant.of(seconds, nanos));
        },
      ),
    );
  });

  it('is pure — same input, same answer', () => {
    const wholeSecond = at(1_760_090_400_000);
    expect(PreciseInstant.fromWholeSecond(wholeSecond, 7)).toEqual(
      PreciseInstant.fromWholeSecond(wholeSecond, 7),
    );
    expect(wholeSecond).toBe(1_760_090_400_000);
  });
});
