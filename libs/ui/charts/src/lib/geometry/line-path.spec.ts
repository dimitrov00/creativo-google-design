import { describe, expect, it } from 'vitest';
import { areaPath, linePath, monotonePath } from './line-path';

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

// The literals below come from a verbatim port of d3-shape's
// `curveMonotoneX` run apart from this code, not from `monotonePath` itself.
describe('monotonePath', () => {
  it('passes through every point with cubic pieces, flat at a turning point', () => {
    // 2.5 is the lowest y: the tangent there is zero, so the curve does not dip past it.
    expect(
      monotonePath([
        { x: 0, y: 10 },
        { x: 50, y: 2.5 },
        { x: 100, y: 7 },
      ]),
    ).toBe('M0 10 C16.67 6.25 33.33 2.5 50 2.5 C66.67 2.5 83.33 4.75 100 7');
  });

  it('never overshoots: a flat stretch between two equal points stays flat', () => {
    expect(
      monotonePath([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 10 },
        { x: 30, y: 0 },
      ]),
    ).toBe(
      'M0 0 C3.33 5 6.67 10 10 10 C13.33 10 16.67 10 20 10 C23.33 10 26.67 5 30 0',
    );
  });

  it('keeps every control point inside the band of its two neighbours', () => {
    const d = monotonePath([
      { x: 0, y: 100 },
      { x: 25, y: 0 },
      { x: 50, y: 100 },
      { x: 75, y: 90 },
      { x: 100, y: 0 },
    ]);
    expect(d).toBe(
      'M0 100 C8.33 50 16.67 0 25 0 C33.33 0 41.67 100 50 100 C58.33 100 66.67 96.67 75 90 C83.33 83.33 91.67 41.67 100 0',
    );
    const ys = [...d.matchAll(/-?\d+(?:\.\d+)?/g)]
      .map((match) => Number(match[0]))
      .filter((_, index) => index % 2 === 1);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(100);
  });

  it('draws two points straight, one as a lone move, and nothing for none', () => {
    expect(
      monotonePath([
        { x: 0, y: 1 },
        { x: 10, y: 2 },
      ]),
    ).toBe('M0 1 L10 2');
    expect(monotonePath([{ x: 3, y: 4 }])).toBe('M3 4');
    expect(monotonePath([])).toBe('');
    expect(monotonePath([null, null])).toBe('');
  });

  it('breaks at a null and smooths each run on its own', () => {
    expect(
      monotonePath([
        { x: 0, y: 10 },
        { x: 50, y: 2.5 },
        { x: 100, y: 7 },
        null,
        { x: 120, y: 1 },
        null,
        { x: 140, y: 1 },
        { x: 160, y: 3 },
      ]),
    ).toBe(
      'M0 10 C16.67 6.25 33.33 2.5 50 2.5 C66.67 2.5 83.33 4.75 100 7 M120 1 M140 1 L160 3',
    );
  });

  it('never mutates its input', () => {
    const points = [
      { x: 0, y: 10 },
      { x: 50, y: 2.5 },
      { x: 100, y: 7 },
    ];
    monotonePath(points);
    expect(points).toEqual([
      { x: 0, y: 10 },
      { x: 50, y: 2.5 },
      { x: 100, y: 7 },
    ]);
  });
});

describe('areaPath', () => {
  const points = [
    { x: 6, y: 64 },
    { x: 85.67, y: 6 },
    { x: 245, y: 93 },
  ];

  it('closes the line down to the baseline under its last point and back under its first', () => {
    expect(areaPath('M6 64 L85.67 6 L245 93', points, 122)).toBe(
      'M6 64 L85.67 6 L245 93 L245 122 L6 122 Z',
    );
  });

  it('is empty for an empty line or fewer than two points', () => {
    expect(areaPath('', points, 122)).toBe('');
    expect(areaPath('M6 64', [{ x: 6, y: 64 }], 122)).toBe('');
    expect(areaPath('', [], 122)).toBe('');
  });
});
