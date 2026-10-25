import { describe, expect, it } from 'vitest';
import { PreciseInstant } from './precise-instant.data';
import { PolicyPass } from './policy-pass.data';
import { PolicyPassStamp } from './policy-pass-stamp.data';

const instant = (seconds: number, nanos: number): PreciseInstant => {
  const value = PreciseInstant.of(seconds, nanos);
  if (value === null) throw new Error('unexpected failure in test fixture');
  return value;
};

describe('PolicyPassStamp', () => {
  it('PolicyPassStamp flattens a pass to its root fields and reads it back, null together for none', () => {
    const pass = PolicyPass.of('evt-1', instant(1_760_090_400, 5));
    expect(PolicyPassStamp.of(pass)).toEqual({
      policyPassGeneration: 'evt-1',
      policyPassChangedAtSeconds: 1_760_090_400,
      policyPassChangedAtNanos: 5,
    });
    expect(PolicyPassStamp.read(PolicyPassStamp.of(pass))).toEqual(pass);
    expect(PolicyPassStamp.of(null)).toEqual(PolicyPassStamp.NONE);
    expect(PolicyPassStamp.NONE).toEqual({
      policyPassGeneration: null,
      policyPassChangedAtSeconds: null,
      policyPassChangedAtNanos: null,
    });
    expect(PolicyPassStamp.read(PolicyPassStamp.NONE)).toBeNull();
    // A stamp missing any field records no pass.
    expect(
      PolicyPassStamp.read({
        ...PolicyPassStamp.of(pass),
        policyPassChangedAtNanos: null,
      }),
    ).toBeNull();
  });
});
