import { describe, expect, it } from 'vitest';
import { unwrapErr, unwrapOk } from '@core/testing';
import { DurationMinutes, MinuteCount } from './duration-minutes.primitive';
import { EndMinute, MinuteOfDay } from './minute-of-day.primitive';

const m = (raw: number) => unwrapOk(MinuteOfDay.of(raw));
const e = (raw: number) => unwrapOk(EndMinute.of(raw));
const count = (raw: number) => unwrapOk(MinuteCount.of(raw));

describe('MinuteOfDay — a point in [0, 1440)', () => {
  it('of takes an integer in range and refuses anything else', () => {
    expect(MinuteOfDay.of(0)).toEqual({ ok: true, value: 0 });
    expect(MinuteOfDay.of(1439)).toEqual({ ok: true, value: 1439 });
    for (const raw of [-1, 1440, 600.5, Number.NaN]) {
      expect(unwrapErr(MinuteOfDay.of(raw))).toEqual({
        errorCode: 'PRIMITIVE_MINUTE_OUT_OF_RANGE',
        raw,
        brand: 'MinuteOfDay',
      });
    }
  });

  it('ofProven brands a minute the caller already holds in range, allocating nothing; out of range is a defect', () => {
    expect(MinuteOfDay.ofProven(0)).toBe(0);
    expect(MinuteOfDay.ofProven(1439)).toBe(1439);
    for (const raw of [-1, 1440, 600.5]) {
      expect(() => MinuteOfDay.ofProven(raw)).toThrow(/defect/);
    }
  });

  it('LAST is the day’s last minute: a MinuteOfDay, and the next one is off the clock', () => {
    expect(MinuteOfDay.LAST).toBe(1439);
    expect(MinuteOfDay.of(MinuteOfDay.LAST)).toEqual({ ok: true, value: 1439 });
    expect(MinuteOfDay.of(MinuteOfDay.LAST + 1).ok).toBe(false);
  });

  it('addClamped and minusClamped keep the brand inside the day', () => {
    expect(MinuteOfDay.addClamped(m(600), count(45))).toBe(645);
    expect(MinuteOfDay.addClamped(m(1430), count(45))).toBe(1439);
    expect(MinuteOfDay.minusClamped(m(600), count(45))).toBe(555);
    expect(MinuteOfDay.minusClamped(m(10), count(45))).toBe(0);
  });

  it('ofOpenEnd reads an end proven below midnight as a start; 1440 is a defect', () => {
    expect(MinuteOfDay.ofOpenEnd(e(630))).toBe(630);
    expect(MinuteOfDay.ofOpenEnd(e(1439))).toBe(1439);
    expect(() => MinuteOfDay.ofOpenEnd(e(1440))).toThrow(/defect/);
  });

  it('fromEnd reads an exclusive end as the next start, refusing midnight', () => {
    expect(MinuteOfDay.fromEnd(e(645))).toEqual({ ok: true, value: 645 });
    expect(unwrapErr(MinuteOfDay.fromEnd(e(1440))).errorCode).toBe(
      'PRIMITIVE_MINUTE_OUT_OF_RANGE',
    );
  });
});

describe('EndMinute — an exclusive end in (0, 1440] (F-1)', () => {
  it('of takes the closing midnight and refuses zero', () => {
    expect(EndMinute.of(1440)).toEqual({ ok: true, value: 1440 });
    expect(EndMinute.of(1)).toEqual({ ok: true, value: 1 });
    for (const raw of [0, 1441, 1.5]) {
      expect(unwrapErr(EndMinute.of(raw))).toEqual({
        errorCode: 'PRIMITIVE_MINUTE_OUT_OF_RANGE',
        raw,
        brand: 'EndMinute',
      });
    }
  });

  it('ofProven brands an end the caller already holds in range; out of range is a defect', () => {
    expect(EndMinute.ofProven(1)).toBe(1);
    expect(EndMinute.ofProven(1440)).toBe(1440);
    for (const raw of [0, 1441, 1.5]) {
      expect(() => EndMinute.ofProven(raw)).toThrow(/defect/);
    }
  });

  it('after ends a span, refused past midnight', () => {
    const half = unwrapOk(DurationMinutes.of(30));
    expect(EndMinute.after(m(600), half)).toEqual({ ok: true, value: 630 });
    expect(EndMinute.after(m(1410), half)).toEqual({ ok: true, value: 1440 });
    expect(unwrapErr(EndMinute.after(m(1420), half)).raw).toBe(1450);
  });

  it('ofLaterStart reads a start proven above midnight as an end; 0 is a defect', () => {
    expect(EndMinute.ofLaterStart(m(600))).toBe(600);
    expect(EndMinute.ofLaterStart(m(1))).toBe(1);
    expect(() => EndMinute.ofLaterStart(m(0))).toThrow(/defect/);
  });

  it('plusClamped stops at the closing midnight; toStart is fromEnd', () => {
    expect(EndMinute.plusClamped(e(600), count(30))).toBe(630);
    expect(EndMinute.plusClamped(e(1430), count(30))).toBe(1440);
    expect(EndMinute.toStart(e(630))).toEqual({ ok: true, value: 630 });
  });
});
