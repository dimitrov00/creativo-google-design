import { describe, expect, it } from 'vitest';
import { unwrapErr, unwrapOk, utcMs } from '../testing';
import { MinuteDelta } from './duration-minutes.primitive';
import { UtcEpochMs } from './utc-epoch-ms.primitive';

/*
 * The successor of `components/zoned-instant.data.spec.ts` (flatten-spec
 * §2.2): an instant is a bare `UtcEpochMs`; its zone is the location's.
 */
const at = (raw: number) => unwrapOk(UtcEpochMs.of(raw));

describe('UtcEpochMs — an absolute instant', () => {
  it('of takes a safe integer inside the years 0001–9999', () => {
    expect(UtcEpochMs.of(0)).toEqual({ ok: true, value: 0 });
    expect(UtcEpochMs.of(-62_135_596_800_000).ok).toBe(true);
    expect(UtcEpochMs.of(253_402_300_799_999).ok).toBe(true);
    for (const raw of [
      -62_135_596_800_001,
      253_402_300_800_000,
      1.5,
      Number.NaN,
    ]) {
      expect(unwrapErr(UtcEpochMs.of(raw))).toEqual({
        errorCode: 'PRIMITIVE_UTC_EPOCH_MS_INVALID',
        raw,
        brand: 'UtcEpochMs',
      });
    }
  });

  it('compares by instant, never by rendering (the autumn fall-back)', () => {
    // 03:30+03:00 is earlier than 03:30+02:00 although the strings sort the other way.
    const first = utcMs('2026-10-25T03:30:00+03:00');
    const second = utcMs('2026-10-25T03:30:00+02:00');
    expect(UtcEpochMs.compare(first, second)).toBe(-1);
    expect(UtcEpochMs.compare(second, first)).toBe(1);
    expect(UtcEpochMs.compare(first, first)).toBe(0);
  });

  it('measures real elapsed time between instants — the autumn fall-back hour counts once', () => {
    const first = utcMs('2026-10-25T03:30:00+03:00');
    const second = utcMs('2026-10-25T03:30:00+02:00');
    expect(UtcEpochMs.elapsedMs(first, second)).toBe(3_600_000);
    expect(UtcEpochMs.elapsedMs(second, first)).toBe(-3_600_000);
    expect(UtcEpochMs.elapsedMs(first, first)).toBe(0);
  });

  it('plus* is exact elapsed arithmetic (T2 only, G-1)', () => {
    const t = at(1_000);
    expect(UtcEpochMs.plusMs(t, 500)).toBe(1_500);
    expect(UtcEpochMs.plusMinutes(t, unwrapOk(MinuteDelta.of(-1)))).toBe(
      -59_000,
    );
    expect(UtcEpochMs.plusHours(t, 2)).toBe(7_201_000);
    expect(UtcEpochMs.plusDays(t, 1)).toBe(86_401_000);
  });
});
