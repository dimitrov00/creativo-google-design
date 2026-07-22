import { describe, expect, it } from 'vitest';
import { Points } from './points';
import { InvalidPointsError } from './points.errors';

describe('Points.create', () => {
  it('accepts a non-negative integer', () => {
    const result = Points.create(100);
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.amount).toBe(100);
    }
  });

  it('accepts zero', () => {
    expect(Points.create(0).isSuccess()).toBe(true);
  });

  it('rejects a negative amount', () => {
    const result = Points.create(-1);
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(InvalidPointsError);
    }
  });

  it('rejects a non-integer amount', () => {
    expect(Points.create(1.5).isFailure()).toBe(true);
  });
});

describe('Points.zero', () => {
  it('constructs zero points', () => {
    expect(Points.zero().amount).toBe(0);
  });
});

describe('Points.add / subtract', () => {
  it('adds two point amounts', () => {
    const a = Points.create(10);
    const b = Points.create(5);
    if (a.isFailure() || b.isFailure()) throw new Error('bad fixture');
    expect(a.value.add(b.value).amount).toBe(15);
  });

  it('subtract clamps at zero — over-spend is unrepresentable', () => {
    const a = Points.create(5);
    const b = Points.create(10);
    if (a.isFailure() || b.isFailure()) throw new Error('bad fixture');
    expect(a.value.subtract(b.value).amount).toBe(0);
  });

  it('equals compares by amount', () => {
    const a = Points.create(10);
    const b = Points.fromPrimitive(10);
    if (a.isFailure()) throw new Error('bad fixture');
    expect(a.value.equals(b)).toBe(true);
  });
});
