import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { deepFreeze, unwrapErr, unwrapOk } from '@core/testing';
import { HourCount } from './hour-count.primitive';

/*
 * OR-45: the free-cancellation window as a brand — one rule for the setting,
 * every stamp on a cancelled seat and the recompute job's late line.
 */
describe('HourCount — whole hours, zero to the time range’s half-width', () => {
  it('MAX is 2,400,000,000 hours — 8.64e15 ms, the time range’s half-width', () => {
    expect(HourCount.MAX).toBe(2_400_000_000);
    expect(HourCount.MAX * 3_600_000).toBe(8_640_000_000_000_000);
    expect(HourCount.ZERO).toBe(0);
  });

  it('of takes every integer in [0, MAX], the boundaries included', () => {
    for (const raw of [0, 1, 24, 168, HourCount.MAX - 1, HourCount.MAX]) {
      expect(HourCount.of(raw)).toEqual({ ok: true, value: raw });
    }
  });

  it('of folds a negative zero — the zero every reader compares against', () => {
    expect(Object.is(unwrapOk(HourCount.of(-0)), 0)).toBe(true);
  });

  it('of refuses anything else as PRIMITIVE_HOUR_COUNT_OUT_OF_RANGE — one past each boundary', () => {
    for (const raw of [
      -1,
      HourCount.MAX + 1,
      1.5,
      0.000001,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(unwrapErr(HourCount.of(raw))).toEqual({
        errorCode: 'PRIMITIVE_HOUR_COUNT_OUT_OF_RANGE',
        raw,
        brand: 'HourCount',
      });
    }
  });

  it('is ⇔ of over numbers, and false for every other type', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: -10, max: 10 }),
          fc.integer({ min: HourCount.MAX - 5, max: HourCount.MAX + 5 }),
          fc.double(),
        ),
        (raw) => HourCount.is(raw) === HourCount.of(raw).ok,
      ),
    );
    for (const raw of [null, undefined, '24', [24], { hours: 24 }, true]) {
      expect(HourCount.is(raw)).toBe(false);
    }
  });

  it('is pure: same input → same output, input untouched', () => {
    const raws = deepFreeze([24, -1, 1.5]);
    const once = raws.map((raw) => HourCount.of(raw));
    const twice = raws.map((raw) => HourCount.of(raw));
    expect(twice).toEqual(once);
    expect(raws).toEqual([24, -1, 1.5]);
  });
});
