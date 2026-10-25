import { describe, expect, it } from 'vitest';
import { unwrapErr, unwrapOk } from '@core/testing';
import {
  DurationMinutes,
  MinuteCount,
  MinuteDelta,
} from './duration-minutes.primitive';
import { EndMinute, MinuteOfDay } from './minute-of-day.primitive';

const m = (raw: number) => unwrapOk(MinuteOfDay.of(raw));
const e = (raw: number) => unwrapOk(EndMinute.of(raw));

describe('DurationMinutes — a positive whole number of minutes', () => {
  it('of takes an integer > 0', () => {
    expect(DurationMinutes.of(30)).toEqual({ ok: true, value: 30 });
    for (const raw of [0, -5, 2.5]) {
      expect(unwrapErr(DurationMinutes.of(raw))).toEqual({
        errorCode: 'PRIMITIVE_DURATION_NOT_POSITIVE',
        raw,
        brand: 'DurationMinutes',
      });
    }
  });

  it('sum adds', () => {
    const half = unwrapOk(DurationMinutes.of(30));
    expect(DurationMinutes.sum(half, half)).toBe(60);
  });
});

describe('MinuteCount — a non-negative whole number of minutes', () => {
  it('of takes an integer ≥ 0, folding a negative zero', () => {
    expect(MinuteCount.of(0)).toEqual({ ok: true, value: 0 });
    expect(Object.is(unwrapOk(MinuteCount.of(-0)), 0)).toBe(true);
    expect(unwrapErr(MinuteCount.of(-1))).toEqual({
      errorCode: 'PRIMITIVE_MINUTE_COUNT_NEGATIVE',
      raw: -1,
      brand: 'MinuteCount',
    });
  });

  it('ZERO, add, span and fromDuration', () => {
    const ten = unwrapOk(MinuteCount.of(10));
    expect(MinuteCount.add(MinuteCount.ZERO, ten)).toBe(10);
    expect(MinuteCount.span(m(600), e(645))).toBe(45);
    expect(MinuteCount.span(m(600), e(500))).toBe(0);
    expect(MinuteCount.fromDuration(unwrapOk(DurationMinutes.of(5)))).toBe(5);
  });

  it('fromDelta keeps the minutes beyond and reads a shortfall as none, never -0 (pass D)', () => {
    const d = (raw: number) => unwrapOk(MinuteDelta.of(raw));
    expect(MinuteCount.fromDelta(d(15))).toBe(15);
    expect(MinuteCount.fromDelta(d(-15))).toBe(0);
    expect(Object.is(MinuteCount.fromDelta(d(-0)), 0)).toBe(true);
    expect(Object.is(MinuteCount.fromDelta(d(0)), 0)).toBe(true);
    // Pure: the same delta, the same count, the input untouched.
    const fifteen = d(15);
    expect(MinuteCount.fromDelta(fifteen)).toBe(MinuteCount.fromDelta(fifteen));
    expect(fifteen).toBe(15);
  });
});

describe('MinuteDelta — a signed whole number of minutes', () => {
  it('of takes any safe integer', () => {
    expect(MinuteDelta.of(-90)).toEqual({ ok: true, value: -90 });
    expect(unwrapErr(MinuteDelta.of(0.5))).toEqual({
      errorCode: 'PRIMITIVE_MINUTE_DELTA_NOT_INTEGER',
      raw: 0.5,
      brand: 'MinuteDelta',
    });
  });

  it('between two wall-clock points is signed', () => {
    expect(MinuteDelta.between(m(600), m(645))).toBe(45);
    expect(MinuteDelta.between(m(645), m(600))).toBe(-45);
  });

  it('between takes an exclusive end on either side, the closing midnight included (pass D)', () => {
    expect(MinuteDelta.between(m(1410), e(1440))).toBe(30);
    expect(MinuteDelta.between(e(1440), m(1410))).toBe(-30);
    expect(MinuteDelta.between(e(600), e(1440))).toBe(840);
    expect(MinuteDelta.between(m(0), e(1440))).toBe(1440);
  });

  it('fromDuration reads a positive duration as a delta', () => {
    const ninety = unwrapOk(DurationMinutes.of(90));
    expect(MinuteDelta.fromDuration(ninety)).toBe(90);
  });

  it('is pure: same input → same output', () => {
    const d = unwrapOk(DurationMinutes.of(15));
    expect(MinuteDelta.fromDuration(d)).toBe(MinuteDelta.fromDuration(d));
    expect(MinuteDelta.between(m(5), e(1440))).toBe(
      MinuteDelta.between(m(5), e(1440)),
    );
  });
});

describe('DurationMinutes.is and MinuteCount.is — the read-time doors (edge hardening D-1)', () => {
  const NUMBERS = [
    0,
    -0,
    1,
    30,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER + 2,
  ];

  it('each is ⇔ its constructor over the numbers', () => {
    for (const raw of NUMBERS) {
      expect(DurationMinutes.is(raw), String(raw)).toBe(
        DurationMinutes.of(raw).ok,
      );
      expect(MinuteCount.is(raw), String(raw)).toBe(MinuteCount.of(raw).ok);
    }
  });

  it('both answer false for every other type', () => {
    for (const raw of [null, undefined, '30', {}, [], [30], false]) {
      expect(DurationMinutes.is(raw)).toBe(false);
      expect(MinuteCount.is(raw)).toBe(false);
    }
  });
});
