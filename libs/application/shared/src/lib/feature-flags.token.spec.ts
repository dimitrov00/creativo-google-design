import { describe, expect, it } from 'vitest';
import {
  EnvironmentInjector,
  Injector,
  createEnvironmentInjector,
} from '@angular/core';
import { FeatureFlags } from '@creativo/domain/governance';
import { FEATURE_FLAGS, provideFeatureFlags } from './feature-flags.token';

function flagsFrom(raw: Readonly<Record<string, unknown>>): FeatureFlags {
  const injector = createEnvironmentInjector(
    [provideFeatureFlags(raw)],
    Injector.NULL as EnvironmentInjector,
  );
  return injector.get(FEATURE_FLAGS);
}

describe('provideFeatureFlags', () => {
  it('provides the parsed map', () => {
    const flags = flagsFrom({ 'client.profile': true, 'client.pause': false });
    expect(flags.isEnabled('client.profile')).toBe(true);
    expect(flags.isEnabled('client.pause')).toBe(false);
    expect(flags.isEnabled('loyalty.points')).toBe(false);
  });

  it('throws on a typo, naming the key, before anything injects it', () => {
    expect(() => provideFeatureFlags({ 'client.profil': true })).toThrow(
      /governance\.feature_flags\.unknown_key.*client\.profil/,
    );
  });

  it('throws on a retired key', () => {
    expect(() => provideFeatureFlags({ 'rewards.points': false })).toThrow(
      /unknown_key/,
    );
  });

  it('throws on a non-boolean value', () => {
    expect(() => provideFeatureFlags({ 'client.profile': 'true' })).toThrow(
      /governance\.feature_flags\.invalid_value/,
    );
  });

  it('reports every bad entry at once', () => {
    expect(() =>
      provideFeatureFlags({ 'client.profil': true, 'client.pause': 1 }),
    ).toThrow(/unknown_key.*; .*invalid_value/);
  });
});
