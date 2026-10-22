import { afterEach, describe, expect, it } from 'vitest';
import { FLAG_NAMES, FlagName } from '@core/components';
import type { FlagsPorts } from '@core/ports';
import {
  FEATURE_FLAG_KEYS,
  type FeatureFlagKey,
} from '@creativo/domain/governance';
import { paramFlagsPorts } from './flags.adapter';

/** Compile-time: the manifest's two spellings are ONE vocabulary, both ways. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const oneVocabulary: Same<FlagName, FeatureFlagKey> = true;

describe('paramFlagsPorts — the functions’ build-time flags', () => {
  afterEach(() => {
    delete process.env['LOYALTY_SELF_VIEW'];
  });

  it('speaks the manifest’s one vocabulary: every FlagName is a FeatureFlagKey and back', () => {
    expect(oneVocabulary).toBe(true);
    expect([...FLAG_NAMES].sort()).toEqual([...FEATURE_FLAG_KEYS].sort());
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
