import { describe, expect, it } from 'vitest';
import { unwrapErr } from '../testing';
import { EpochSeconds, SubsecondNanos } from './precise-instant.primitive';

describe('EpochSeconds / SubsecondNanos — the D17 precise instant (§1.6)', () => {
  it('EpochSeconds takes a safe integer', () => {
    expect(EpochSeconds.of(1_790_575_200)).toEqual({
      ok: true,
      value: 1_790_575_200,
    });
    expect(unwrapErr(EpochSeconds.of(1.5))).toEqual({
      errorCode: 'PRIMITIVE_EPOCH_SECONDS_INVALID',
      raw: 1.5,
      brand: 'EpochSeconds',
    });
  });

  it('SubsecondNanos takes an integer in [0, 1e9)', () => {
    expect(SubsecondNanos.of(0).ok).toBe(true);
    expect(SubsecondNanos.of(999_999_999).ok).toBe(true);
    for (const raw of [-1, 1_000_000_000, 0.5]) {
      expect(unwrapErr(SubsecondNanos.of(raw))).toEqual({
        errorCode: 'PRIMITIVE_SUBSECOND_NANOS_OUT_OF_RANGE',
        raw,
        brand: 'SubsecondNanos',
      });
    }
  });
});
