import { describe, expect, it } from 'vitest';
import { unwrapErr, unwrapOk } from '@core/testing';
import { DurationMinutes, MinuteCount } from './duration-minutes.primitive';
import { EndMinute, MinuteOfDay, TrackMinute } from './minute-of-day.primitive';

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

describe('MinuteOfDay.parseClock — typed clock text, the edge (pass D, DEP-22)', () => {
  it('reads one or two hour digits and two minute digits as the minute they name', () => {
    expect(MinuteOfDay.parseClock('9:05')).toEqual({ ok: true, value: 545 });
    expect(MinuteOfDay.parseClock('09:05')).toEqual({ ok: true, value: 545 });
    expect(MinuteOfDay.parseClock('0:00')).toEqual({ ok: true, value: 0 });
    expect(MinuteOfDay.parseClock('23:59')).toEqual({ ok: true, value: 1439 });
  });

  it('trims first, as both editors’ fields always did — " 10:30 " is 10:30 (unchanged)', () => {
    expect(MinuteOfDay.parseClock(' 10:30 ')).toEqual({ ok: true, value: 630 });
    expect(MinuteOfDay.parseClock('\t7:15\n')).toEqual({
      ok: true,
      value: 435,
    });
  });

  it('refuses anything that is not a strict HH:MM of the day, echoing the text as received', () => {
    for (const raw of [
      '24:00',
      '10:30:00', // the visit editor's unanchored parser accepted it (DEP-22)
      '10:30x', // the same (DEP-22)
      '9:75', // the block editor's parser read it as 10:15 (unreachable through ui-time-field)
      '23:60',
      '',
      '   ',
      '7',
      'ab:cd',
      '123:00',
      '10:3',
      '-1:00',
    ]) {
      expect(unwrapErr(MinuteOfDay.parseClock(raw))).toEqual({
        errorCode: 'PRIMITIVE_MINUTE_OUT_OF_RANGE',
        raw,
        brand: 'MinuteOfDay',
      });
    }
  });

  it('is pure: same input → same output', () => {
    expect(MinuteOfDay.parseClock('10:30')).toEqual(
      MinuteOfDay.parseClock('10:30'),
    );
    expect(MinuteOfDay.parseClock('10:30x')).toEqual(
      MinuteOfDay.parseClock('10:30x'),
    );
  });
});

describe('TrackMinute — a minute on a frame’s anchored axis (pass D, D-5)', () => {
  const t = (raw: number) => unwrapOk(TrackMinute.of(raw));

  it('of takes every non-negative safe integer — no upper bound', () => {
    for (const raw of [0, 545, 1439, 1440, 1455, 2880]) {
      expect(TrackMinute.of(raw)).toEqual({ ok: true, value: raw });
    }
    expect(Object.is(t(-0), 0)).toBe(true);
  });

  it('of refuses a negative, a fraction and a non-number as flat PrimitiveErrors', () => {
    for (const raw of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(unwrapErr(TrackMinute.of(raw))).toEqual({
        errorCode: 'PRIMITIVE_MINUTE_OUT_OF_RANGE',
        raw,
        brand: 'TrackMinute',
      });
    }
  });

  it('ofProven brands a minute the caller holds on the track; off the track is a defect', () => {
    expect(TrackMinute.ofProven(0)).toBe(0);
    expect(TrackMinute.ofProven(1455)).toBe(1455);
    for (const raw of [-1, 1.5, Number.NaN]) {
      expect(() => TrackMinute.ofProven(raw)).toThrow(/defect/);
    }
  });

  it('a start and an end of the day are track minutes as they are', () => {
    const start: TrackMinute = m(1405);
    const end: TrackMinute = e(1440);
    expect(TrackMinute.span(start, end)).toBe(35);
  });

  it('plus moves along the axis past the closing midnight', () => {
    expect(TrackMinute.plus(t(1405), count(50))).toBe(1455);
    expect(TrackMinute.plus(t(600), unwrapOk(DurationMinutes.of(30)))).toBe(
      630,
    );
    expect(TrackMinute.plus(t(0), MinuteCount.ZERO)).toBe(0);
  });

  it('span is to − from, 0 when empty or inverted', () => {
    expect(TrackMinute.span(t(1405), t(1455))).toBe(50);
    expect(TrackMinute.span(t(600), t(600))).toBe(0);
    expect(TrackMinute.span(t(1455), t(1405))).toBe(0);
  });

  it('toStart reads 0 and 1439 back onto the clock, refusing 1440 and 1455', () => {
    expect(TrackMinute.toStart(t(0))).toEqual({ ok: true, value: 0 });
    expect(TrackMinute.toStart(t(1439))).toEqual({ ok: true, value: 1439 });
    for (const raw of [1440, 1455]) {
      expect(unwrapErr(TrackMinute.toStart(t(raw)))).toEqual({
        errorCode: 'PRIMITIVE_MINUTE_OUT_OF_RANGE',
        raw,
        brand: 'MinuteOfDay',
      });
    }
  });

  it('toEnd reads 1439 and 1440 back as exclusive ends, refusing 0 and 1455', () => {
    expect(TrackMinute.toEnd(t(1439))).toEqual({ ok: true, value: 1439 });
    expect(TrackMinute.toEnd(t(1440))).toEqual({ ok: true, value: 1440 });
    for (const raw of [0, 1455]) {
      expect(unwrapErr(TrackMinute.toEnd(t(raw)))).toEqual({
        errorCode: 'PRIMITIVE_MINUTE_OUT_OF_RANGE',
        raw,
        brand: 'EndMinute',
      });
    }
  });

  it('is pure: same input → same output', () => {
    expect(TrackMinute.of(1455)).toEqual(TrackMinute.of(1455));
    expect(TrackMinute.plus(t(1405), count(50))).toBe(
      TrackMinute.plus(t(1405), count(50)),
    );
    expect(TrackMinute.span(t(1), t(9))).toBe(TrackMinute.span(t(1), t(9)));
    expect(TrackMinute.toStart(t(1440))).toEqual(TrackMinute.toStart(t(1440)));
    expect(TrackMinute.toEnd(t(1440))).toEqual(TrackMinute.toEnd(t(1440)));
  });
});

describe('MinuteOfDay.is and EndMinute.is — the read-time doors (edge hardening D-1)', () => {
  /** The constructors' own domain: numbers, valid, boundary, off by one and broken. */
  const NUMBERS = [
    0,
    -0,
    1,
    600,
    1439,
    1440,
    1441,
    -1,
    10.5,
    0.0001,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.MAX_SAFE_INTEGER,
  ];

  it('MinuteOfDay.is ⇔ of over every number of the table', () => {
    for (const raw of NUMBERS) {
      expect(MinuteOfDay.is(raw), String(raw)).toBe(MinuteOfDay.of(raw).ok);
    }
    for (let raw = -2; raw <= 1442; raw++) {
      expect(MinuteOfDay.is(raw)).toBe(MinuteOfDay.of(raw).ok);
    }
  });

  it('EndMinute.is ⇔ of over every number of the table', () => {
    for (const raw of NUMBERS) {
      expect(EndMinute.is(raw), String(raw)).toBe(EndMinute.of(raw).ok);
    }
    for (let raw = -2; raw <= 1442; raw++) {
      expect(EndMinute.is(raw)).toBe(EndMinute.of(raw).ok);
    }
  });

  it('both answer false for every other type — a string minute included', () => {
    for (const raw of [null, undefined, '600', '', {}, [], [600], true]) {
      expect(MinuteOfDay.is(raw)).toBe(false);
      expect(EndMinute.is(raw)).toBe(false);
    }
  });
});
