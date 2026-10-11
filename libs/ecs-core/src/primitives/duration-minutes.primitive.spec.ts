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

  it('between is end − start, refused when empty; sum adds', () => {
    expect(DurationMinutes.between(m(600), e(645))).toEqual({
      ok: true,
      value: 45,
    });
    expect(DurationMinutes.between(m(600), e(600)).ok).toBe(false);
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
});
