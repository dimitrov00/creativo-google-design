import { describe, expect, it } from 'vitest';
import { stackOffsets, stackTotal } from './stack-offsets';

describe('stackOffsets', () => {
  it('runs each part from the sum before it', () => {
    expect(stackOffsets([30, 10, 20])).toEqual([
      { start: 0, end: 30 },
      { start: 30, end: 40 },
      { start: 40, end: 60 },
    ]);
  });

  it('gives an empty part no length and keeps its place in the stack', () => {
    expect(stackOffsets([5, 0, 5])).toEqual([
      { start: 0, end: 5 },
      { start: 5, end: 5 },
      { start: 5, end: 10 },
    ]);
  });

  it('counts a negative part as nothing', () => {
    expect(stackOffsets([4, -3, 2])).toEqual([
      { start: 0, end: 4 },
      { start: 4, end: 4 },
      { start: 4, end: 6 },
    ]);
  });

  it('is empty for no parts and leaves its input untouched', () => {
    expect(stackOffsets([])).toEqual([]);
    const values = [1, 2];
    stackOffsets(values);
    expect(values).toEqual([1, 2]);
  });
});

describe('stackTotal', () => {
  it('is the last offset’s end', () => {
    expect(stackTotal([30, 10, 20])).toBe(60);
    expect(stackTotal([4, -3, 2])).toBe(6);
    expect(stackTotal([])).toBe(0);
  });
});
