import { describe, expect, it } from 'vitest';
import { sparkLinePoints } from './spark-line';

describe('sparkLinePoints', () => {
  it('spreads the slots across the width, zero at the bottom and the top at the top, inside the inset', () => {
    expect(sparkLinePoints([0, 50, 100], 5, 104, 54, 100, 2)).toEqual([
      { x: 2, y: 52 },
      { x: 27, y: 27 },
      { x: 52, y: 2 },
    ]);
  });

  it('centres a single slot, lays a flat run on the bottom, and counts a negative as zero', () => {
    expect(sparkLinePoints([5], 1, 100, 50, 10, 0)).toEqual([{ x: 50, y: 25 }]);
    expect(sparkLinePoints([0, 0], 2, 100, 50, 0, 0)).toEqual([
      { x: 0, y: 50 },
      { x: 100, y: 50 },
    ]);
    expect(sparkLinePoints([-3], 2, 100, 50, 10, 0)).toEqual([{ x: 0, y: 50 }]);
  });

  it('is pure: same input → same output', () => {
    const values = Object.freeze([1, 2, 3]);
    expect(sparkLinePoints(values, 4, 80, 40, 3, 1)).toEqual(
      sparkLinePoints(values, 4, 80, 40, 3, 1),
    );
  });
});
