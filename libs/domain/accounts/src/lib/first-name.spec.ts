import { describe, expect, it } from 'vitest';
import { FirstName } from './first-name';

describe('FirstName.create', () => {
  it('accepts a name at the minimum length', () => {
    const result = FirstName.create('Al');
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.value).toBe('Al');
    }
  });

  it('trims surrounding whitespace', () => {
    const result = FirstName.create('  Ivo  ');
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.value).toBe('Ivo');
    }
  });

  it('rejects a name shorter than the minimum', () => {
    expect(FirstName.create('A').isFailure()).toBe(true);
    expect(FirstName.create('').isFailure()).toBe(true);
    expect(FirstName.create('  ').isFailure()).toBe(true);
  });
});

describe('FirstName.fromPrimitive / equals', () => {
  it('wraps trusted input and compares by value', () => {
    const a = FirstName.fromPrimitive('Ivo');
    const b = FirstName.fromPrimitive('Ivo');
    expect(a.equals(b)).toBe(true);
    expect(a.toString()).toBe('Ivo');
  });
});
