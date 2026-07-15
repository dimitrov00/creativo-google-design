import { describe, expect, it } from 'vitest';
import { DomainError } from './domain-error';

class TestError extends DomainError {
  readonly code = 'test_error' as const;
}

describe('DomainError', () => {
  it('exposes message, code, and params', () => {
    const error = new TestError('Something went wrong: {value}', {
      value: 'x',
    });
    expect(error.message).toBe('Something went wrong: {value}');
    expect(error.code).toBe('test_error');
    expect(error.params).toEqual({ value: 'x' });
  });

  it('defaults params to an empty object', () => {
    const error = new TestError('no params');
    expect(error.params).toEqual({});
  });

  it('is a real Error instance (instanceof Error holds)', () => {
    const error = new TestError('boom');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DomainError);
  });
});
