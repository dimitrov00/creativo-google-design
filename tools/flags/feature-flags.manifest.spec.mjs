/**
 * Parity between the one manifest and its two consumers (§12.1): the web
 * parses a map with ecs-core's `FeatureFlags` (`@core/components`, Phase 4a
 * re-point — the legacy domain-governance vocabulary is gone
 * from here), the functions read params named by `paramNameOf`. A key the
 * vocabulary does not know, a map missing a key, or a renamed param fails
 * here, not at bootstrap or in a deploy.
 */
import { readFileSync } from 'node:fs';
import { FLAG_NAMES, FeatureFlags } from '@core/components';
import {
  ENVIRONMENTS,
  MANIFEST_PATH,
  manifestErrors,
  paramNameOf,
} from './write-functions-env.mjs';

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

describe('config/feature-flags.json', () => {
  it('has exactly the three environments and passes the writer', () => {
    expect(Object.keys(manifest).sort()).toEqual([...ENVIRONMENTS].sort());
    expect(manifestErrors(manifest)).toEqual([]);
  });

  it.each(ENVIRONMENTS)(
    '%s: every key is a FlagName and every FlagName is there',
    (env) => {
      expect(Object.keys(manifest[env]).sort()).toEqual([...FLAG_NAMES].sort());
    },
  );

  it.each(ENVIRONMENTS)('%s: parses with FeatureFlags.parse', (env) => {
    const parsed = FeatureFlags.parse(manifest[env]);
    expect(parsed.ok ? [] : parsed.error.map((e) => e.errorCode)).toEqual([]);
  });
});

describe('functions param names', () => {
  // The §12.1 table; apps/functions/src/lib/flags.spec.ts pins the same
  // names on the `defineBoolean` side.
  it('derive from each key exactly as flags.ts declares them', () => {
    expect(
      Object.fromEntries(FLAG_NAMES.map((k) => [k, paramNameOf(k)])),
    ).toEqual({
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
    });
  });
});
