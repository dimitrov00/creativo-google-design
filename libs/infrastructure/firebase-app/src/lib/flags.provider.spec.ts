import { describe, expect, it } from 'vitest';
import {
  type EnvironmentInjector,
  Injector,
  createEnvironmentInjector,
} from '@angular/core';
import { FLAG_NAMES, FlagName } from '@core/components';
import { TestBed } from '@angular/core/testing';
import type { FlagsPorts } from '@core/ports';
import { provideFlags } from './flags.provider';
import { FLAGS_PORTS } from './ports.tokens';

/*
 * The cases of `feature-flags.token.spec.ts` (`libs/application/shared`,
 * deleted in 4b), on `FLAGS_PORTS`: the parsed manifest, and a boot that
 * refuses a bad one — every bad entry named at once.
 */
function flagsFrom(raw: Readonly<Record<string, unknown>>): FlagsPorts {
  const injector = createEnvironmentInjector(
    [provideFlags(raw)],
    Injector.NULL as EnvironmentInjector,
  );
  return injector.get(FLAGS_PORTS);
}

describe('provideFlags', () => {
  it('provides the parsed map — an absent key is off', () => {
    const flags = flagsFrom({
      [FlagName.ClientProfile]: true,
      [FlagName.ClientPause]: false,
    });
    expect(flags.flagOn(FlagName.ClientProfile)).toBe(true);
    expect(flags.flagOn(FlagName.ClientPause)).toBe(false);
    expect(flags.flagOn(FlagName.LoyaltyPoints)).toBe(false);
  });

  it('throws on a typo, naming the key, before anything injects it', () => {
    expect(() => provideFlags({ 'client.profil': true })).toThrow(
      /GOVERNANCE_FEATURE_FLAGS_UNKNOWN_KEY.*client\.profil/,
    );
  });

  it('throws on a retired key', () => {
    expect(() => provideFlags({ 'rewards.points': false })).toThrow(
      /UNKNOWN_KEY/,
    );
  });

  it('throws on a non-boolean value', () => {
    expect(() => provideFlags({ [FlagName.ClientProfile]: 'true' })).toThrow(
      /GOVERNANCE_FEATURE_FLAGS_INVALID_VALUE/,
    );
  });

  it('reports every bad entry at once', () => {
    expect(() =>
      provideFlags({ 'client.profil': true, [FlagName.ClientPause]: 1 }),
    ).toThrow(/UNKNOWN_KEY.*; .*INVALID_VALUE/);
  });

  it('defaults every flag OFF where no root binds the manifest', () => {
    TestBed.resetTestingModule();
    const flags = TestBed.inject(FLAGS_PORTS);
    for (const flag of FLAG_NAMES) expect(flags.flagOn(flag)).toBe(false);
  });
});
