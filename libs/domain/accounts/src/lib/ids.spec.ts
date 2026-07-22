import { describe, expect, it } from 'vitest';
import { UserId } from './ids';

describe('UserId', () => {
  it('create() accepts a non-empty string', () => {
    const result = UserId.create('abc123');
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.value).toBe('abc123');
    }
  });

  it('create() rejects an empty/whitespace-only string', () => {
    expect(UserId.create('').isFailure()).toBe(true);
    expect(UserId.create('   ').isFailure()).toBe(true);
  });

  it('generate() produces a non-empty, unique value each time', () => {
    const a = UserId.generate();
    const b = UserId.generate();
    expect(a.value.length).toBeGreaterThan(0);
    expect(a.equals(b)).toBe(false);
  });

  it('equals() compares by value', () => {
    const a = UserId.create('same');
    const b = UserId.create('same');
    if (a.isFailure() || b.isFailure()) {
      throw new Error('unexpected failure in test fixture');
    }
    expect(a.value.equals(b.value)).toBe(true);
  });
});
