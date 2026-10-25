import { afterEach, describe, expect, it } from 'vitest';
import { FeatureFlags, FlagName } from '@core/components';
import type { FlagsPorts } from '@core/ports';
import { FLAG_PARAMS } from '../lib/flags';
import { paramFlagsPorts } from './flags.adapter';

describe('paramFlagsPorts — the functions’ build-time flags', () => {
  afterEach(() => {
    delete process.env['LOYALTY_SELF_VIEW'];
  });

  // dead: the two-vocabulary pin (`FeatureFlagKey` ↔ `FlagName`) — Phase 4a
  // leaves ONE flag vocabulary, `FeatureFlags.NAMES`; re-pinned below as the params'
  // keys.
  it('keys one param per flag of the one vocabulary — `Object.keys(FLAG_PARAMS)` is `FeatureFlags.NAMES`', () => {
    expect(Object.keys(FLAG_PARAMS).sort()).toEqual(
      [...FeatureFlags.NAMES].sort(),
    );
  });

  it('is the FlagsPorts bundle, off while the param holds no value', () => {
    const ports: FlagsPorts = paramFlagsPorts();
    expect(ports.flagOn(FlagName.LoyaltySelfView)).toBe(false);
  });

  it('reads the deployed value at each call, never once at build', () => {
    const ports = paramFlagsPorts();
    expect(ports.flagOn(FlagName.LoyaltySelfView)).toBe(false);
    process.env['LOYALTY_SELF_VIEW'] = 'true';
    expect(ports.flagOn(FlagName.LoyaltySelfView)).toBe(true);
    expect(ports.flagOn(FlagName.ClientPause)).toBe(false);
  });
});
