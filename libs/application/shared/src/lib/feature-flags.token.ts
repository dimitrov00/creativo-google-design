import {
  EnvironmentProviders,
  InjectionToken,
  makeEnvironmentProviders,
} from '@angular/core';
import { FeatureFlags } from '@creativo/domain/governance';

/**
 * The deployment's build-time feature flags (R41): one map per environment
 * in `config/feature-flags.json`, compiled into the bundle, never read live.
 * Route guards, `@if` and stores read it so an unshipped surface is absent,
 * not merely hidden. The factory default is all-off, so tests and secondary
 * composition roots never see a feature they did not ask for; `apps/web`
 * still provides it explicitly from its environment.
 */
export const FEATURE_FLAGS = new InjectionToken<FeatureFlags>('FeatureFlags', {
  factory: () => FeatureFlags.defaults(),
});

/**
 * Provides a raw manifest map as `FEATURE_FLAGS`.
 *
 * Parsed here, while the app config is built, not on first injection: a
 * typo'd key or a `"true"` string must stop the app from booting (and fail
 * the smoke test), not quietly leave a feature off until someone looks.
 */
export function provideFeatureFlags(
  raw: Readonly<Record<string, unknown>>,
): EnvironmentProviders {
  const parsed = FeatureFlags.create(raw);
  if (parsed.isFailure()) {
    const reasons = parsed.error.map((e) => `${e.code}: ${e.message}`);
    throw new Error(`Invalid feature flag map — ${reasons.join('; ')}`);
  }
  return makeEnvironmentProviders([
    { provide: FEATURE_FLAGS, useValue: parsed.value },
  ]);
}
