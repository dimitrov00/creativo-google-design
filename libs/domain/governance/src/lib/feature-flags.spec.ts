import { describe, expect, it } from 'vitest';
import {
  FEATURE_FLAG_KEYS,
  FeatureFlags,
  isFeatureFlagKey,
} from './feature-flags';

describe('FEATURE_FLAG_KEYS', () => {
  it('is the R41 vocabulary plus the two earlier keys, each once', () => {
    expect([...FEATURE_FLAG_KEYS].sort()).toEqual(
      [
        'client.profile',
        'client.pause',
        'loyalty.points',
        'loyalty.streaks',
        'loyalty.achievements',
        'loyalty.tiers',
        'client.support',
        'loyalty.selfView',
        'client.merge',
        'support.bulk',
        'client.privacy',
        'referrals.invitations',
        'discounts.grants',
      ].sort(),
    );
    expect(new Set(FEATURE_FLAG_KEYS).size).toBe(FEATURE_FLAG_KEYS.length);
  });

  it('no longer knows the retired rewards.* keys', () => {
    expect(isFeatureFlagKey('rewards.points')).toBe(false);
    expect(isFeatureFlagKey('rewards.achievements')).toBe(false);
    expect(isFeatureFlagKey('loyalty.points')).toBe(true);
  });
});

describe('FeatureFlags.defaults', () => {
  it('is all-disabled', () => {
    const flags = FeatureFlags.defaults();
    for (const key of FEATURE_FLAG_KEYS) {
      expect(flags.isEnabled(key)).toBe(false);
    }
  });
});

describe('FeatureFlags.create', () => {
  it('accepts a partial, valid record and defaults the rest to false', () => {
    const result = FeatureFlags.create({ 'loyalty.points': true });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.isEnabled('loyalty.points')).toBe(true);
      expect(result.value.isEnabled('loyalty.achievements')).toBe(false);
    }
  });

  it('accepts a complete map, one entry per key', () => {
    const complete = Object.fromEntries(
      FEATURE_FLAG_KEYS.map((key) => [key, key === 'client.profile']),
    );
    const result = FeatureFlags.create(complete);
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.isEnabled('client.profile')).toBe(true);
      expect(result.value.isEnabled('client.privacy')).toBe(false);
    }
  });

  it('rejects an unknown flag key', () => {
    const result = FeatureFlags.create({ 'not.a.real.flag': true });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error[0]?.code).toBe(
        'governance.feature_flags.unknown_key',
      );
    }
  });

  it('rejects a retired key as unknown, so an old manifest fails loudly', () => {
    const result = FeatureFlags.create({ 'rewards.points': false });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error[0]?.code).toBe(
        'governance.feature_flags.unknown_key',
      );
    }
  });

  it('rejects a non-boolean value', () => {
    const result = FeatureFlags.create({ 'loyalty.points': 'yes' });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error[0]?.code).toBe(
        'governance.feature_flags.invalid_value',
      );
    }
  });

  it('collects every invalid key at once', () => {
    const result = FeatureFlags.create({
      'not.a.real.flag': true,
      'loyalty.points': 'yes',
    });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toHaveLength(2);
    }
  });
});

describe('FeatureFlags.reconstitute', () => {
  it('validates identically to create', () => {
    const result = FeatureFlags.reconstitute({ 'discounts.grants': true });
    expect(result.isSuccess()).toBe(true);
  });
});

describe('FeatureFlags.withFlag / toRecord', () => {
  it('returns a new instance and never mutates the original', () => {
    const original = FeatureFlags.defaults();
    const next = original.withFlag('referrals.invitations', true);

    expect(original.isEnabled('referrals.invitations')).toBe(false);
    expect(next.isEnabled('referrals.invitations')).toBe(true);
    expect(next).not.toBe(original);
  });

  it('toRecord carries every key and round-trips through create', () => {
    const flags = FeatureFlags.defaults().withFlag('loyalty.points', true);
    expect(Object.keys(flags.toRecord()).sort()).toEqual(
      [...FEATURE_FLAG_KEYS].sort(),
    );
    const rebuilt = FeatureFlags.create(flags.toRecord());
    expect(rebuilt.isSuccess()).toBe(true);
    if (rebuilt.isSuccess()) {
      expect(rebuilt.value.isEnabled('loyalty.points')).toBe(true);
    }
  });
});
