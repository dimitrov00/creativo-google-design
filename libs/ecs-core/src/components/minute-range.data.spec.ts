import { describe, expect, it } from 'vitest';
import { MinuteRange } from './minute-range.data';

const r = (start: number, end: number) => MinuteRange.of(start, end);

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
