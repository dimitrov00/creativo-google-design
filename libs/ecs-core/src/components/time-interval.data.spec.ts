import { describe, expect, it } from 'vitest';
import { TimeInterval } from './time-interval.data';

const m = (minutes: number) => minutes * 60_000;
const iv = (startMin: number, endMin: number) =>
  TimeInterval.of(m(startMin), m(endMin));

describe('TimeInterval', () => {
  it('of() is a plain { startMs, endMs } struct', () => {
    expect(TimeInterval.of(1, 2)).toEqual({ startMs: 1, endMs: 2 });
  });

  it('durationMinutes measures the span', () => {
    expect(TimeInterval.durationMinutes(iv(600, 645))).toBe(45);
  });

  it('overlaps is half-open: back-to-back seats do not collide', () => {
    expect(TimeInterval.overlaps(iv(600, 645), iv(630, 700))).toBe(true);
    expect(TimeInterval.overlaps(iv(600, 645), iv(645, 700))).toBe(false);
    expect(TimeInterval.overlaps(iv(645, 700), iv(600, 645))).toBe(false);
  });

  it('contains includes touching edges and refuses a spill', () => {
    expect(TimeInterval.contains(iv(540, 720), iv(540, 600))).toBe(true);
    expect(TimeInterval.contains(iv(540, 720), iv(700, 720))).toBe(true);
    expect(TimeInterval.contains(iv(540, 720), iv(700, 721))).toBe(false);
    expect(TimeInterval.contains(iv(540, 720), iv(539, 600))).toBe(false);
  });

  it('pad grows outward by the given minutes', () => {
    expect(TimeInterval.pad(iv(60, 90), 10, 15)).toEqual(iv(50, 105));
  });

  it('equals compares both ends', () => {
    expect(TimeInterval.equals(iv(1, 2), iv(1, 2))).toBe(true);
    expect(TimeInterval.equals(iv(1, 2), iv(1, 3))).toBe(false);
  });
});
