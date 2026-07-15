import { describe, expect, it } from 'vitest';
import {
  Failure,
  Success,
  combine,
  combineAll,
  fail,
  match,
  ok,
} from './result';

describe('ok / fail', () => {
  it('ok() produces a Success with isSuccess()/isFailure() type guards', () => {
    const result = ok<number, string>(42);
    expect(result.isSuccess()).toBe(true);
    expect(result.isFailure()).toBe(false);
    expect(result).toBeInstanceOf(Success);
    if (result.isSuccess()) {
      expect(result.value).toBe(42);
    }
  });

  it('fail() produces a Failure with isSuccess()/isFailure() type guards', () => {
    const result = fail<number, string>('bad input');
    expect(result.isSuccess()).toBe(false);
    expect(result.isFailure()).toBe(true);
    expect(result).toBeInstanceOf(Failure);
    if (result.isFailure()) {
      expect(result.error).toBe('bad input');
    }
  });
});

describe('combine', () => {
  it('returns ok with all values when every result succeeds', () => {
    const result = combine([
      ok<number, string>(1),
      ok<number, string>(2),
      ok<number, string>(3),
    ]);
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value).toEqual([1, 2, 3]);
    }
  });

  it('collects every failure, not just the first', () => {
    const result = combine([
      ok<number, string>(1),
      fail<number, string>('bad field a'),
      fail<number, string>('bad field b'),
    ]);
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toEqual(['bad field a', 'bad field b']);
    }
  });

  it('returns ok with an empty array for an empty input', () => {
    const result = combine<number, string>([]);
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value).toEqual([]);
    }
  });
});

describe('combineAll', () => {
  it('combines heterogeneous Results into a typed tuple on success', () => {
    const result = combineAll([
      ok<number, string>(1),
      ok<string, string>('two'),
      ok<boolean, string>(true),
    ] as const);
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      const [a, b, c] = result.value;
      expect(a).toBe(1);
      expect(b).toBe('two');
      expect(c).toBe(true);
    }
  });

  it('collects every failure across heterogeneous Results, not just the first', () => {
    const result = combineAll([
      ok<number, string>(1),
      fail<string, string>('bad string field'),
      fail<boolean, string>('bad bool field'),
    ] as const);
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toEqual(['bad string field', 'bad bool field']);
    }
  });
});

describe('match', () => {
  it('calls the success handler for a Success', () => {
    const output = match(ok<number, string>(5), {
      success: (value) => `got ${value}`,
      failure: () => 'never',
    });
    expect(output).toBe('got 5');
  });

  it('calls the failure handler for a Failure', () => {
    const output = match(fail<number, string>('bad'), {
      success: () => 'never',
      failure: (error) => `error: ${error}`,
    });
    expect(output).toBe('error: bad');
  });
});
