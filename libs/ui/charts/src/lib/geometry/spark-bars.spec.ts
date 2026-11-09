import { describe, expect, it } from 'vitest';
import { sparkBarRects, type SparkBarRect } from './spark-bars';

// The literals below were computed apart from this code (a plain node
// script over the slot arithmetic), not read off its output.
const box = (rect: SparkBarRect): string =>
  [rect.x, rect.y, rect.width, rect.height, rect.rx, rect.ry].join(' ');

describe('sparkBarRects', () => {
  it('centres a bar in each of n even slots, 55 % of the slot, corners round to 6, standing on the bottom, zero-anchored', () => {
    // 160 ÷ 7 = 22.86 a slot: 55 % of it is 12.57 (under the 24 cap).
    expect(sparkBarRects([3, 5, 0, 8, 2, 8, 4], 160, 48, 8).map(box)).toEqual([
      '5.14 30 12.57 18 6 6',
      '28 18 12.57 30 6 6',
      // A zero: a 2 px stub, round at both ends (ry is half its height).
      '50.86 46 12.57 2 6 1',
      '73.71 0 12.57 48 6 6',
      '96.57 36 12.57 12 6 6',
      '119.43 0 12.57 48 6 6',
      '142.29 24 12.57 24 6 6',
    ]);
  });

  it('caps a bar at 24 px however few, and draws each bar’s track — its whole — behind it on the same scale', () => {
    // 345 ÷ 3 = 115 a slot: 55 % is 63.25, capped at 24.
    const rects = sparkBarRects([2, 5, 0], 345, 56, 8, [4, 8, 0]);
    expect(rects.map(box)).toEqual([
      '45.5 42 24 14 6 6',
      '160.5 21 24 35 6 6',
      '275.5 54 24 2 6 1',
    ]);
    expect(rects.map((rect) => rect.track)).toEqual([
      { y: 28, height: 28, ry: 6 },
      { y: 0, height: 56, ry: 6 },
      // A day with no working time has no track.
      null,
    ]);
    // Without tracks, none.
    expect(sparkBarRects([1], 40, 48, 1)[0]?.track).toBeNull();
  });

  it('thins a crowded run so at least 3 px of air stays between bars', () => {
    // 20 ÷ 4 = 5 a slot: 55 % is 2.75, but 5 − 3 leaves only 2.
    expect(sparkBarRects([1, 0, -2, 1], 20, 30, 1).map(box)).toEqual([
      '1.5 0 2 30 1 1',
      '6.5 28 2 2 1 1',
      // A negative value counts as zero: the stub.
      '11.5 28 2 2 1 1',
      '16.5 0 2 30 1 1',
    ]);
    // A month in a tile: 160 ÷ 30 = 5.33 a slot, 2.33 wide.
    const month = Array.from({ length: 30 }, (_, i) => i % 5);
    expect(sparkBarRects(month, 160, 48, 4).slice(0, 2).map(box)).toEqual([
      '1.5 46 2.33 2 1.17 1',
      '6.83 36 2.33 12 1.17 1.17',
    ]);
  });

  it('draws a sliver as the stub, and every bar as a stub for a zero top', () => {
    expect(sparkBarRects([0.01, 4], 40, 48, 4).map(box)).toEqual([
      '4.5 46 11 2 5.5 1',
      '24.5 0 11 48 5.5 5.5',
    ]);
    expect(sparkBarRects([0, 0], 100, 48, 0).map(box)).toEqual([
      '13 46 24 2 6 1',
      '63 46 24 2 6 1',
    ]);
  });

  it('draws nothing for no values, and never mutates its input', () => {
    expect(sparkBarRects([], 160, 48, 0)).toEqual([]);
    const values = [3, 5];
    sparkBarRects(values, 160, 48, 5);
    expect(values).toEqual([3, 5]);
  });
});
