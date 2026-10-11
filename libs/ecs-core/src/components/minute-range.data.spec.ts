import { describe, expect, it } from 'vitest';
import { MinuteRange } from './minute-range.data';
import { MinuteCount } from '../primitives/duration-minutes.primitive';
import { endMinute, minute, unwrapOk as okOf } from '../testing';

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
