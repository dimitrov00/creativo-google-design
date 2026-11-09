import { describe, expect, it } from 'vitest';
import { arcPath, ringArcs, ringPoint } from './ring-arcs';

// The literals below were computed apart from this code (degrees from
// north through the ordinary maths angle), not read off its output.
const CENTRE = { x: 100, y: 100 };

describe('ringPoint', () => {
  it('starts at 12 o’clock and runs clockwise', () => {
    const at = (angle: number) => {
      const point = ringPoint(angle, 50, CENTRE);
      return [Math.round(point.x * 100) / 100, Math.round(point.y * 100) / 100];
    };
    expect(at(0)).toEqual([100, 50]);
    expect(at(Math.PI / 2)).toEqual([150, 100]);
    expect(at(Math.PI)).toEqual([100, 150]);
    expect(at((3 * Math.PI) / 2)).toEqual([50, 100]);
  });
});

describe('arcPath', () => {
  it('draws one clockwise arc, the large-arc flag set only past half a turn', () => {
    expect(arcPath(0, Math.PI / 2, 50, CENTRE)).toBe(
      'M100 50 A50 50 0 0 1 150 100',
    );
    expect(arcPath(0, (3 * Math.PI) / 2, 50, CENTRE)).toBe(
      'M100 50 A50 50 0 1 1 50 100',
    );
  });

  it('draws a whole turn as two half arcs closed at the top', () => {
    expect(arcPath(0, 2 * Math.PI, 50, CENTRE)).toBe(
      'M100 50 A50 50 0 1 1 100 150 A50 50 0 1 1 100 50 Z',
    );
  });

  it('draws no span as a zero-length segment, for a round cap to make a dot', () => {
    expect(arcPath(Math.PI / 2, Math.PI / 2, 50, CENTRE)).toBe(
      'M150 100 L150 100',
    );
  });
});

describe('ringArcs', () => {
  it('splits the circle by share from 12 o’clock clockwise, the gap taken half from each side', () => {
    // 10 px of gap at radius 50 is 0.2 rad: 0.1 off each end of each share.
    expect(ringArcs([3, 1], 50, CENTRE, 10)).toEqual([
      { index: 0, d: 'M104.99 50.25 A50 50 0 1 1 50.25 104.99' },
      { index: 1, d: 'M50.25 95.01 A50 50 0 0 1 95.01 50.25' },
    ]);
  });

  it('meets end to end with no gap', () => {
    expect(ringArcs([1, 1], 50, CENTRE, 0)).toEqual([
      { index: 0, d: 'M100 50 A50 50 0 0 1 100 150' },
      { index: 1, d: 'M100 150 A50 50 0 0 1 100 50' },
    ]);
  });

  it('draws a share too short for its gap as a dot in its middle', () => {
    // 1 % is 3.6°, under the 11.46° the gap takes: a dot at 358.2°.
    expect(ringArcs([99, 1], 50, CENTRE, 10)).toEqual([
      { index: 0, d: 'M104.99 50.25 A50 50 0 1 1 91.89 50.66' },
      { index: 1, d: 'M98.43 50.02 L98.43 50.02' },
    ]);
  });

  it('draws one share as the whole circle with no gap, skipping the zeros around it', () => {
    expect(ringArcs([0, 5, 0], 50, CENTRE, 10)).toEqual([
      { index: 1, d: 'M100 50 A50 50 0 1 1 100 150 A50 50 0 1 1 100 50 Z' },
    ]);
  });

  it('clamps a negative value to zero, and draws nothing for a zero total or no values', () => {
    expect(ringArcs([-4, 1, 1], 50, CENTRE, 0)).toEqual([
      { index: 1, d: 'M100 50 A50 50 0 0 1 100 150' },
      { index: 2, d: 'M100 150 A50 50 0 0 1 100 50' },
    ]);
    expect(ringArcs([0, 0], 50, CENTRE, 10)).toEqual([]);
    expect(ringArcs([], 50, CENTRE, 10)).toEqual([]);
  });

  it('never mutates its input and answers the same for the same values', () => {
    const values = [3, 1];
    const first = ringArcs(values, 50, CENTRE, 10);
    expect(ringArcs(values, 50, CENTRE, 10)).toEqual(first);
    expect(values).toEqual([3, 1]);
  });
});
