import { describe, expect, it } from 'vitest';
import { TierOverrideSource, TierOverrideSourceKind } from './tier-state.data';

describe('TierOverrideSource', () => {
  it('keeps the stored tags and builds each source', () => {
    expect(Object.values(TierOverrideSourceKind)).toEqual([
      'award',
      'adjustment',
    ]);
    expect(TierOverrideSource.award('rule-vip:u1:1')).toEqual({
      kind: 'award',
      awardKey: 'rule-vip:u1:1',
    });
    expect(TierOverrideSource.adjustment('adj-7')).toEqual({
      kind: 'adjustment',
      adjustmentId: 'adj-7',
    });
  });
});
