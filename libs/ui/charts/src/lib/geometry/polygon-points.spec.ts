import { describe, expect, it } from 'vitest';
import {
  axisAnchor,
  axisLines,
  polygonPoints,
  radarVertex,
  ringPoints,
} from './polygon-points';

const CENTRE = { x: 160, y: 160 } as const;

describe('radarVertex', () => {
  it('puts the first axis straight up and walks clockwise at equal angles', () => {
    const round = (p: { x: number; y: number }) => ({
      x: Math.round(p.x * 100) / 100,
      y: Math.round(p.y * 100) / 100,
    });
    expect(round(radarVertex(0, 4, 100, CENTRE))).toEqual({ x: 160, y: 60 });
    expect(round(radarVertex(1, 4, 100, CENTRE))).toEqual({ x: 260, y: 160 });
    expect(round(radarVertex(2, 4, 100, CENTRE))).toEqual({ x: 160, y: 260 });
    expect(round(radarVertex(3, 4, 100, CENTRE))).toEqual({ x: 60, y: 160 });
  });

  it('scales with the radius and sits on the centre at none, or without axes', () => {
    const half = radarVertex(0, 5, 50, CENTRE);
    expect(half.x).toBeCloseTo(160, 10);
    expect(half.y).toBeCloseTo(110, 10);
    expect(radarVertex(0, 5, 0, CENTRE)).toEqual(CENTRE);
    expect(radarVertex(0, 0, 100, CENTRE)).toBe(CENTRE);
  });
});

describe('polygonPoints', () => {
  it('places each value a share of the radius along its axis, a null on the centre', () => {
    expect(polygonPoints([100, 50, null, 0], 100, CENTRE)).toBe(
      '160,60 210,160 160,160 160,160',
    );
  });

  it('clamps a value to 0 … 100 and never draws past the outer ring', () => {
    expect(polygonPoints([150, -20], 100, CENTRE)).toBe('160,60 160,160');
  });

  it('is empty for no values and rounds to a hundredth', () => {
    expect(polygonPoints([], 100, CENTRE)).toBe('');
    expect(polygonPoints([100, 100, 100], 100, CENTRE)).toBe(
      '160,60 246.6,210 73.4,210',
    );
  });

  it('never mutates its input', () => {
    const values = [40, null, 80];
    polygonPoints(values, 100, CENTRE);
    expect(values).toEqual([40, null, 80]);
  });
});

describe('ringPoints and axisLines', () => {
  it('draws the guide ring as the full polygon at the given radius', () => {
    expect(ringPoints(4, 50, CENTRE)).toBe('160,110 210,160 160,210 110,160');
    expect(ringPoints(0, 50, CENTRE)).toBe('');
  });

  it('runs each axis from the centre to its outer end', () => {
    expect(axisLines(4, 100, CENTRE)).toEqual([
      { x1: 160, y1: 160, x2: 160, y2: 60 },
      { x1: 160, y1: 160, x2: 260, y2: 160 },
      { x1: 160, y1: 160, x2: 160, y2: 260 },
      { x1: 160, y1: 160, x2: 60, y2: 160 },
    ]);
    expect(axisLines(0, 100, CENTRE)).toEqual([]);
  });
});

describe('axisAnchor', () => {
  it('anchors the four compass axes outward', () => {
    expect(axisAnchor(0, 4)).toEqual({
      textAnchor: 'middle',
      vertical: 'above',
    });
    expect(axisAnchor(1, 4)).toEqual({
      textAnchor: 'start',
      vertical: 'middle',
    });
    expect(axisAnchor(2, 4)).toEqual({
      textAnchor: 'middle',
      vertical: 'below',
    });
    expect(axisAnchor(3, 4)).toEqual({ textAnchor: 'end', vertical: 'middle' });
  });

  it('puts the five axes of the design to the right, below and to the left of the centre', () => {
    expect([0, 1, 2, 3, 4].map((i) => axisAnchor(i, 5))).toEqual([
      { textAnchor: 'middle', vertical: 'above' },
      { textAnchor: 'start', vertical: 'above' },
      { textAnchor: 'start', vertical: 'below' },
      { textAnchor: 'end', vertical: 'below' },
      { textAnchor: 'end', vertical: 'above' },
    ]);
    expect(axisAnchor(0, 0)).toEqual({
      textAnchor: 'middle',
      vertical: 'middle',
    });
  });
});
