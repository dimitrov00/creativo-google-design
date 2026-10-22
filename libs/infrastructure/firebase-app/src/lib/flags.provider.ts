import {
  type EnvironmentProviders,
  makeEnvironmentProviders,
} from '@angular/core';
import { FeatureFlags } from '@core/components';
import type { FlagsPorts } from '@core/ports';
import { FLAGS_PORTS } from './ports.tokens';

/**
 * Binds `FLAGS_PORTS` from the environment's raw manifest
 * (`config/feature-flags.json`, Phase 4a 4A-7; successor of
 * `provideFeatureFlags`). Parsed with `FeatureFlags.parse` — an unknown key
 * or a non-boolean value THROWS at boot: the app refuses to start on a bad
 * manifest rather than run with a flag it misread (today's contract; an
 * unrecoverable configuration defect, never a value).
 */
export function provideFlags(
  raw: Readonly<Record<string, unknown>>,
): EnvironmentProviders {
  const parsed = FeatureFlags.parse(raw);
  if (!parsed.ok) {
    const reasons = parsed.error.map((error) =>
      'attempted' in error
        ? `${error.errorCode}: ${error.attempted}`
        : 'key' in error
          ? `${error.errorCode}: ${error.key}`
          : error.errorCode,
    );
    throw new Error(`Invalid feature flag map — ${reasons.join('; ')}`);
  }
  const flags = parsed.value;
  const ports: FlagsPorts = {
    flagOn: (key) => FeatureFlags.flagOn(flags, key),
  };
  return makeEnvironmentProviders([{ provide: FLAGS_PORTS, useValue: ports }]);
}
