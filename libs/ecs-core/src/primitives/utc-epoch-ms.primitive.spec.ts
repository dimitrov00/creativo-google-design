import { describe, expect, it } from 'vitest';
import { unwrapErr, unwrapOk, utcMs } from '@core/testing';
import { MinuteDelta } from './duration-minutes.primitive';
import { HourCount } from './hour-count.primitive';
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

  it('EPOCH is the Unix epoch, 0, as a proven brand (pass D)', () => {
    expect(UtcEpochMs.EPOCH).toBe(0);
    expect(UtcEpochMs.of(0)).toEqual({ ok: true, value: UtcEpochMs.EPOCH });
    expect(UtcEpochMs.compare(UtcEpochMs.EPOCH, at(1))).toBe(-1);
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

  it('minusHours takes whole hours off an instant — the window’s deadline, exact to the end of the range (OR-45)', () => {
    const hours = (raw: number) => unwrapOk(HourCount.of(raw));
    const t = at(7_201_000);
    expect(UtcEpochMs.minusHours(t, hours(2))).toBe(1_000);
    expect(UtcEpochMs.minusHours(t, HourCount.ZERO)).toBe(7_201_000);
    expect(UtcEpochMs.minusHours(t, hours(24))).toBe(
      UtcEpochMs.plusHours(t, -24),
    );
    // The longest window off the epoch: −8.64e15 ms, still a safe integer.
    const deadline = UtcEpochMs.minusHours(UtcEpochMs.EPOCH, HourCount.MAX);
    expect(deadline).toBe(-8_640_000_000_000_000);
    expect(Number.isSafeInteger(deadline)).toBe(true);
  });

  it('minusHours is pure: same input → same output', () => {
    const t = at(86_400_000);
    const h = unwrapOk(HourCount.of(6));
    expect(UtcEpochMs.minusHours(t, h)).toBe(UtcEpochMs.minusHours(t, h));
    expect(t).toBe(86_400_000);
  });
});

describe('UtcEpochMs.is and MAX — the read-time door (edge hardening D-1)', () => {
  const MAX = 253_402_300_799_999;
  const MIN = -62_135_596_800_000;

  it('MAX is the last instant of 9999 the constructor takes', () => {
    expect(UtcEpochMs.MAX).toBe(MAX);
    expect(UtcEpochMs.of(UtcEpochMs.MAX).ok).toBe(true);
    expect(UtcEpochMs.of(UtcEpochMs.MAX + 1).ok).toBe(false);
  });

  it('is ⇔ of over the constructor’s own domain — numbers', () => {
    for (const raw of [
      0,
      -0,
      1,
      -1,
      1_790_575_200_000,
      MAX,
      MAX + 1,
      MIN,
      MIN - 1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER + 2,
    ]) {
      expect(UtcEpochMs.is(raw), String(raw)).toBe(UtcEpochMs.of(raw).ok);
    }
  });

  it('is answers false for every other type — an ISO string or a Timestamp-like included', () => {
    for (const raw of [
      null,
      undefined,
      '1790575200000',
      '2026-09-28T06:00:00Z',
      { seconds: 1, nanoseconds: 0 },
      [],
      true,
    ]) {
      expect(UtcEpochMs.is(raw)).toBe(false);
    }
  });
});
