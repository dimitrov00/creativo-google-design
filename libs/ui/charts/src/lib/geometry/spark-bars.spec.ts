import { describe, expect, it } from 'vitest';
import { sparkBarRects, type SparkBarRect } from './spark-bars';

// The literals below were computed apart from this code (a plain node
// script over the slot arithmetic), not read off its output.
const box = (rect: SparkBarRect): string =>
  [rect.x, rect.y, rect.width, rect.height, rect.rx, rect.ry].join(' ');

describe('sparkBarRects', () => {
  it('centres an 8 px capsule in each of n even slots, standing on the bottom, zero-anchored', () => {
    // 160 ÷ 7 = 22.86 a slot: 60 % of it is 13.71, capped at 8.
    expect(sparkBarRects([3, 5, 0, 8, 2, 8, 4], 160, 48, 8).map(box)).toEqual([
      '7.43 30 8 18 4 4',
      '30.29 18 8 30 4 4',
      // A zero: a 2 px stub, round at both ends (ry is half its height).
      '53.14 46 8 2 4 1',
      '76 0 8 48 4 4',
      '98.86 36 8 12 4 4',
      '121.71 0 8 48 4 4',
      '144.57 24 8 24 4 4',
    ]);
  });

  it('thins a crowded run so at least 3 px of air stays between bars', () => {
    // 20 ÷ 4 = 5 a slot: 60 % is 3, but 5 − 3 leaves only 2.
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
      '6 46 8 2 4 1',
      '26 0 8 48 4 4',
    ]);
    expect(sparkBarRects([0, 0], 100, 48, 0).map(box)).toEqual([
      '21 46 8 2 4 1',
      '71 46 8 2 4 1',
    ]);
  });

  it('draws nothing for no values, and never mutates its input', () => {
    expect(sparkBarRects([], 160, 48, 0)).toEqual([]);
    const values = [3, 5];
    sparkBarRects(values, 160, 48, 5);
    expect(values).toEqual([3, 5]);
  });
});
