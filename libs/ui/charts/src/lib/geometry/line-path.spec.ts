import { describe, expect, it } from 'vitest';
import { linePath } from './line-path';

describe('linePath', () => {
  it('moves to the first point and draws straight segments to the rest', () => {
    expect(
      linePath([
        { x: 0, y: 10 },
        { x: 50, y: 2.5 },
        { x: 100, y: 7 },
      ]),
    ).toBe('M0 10 L50 2.5 L100 7');
  });

  it('is empty for no points and a lone move for one', () => {
    expect(linePath([])).toBe('');
    expect(linePath([{ x: 3, y: 4 }])).toBe('M3 4');
  });

  it('breaks the line at a null and starts a new sub-path after it', () => {
    expect(
      linePath([
        { x: 0, y: 1 },
        { x: 10, y: 2 },
        null,
        { x: 20, y: 3 },
        { x: 30, y: 4 },
      ]),
    ).toBe('M0 1 L10 2 M20 3 L30 4');
  });

  it('draws nothing for nulls alone and ignores leading nulls', () => {
    expect(linePath([null, null])).toBe('');
    expect(linePath([null, { x: 1, y: 1 }])).toBe('M1 1');
  });

  it('rounds coordinates to a hundredth and never mutates its input', () => {
    const points = [
      { x: 1.2345, y: 9.8765 },
      { x: 2, y: 3 },
    ] as const;
    expect(linePath(points)).toBe('M1.23 9.88 L2 3');
    expect(points).toEqual([
      { x: 1.2345, y: 9.8765 },
      { x: 2, y: 3 },
    ]);
  });
});
