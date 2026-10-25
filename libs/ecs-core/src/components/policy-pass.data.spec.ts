import { describe, expect, it } from 'vitest';
import { PreciseInstant } from './precise-instant.data';
import { PolicyPass } from './policy-pass.data';

const instant = (seconds: number, nanos: number): PreciseInstant => {
  const value = PreciseInstant.of(seconds, nanos);
  if (value === null) throw new Error('unexpected failure in test fixture');
  return value;
};

describe('PolicyPass', () => {
  it('PolicyPass.of pairs a generation with its change instant', () => {
    const changedAt = instant(1_760_090_400, 5);
    expect(PolicyPass.of('evt-1', changedAt)).toEqual({
      generation: 'evt-1',
      changedAt: { seconds: 1_760_090_400, nanos: 5 },
    });
  });
});
