import { describe, expect, it } from 'vitest';
import { LastName } from './last-name';

describe('LastName.create', () => {
  it('accepts a name at the minimum length', () => {
    const result = LastName.create('Ng');
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.value).toBe('Ng');
    }
  });

  it('trims surrounding whitespace', () => {
    const result = LastName.create('  Petrov  ');
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.value).toBe('Petrov');
    }
  });

  it('rejects a name shorter than the minimum', () => {
    expect(LastName.create('P').isFailure()).toBe(true);
    expect(LastName.create('').isFailure()).toBe(true);
    expect(LastName.create('  ').isFailure()).toBe(true);
  });
});

describe('LastName.fromPrimitive / equals', () => {
  it('wraps trusted input and compares by value', () => {
    const a = LastName.fromPrimitive('Petrov');
    const b = LastName.fromPrimitive('Petrov');
    expect(a.equals(b)).toBe(true);
    expect(a.toString()).toBe('Petrov');
  });
});
