import { afterEach, describe, expect, it } from 'vitest';
import { FeatureFlags, FlagName } from '@core/components';
import { FLAG_PARAMS, flagOn } from './flags';

// The §12.1 table, spelled out: the env writer (tools/flags) pins the same
// names, so a rename on either side fails a spec instead of a deploy.
const PARAM_NAMES = {
  'client.profile': 'CLIENT_PROFILE',
  'client.pause': 'CLIENT_PAUSE',
  'loyalty.points': 'LOYALTY_POINTS',
  'loyalty.streaks': 'LOYALTY_STREAKS',
  'loyalty.achievements': 'LOYALTY_ACHIEVEMENTS',
  'loyalty.tiers': 'LOYALTY_TIERS',
  'client.support': 'CLIENT_SUPPORT',
  'loyalty.selfView': 'LOYALTY_SELF_VIEW',
  'client.merge': 'CLIENT_MERGE',
  'support.bulk': 'SUPPORT_BULK',
  'client.privacy': 'CLIENT_PRIVACY',
  'referrals.invitations': 'REFERRALS_INVITATIONS',
  'discounts.grants': 'DISCOUNTS_GRANTS',
} as const;

describe('FLAG_PARAMS', () => {
  it('names one param per flag key, as §12.1 spells it', () => {
    expect(Object.keys(FLAG_PARAMS).sort()).toEqual(
      [...FeatureFlags.NAMES].sort(),
    );
    expect(
      Object.fromEntries(
        Object.entries(FLAG_PARAMS).map(([key, param]) => [key, param.name]),
      ),
    ).toEqual(PARAM_NAMES);
  });

  it('defaults every param to off', () => {
    for (const param of Object.values(FLAG_PARAMS)) {
      expect(param.options.default).toBe(false);
    }
  });
});

describe('flagOn', () => {
  afterEach(() => {
    delete process.env['CLIENT_PAUSE'];
  });

  it('is off when the env holds no value', () => {
    expect(flagOn(FlagName.ClientPause)).toBe(false);
  });

  it('reads the deployed value at call time', () => {
    process.env['CLIENT_PAUSE'] = 'true';
    expect(flagOn(FlagName.ClientPause)).toBe(true);
    expect(flagOn(FlagName.ClientProfile)).toBe(false);
  });

  it('treats anything but "true" as off', () => {
    process.env['CLIENT_PAUSE'] = 'TRUE';
    expect(flagOn(FlagName.ClientPause)).toBe(false);
  });
});
