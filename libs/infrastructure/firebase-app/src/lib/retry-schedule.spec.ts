import { describe, expect, it } from 'vitest';
import { DATA_RETRY_DELAYS_MS, retryDelayMs } from './retry-schedule';

describe('retryDelayMs', () => {
  it('walks the data layer’s schedule, then holds at its ceiling', () => {
    expect(
      [0, 1, 2, 3, 4, 5, 50].map((attempt) => retryDelayMs(attempt)),
    ).toEqual([500, 1_000, 2_000, 5_000, 10_000, 10_000, 10_000]);
    expect(DATA_RETRY_DELAYS_MS.at(-1)).toBe(10_000);
  });

  it('reads a schedule of its caller’s, and never waits a negative time', () => {
    expect(retryDelayMs(0, [7, 9])).toBe(7);
    expect(retryDelayMs(3, [7, 9])).toBe(9);
    expect(retryDelayMs(-1, [7, 9])).toBe(7);
    expect(retryDelayMs(0, [])).toBe(0);
  });
});
