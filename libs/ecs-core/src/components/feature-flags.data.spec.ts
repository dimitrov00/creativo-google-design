import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GovernanceErrorCode } from './governance-errors.data';
import { FLAG_NAMES, FeatureFlags, FlagName } from './feature-flags.data';

/*
 * The cases of libs/domain/governance/src/lib/feature-flags.spec.ts, copied
 * over the plain map, plus the manifest parity: every environment of
 * `config/feature-flags.json` names exactly the `FlagName` dictionary.
 */

/** The nearest ancestor holding `nx.json`, however deep this spec moves. */
function workspaceRoot(from: string): string {
  let dir = from;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- walks up from this spec's own directory, never external input.
  while (!existsSync(join(dir, 'nx.json'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`no nx.json above ${from}`);
    dir = parent;
  }
  return dir;
}

describe('FlagName', () => {
  it('is the R41 vocabulary plus the two earlier keys, each once', () => {
    expect([...FLAG_NAMES].sort()).toEqual(
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
    expect(new Set(FLAG_NAMES).size).toBe(FLAG_NAMES.length);
  });

  it('no longer knows the retired rewards.* keys', () => {
    expect(FeatureFlags.isFlagName('rewards.points')).toBe(false);
    expect(FeatureFlags.isFlagName('rewards.achievements')).toBe(false);
    expect(FeatureFlags.isFlagName('loyalty.points')).toBe(true);
  });

  it('every environment of the manifest names exactly these flags', () => {
    const manifest = JSON.parse(
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- the workspace's own manifest, located from this spec.
      readFileSync(
        join(workspaceRoot(__dirname), 'config', 'feature-flags.json'),
        'utf8',
      ),
    ) as Record<string, Record<string, unknown>>;
    const environments = Object.entries(manifest);
    expect(environments.length).toBeGreaterThan(0);
    for (const [environment, flags] of environments) {
      expect(Object.keys(flags).sort(), environment).toEqual(
        [...FLAG_NAMES].sort(),
      );
      expect(FeatureFlags.parse(flags).ok, environment).toBe(true);
    }
  });
});

describe('FeatureFlags.defaults', () => {
  it('is all-disabled, every key present', () => {
    const flags = FeatureFlags.defaults();
    expect(Object.keys(flags).sort()).toEqual([...FLAG_NAMES].sort());
    for (const key of FLAG_NAMES) {
      expect(FeatureFlags.flagOn(flags, key)).toBe(false);
    }
  });
});

describe('FeatureFlags.parse', () => {
  it('accepts a partial, valid map and defaults the rest to false', () => {
    const result = FeatureFlags.parse({ 'loyalty.points': true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(FeatureFlags.flagOn(result.value, FlagName.LoyaltyPoints)).toBe(
        true,
      );
      expect(
        FeatureFlags.flagOn(result.value, FlagName.LoyaltyAchievements),
      ).toBe(false);
    }
  });

  it('accepts a complete map, one entry per key', () => {
    const complete = Object.fromEntries(
      FLAG_NAMES.map((key) => [key, key === FlagName.ClientProfile]),
    );
    const result = FeatureFlags.parse(complete);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(FeatureFlags.flagOn(result.value, FlagName.ClientProfile)).toBe(
        true,
      );
      expect(FeatureFlags.flagOn(result.value, FlagName.ClientPrivacy)).toBe(
        false,
      );
    }
  });

  it('rejects an unknown flag key', () => {
    expect(FeatureFlags.parse({ 'not.a.real.flag': true })).toEqual({
      ok: false,
      error: [
        {
          errorCode: GovernanceErrorCode.FeatureFlagsUnknownKey,
          attempted: 'not.a.real.flag',
        },
      ],
    });
  });

  it('rejects a retired key as unknown, so an old manifest fails loudly', () => {
    const result = FeatureFlags.parse({ 'rewards.points': false });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error[0]?.errorCode).toBe(
        'GOVERNANCE_FEATURE_FLAGS_UNKNOWN_KEY',
      );
    }
  });

  it('rejects a non-boolean value', () => {
    expect(FeatureFlags.parse({ 'loyalty.points': 'yes' })).toEqual({
      ok: false,
      error: [
        {
          errorCode: GovernanceErrorCode.FeatureFlagsInvalidValue,
          key: 'loyalty.points',
        },
      ],
    });
  });

  it('collects every invalid key at once', () => {
    const result = FeatureFlags.parse({
      'not.a.real.flag': true,
      'loyalty.points': 'yes',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toHaveLength(2);
  });
});

describe('FeatureFlags.withFlag', () => {
  it('returns a new map and never touches the original', () => {
    const original = FeatureFlags.defaults();
    const next = FeatureFlags.withFlag(
      original,
      FlagName.ReferralsInvitations,
      true,
    );
    expect(FeatureFlags.flagOn(original, FlagName.ReferralsInvitations)).toBe(
      false,
    );
    expect(FeatureFlags.flagOn(next, FlagName.ReferralsInvitations)).toBe(true);
    expect(next).not.toBe(original);
  });

  it('carries every key and round-trips through parse', () => {
    const flags = FeatureFlags.withFlag(
      FeatureFlags.defaults(),
      FlagName.LoyaltyPoints,
      true,
    );
    expect(Object.keys(flags).sort()).toEqual([...FLAG_NAMES].sort());
    expect(FeatureFlags.parse(flags)).toEqual({ ok: true, value: flags });
  });
});
