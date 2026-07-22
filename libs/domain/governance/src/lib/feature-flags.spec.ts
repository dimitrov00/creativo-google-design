import { describe, expect, it } from 'vitest';
import { FeatureFlags } from './feature-flags';

describe('FeatureFlags.defaults', () => {
  it('is all-disabled', () => {
    const flags = FeatureFlags.defaults();
    expect(flags.isEnabled('referrals.invitations')).toBe(false);
    expect(flags.isEnabled('rewards.points')).toBe(false);
    expect(flags.isEnabled('rewards.achievements')).toBe(false);
    expect(flags.isEnabled('discounts.grants')).toBe(false);
  });
});

describe('FeatureFlags.create', () => {
  it('accepts a partial, valid record and defaults the rest to false', () => {
    const result = FeatureFlags.create({ 'rewards.points': true });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.isEnabled('rewards.points')).toBe(true);
      expect(result.value.isEnabled('rewards.achievements')).toBe(false);
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

  it('rejects a non-boolean value', () => {
    const result = FeatureFlags.create({ 'rewards.points': 'yes' });
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
      'rewards.points': 'yes',
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

  it('toRecord round-trips through create', () => {
    const flags = FeatureFlags.defaults().withFlag('rewards.points', true);
    const rebuilt = FeatureFlags.create(flags.toRecord());
    expect(rebuilt.isSuccess()).toBe(true);
    if (rebuilt.isSuccess()) {
      expect(rebuilt.value.isEnabled('rewards.points')).toBe(true);
    }
  });
});
