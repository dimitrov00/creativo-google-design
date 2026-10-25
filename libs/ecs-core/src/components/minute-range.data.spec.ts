import { describe, expect, it } from 'vitest';
import { MinuteRange } from './minute-range.data';
import { MinuteCount } from '@core/primitives';
import { deepFreeze, endMinute, minute, unwrapOk as okOf } from '@core/testing';

const count = (n: number): MinuteCount => okOf(MinuteCount.of(n));

const r = (start: number, end: number) =>
  MinuteRange.of(minute(start), endMinute(end));

describe('MinuteRange', () => {
  it('of() is a plain { startMinutes, endMinutes } struct', () => {
    expect(r(540, 720)).toEqual({ startMinutes: 540, endMinutes: 720 });
  });

  it('durationMinutes measures the span', () => {
    expect(MinuteRange.durationMinutes(r(540, 720))).toBe(180);
  });

  it('overlaps is half-open, so 09:00–12:00 and 12:00–17:00 do not overlap', () => {
    expect(MinuteRange.overlaps(r(540, 720), r(720, 1020))).toBe(false);
    expect(MinuteRange.overlaps(r(540, 720), r(700, 1020))).toBe(true);
    expect(MinuteRange.overlaps(r(700, 1020), r(540, 720))).toBe(true);
  });
});

describe('MinuteRange.normalize', () => {
  it('sorts and merges overlapping spans', () => {
    expect(MinuteRange.normalize([r(660, 780), r(480, 720)])).toEqual([
      r(480, 780),
    ]);
  });

  it('merges ABUTTING spans — one continuous morning is one row', () => {
    expect(MinuteRange.normalize([r(480, 720), r(720, 900)])).toEqual([
      r(480, 900),
    ]);
  });

  it('keeps separate spans apart and drops empty or inverted ones', () => {
    expect(
      MinuteRange.normalize([
        r(900, 960),
        r(480, 600),
        r(600, 600),
        r(700, 650),
      ]),
    ).toEqual([r(480, 600), r(900, 960)]);
  });

  it('swallows a span inside a longer one', () => {
    expect(MinuteRange.normalize([r(480, 900), r(540, 600)])).toEqual([
      r(480, 900),
    ]);
    // Equal starts sort by end, so the longer run wins either way round.
    expect(MinuteRange.normalize([r(480, 900), r(480, 600)])).toEqual([
      r(480, 900),
    ]);
  });

  it('is empty for nothing, and never touches its input', () => {
    expect(MinuteRange.normalize([])).toEqual([]);
    const input = [r(720, 900), r(480, 720)];
    MinuteRange.normalize(input);
    expect(input).toEqual([r(720, 900), r(480, 720)]);
  });
});

describe('MinuteRange.contains / pad (folded in from time-interval.data.spec.ts)', () => {
  it('contains: inner wholly inside outer, touching edges included', () => {
    expect(MinuteRange.contains(r(540, 720), r(540, 720))).toBe(true);
    expect(MinuteRange.contains(r(540, 720), r(600, 660))).toBe(true);
    expect(MinuteRange.contains(r(540, 720), r(530, 600))).toBe(false);
    expect(MinuteRange.contains(r(540, 720), r(700, 730))).toBe(false);
  });

  it('pad grows outward by the given minutes', () => {
    expect(MinuteRange.pad(r(600, 645), count(10), count(15))).toEqual(
      r(590, 660),
    );
  });

  it('pad is clamped to the shop day, [0, 1440] (T7)', () => {
    expect(MinuteRange.pad(r(5, 1435), count(10), count(10))).toEqual(
      r(0, 1440),
    );
  });

  it('durationMinutes is end − start', () => {
    expect(MinuteRange.durationMinutes(r(600, 645))).toBe(45);
  });
});

describe('MinuteRange.fieldFault — the read-time check of a stored range (edge hardening D-1)', () => {
  it('answers null for a well-formed range, the day’s own bounds included', () => {
    expect(MinuteRange.fieldFault({ startMinutes: 540, endMinutes: 720 })).toBe(
      null,
    );
    expect(MinuteRange.fieldFault({ startMinutes: 0, endMinutes: 1440 })).toBe(
      null,
    );
    expect(
      MinuteRange.fieldFault(MinuteRange.of(minute(600), endMinute(645))),
    ).toBeNull();
  });

  it('names startMinutes when it is no MinuteOfDay', () => {
    for (const startMinutes of [-1, 1440, 10.5, Number.NaN, '540', null]) {
      expect(
        MinuteRange.fieldFault({ startMinutes, endMinutes: 720 }),
        String(startMinutes),
      ).toBe('startMinutes');
    }
    expect(MinuteRange.fieldFault({ endMinutes: 720 })).toBe('startMinutes');
  });

  it('names endMinutes when it is no EndMinute', () => {
    for (const endMinutes of [0, 1441, 700.5, Number.NaN, '720', null]) {
      expect(
        MinuteRange.fieldFault({ startMinutes: 540, endMinutes }),
        String(endMinutes),
      ).toBe('endMinutes');
    }
  });

  it('names endMinutes for an empty or inverted range — start < end is the range’s own check', () => {
    expect(MinuteRange.fieldFault({ startMinutes: 600, endMinutes: 600 })).toBe(
      'endMinutes',
    );
    expect(MinuteRange.fieldFault({ startMinutes: 700, endMinutes: 600 })).toBe(
      'endMinutes',
    );
  });

  it('is pure: same input → same output, the input untouched', () => {
    const raw = deepFreeze({ startMinutes: 700, endMinutes: 600 });
    expect(MinuteRange.fieldFault(raw)).toBe(MinuteRange.fieldFault(raw));
    expect(raw).toEqual({ startMinutes: 700, endMinutes: 600 });
  });
});
