import { describe, expect, it } from 'vitest';
import { SystemClock } from './system-clock.adapter';

describe('SystemClock', () => {
  it('resolves the current instant for a valid zone', () => {
    const result = new SystemClock().now('Europe/Sofia');
    expect(result.isSuccess()).toBe(true);
  });

  it('fails for an invalid zone', () => {
    const result = new SystemClock().now('Not/AZone');
    expect(result.isFailure()).toBe(true);
  });
});
