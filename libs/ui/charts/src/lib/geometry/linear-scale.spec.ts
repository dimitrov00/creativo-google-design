import { describe, expect, it } from 'vitest';
import { linearScale, px, zeroExtent } from './linear-scale';

describe('linearScale', () => {
  it('maps the domain’s ends onto the range’s ends and interpolates between', () => {
    const scale = linearScale([0, 10], [0, 100]);
    expect(scale(0)).toBe(0);
    expect(scale(10)).toBe(100);
    expect(scale(2.5)).toBe(25);
  });

  it('runs a range backwards (a y axis grows downwards)', () => {
    const y = linearScale([0, 100], [120, 0]);
    expect(y(0)).toBe(120);
    expect(y(100)).toBe(0);
    expect(y(25)).toBe(90);
  });

  it('extrapolates outside the domain; the caller clamps', () => {
    const scale = linearScale([0, 10], [0, 100]);
    expect(scale(12)).toBe(120);
    expect(scale(-1)).toBe(-10);
  });

  it('maps every value to the range’s start on a flat domain', () => {
    const scale = linearScale([5, 5], [20, 80]);
    expect(scale(5)).toBe(20);
    expect(scale(9)).toBe(20);
  });

  it('is pure: the same inputs give the same output and nothing is mutated', () => {
    const domain: readonly [number, number] = [0, 4];
    const range: readonly [number, number] = [0, 8];
    const a = linearScale(domain, range);
    const b = linearScale(domain, range);
    expect(a(3)).toBe(b(3));
    expect(domain).toEqual([0, 4]);
    expect(range).toEqual([0, 8]);
  });
});

describe('zeroExtent', () => {
  it('is [0, max], skipping nulls', () => {
    expect(zeroExtent([3, null, 7, 2])).toEqual([0, 7]);
  });

  it('is [0, 0] for nothing, for nulls only, and for negatives only', () => {
    expect(zeroExtent([])).toEqual([0, 0]);
    expect(zeroExtent([null, null])).toEqual([0, 0]);
    expect(zeroExtent([-3, -1])).toEqual([0, 0]);
  });
});

describe('px', () => {
  it('rounds to a hundredth', () => {
    expect(px(1.23456)).toBe(1.23);
    expect(px(1.235)).toBe(1.24);
    expect(px(-0.004)).toBe(-0);
  });
});
