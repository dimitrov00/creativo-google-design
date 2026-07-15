import { describe, expect, it } from 'vitest';
import { SystemClock } from './system-clock';

describe('SystemClock', () => {
  it('succeeds for a valid IANA zone', () => {
    const result = new SystemClock().now('Europe/Sofia');
    expect(result.isSuccess()).toBe(true);
  });

  it('fails for an invalid zone', () => {
    const result = new SystemClock().now('Not/AZone');
    expect(result.isFailure()).toBe(true);
  });
});
