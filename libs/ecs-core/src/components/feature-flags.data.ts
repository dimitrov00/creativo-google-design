import { GovernanceError } from './governance-errors.data';
import { Result } from './result.data';

/**
 * The platform's build-time flags — the keys of `config/feature-flags.json`
 * (the manifest), in rollout order (§12.1). The ONLY source of these
 * strings: `apps/functions/src/lib/flags.ts` maps each to a functions param
 * and the web bundle reads the same manifest. Adding a flag is a deliberate
 * code change here, and `feature-flags.data.spec.ts` holds this dictionary
 * and every environment of the manifest equal.
 */
export const FlagName = {
  ClientProfile: 'client.profile',
  ClientPause: 'client.pause',
  LoyaltyPoints: 'loyalty.points',
  LoyaltyStreaks: 'loyalty.streaks',
  LoyaltyAchievements: 'loyalty.achievements',
  LoyaltyTiers: 'loyalty.tiers',
  ClientSupport: 'client.support',
  LoyaltySelfView: 'loyalty.selfView',
  ClientMerge: 'client.merge',
  SupportBulk: 'support.bulk',
  ClientPrivacy: 'client.privacy',
  ReferralsInvitations: 'referrals.invitations',
  DiscountsGrants: 'discounts.grants',
} as const;
export type FlagName = (typeof FlagName)[keyof typeof FlagName];

/** Every flag, rollout order — derived, never a second source. */
export const FLAG_NAMES: readonly FlagName[] = Object.values(FlagName);

/**
 * One environment's flags — every key present, a boolean each. **Never
 * stored in Firestore** and never a live backend (owner ruling 2026-09-24):
 * flags are build-time values, `config/feature-flags.json` → the web bundle,
 * and → functions params via `tools/flags/write-functions-env.mjs`.
 */
export type FeatureFlags = { readonly [K in FlagName]: boolean };

/** All off — what a missing or partial manifest falls back to. */
const ALL_OFF: FeatureFlags = {
  [FlagName.ClientProfile]: false,
  [FlagName.ClientPause]: false,
  [FlagName.LoyaltyPoints]: false,
  [FlagName.LoyaltyStreaks]: false,
  [FlagName.LoyaltyAchievements]: false,
  [FlagName.LoyaltyTiers]: false,
  [FlagName.ClientSupport]: false,
  [FlagName.LoyaltySelfView]: false,
  [FlagName.ClientMerge]: false,
  [FlagName.SupportBulk]: false,
  [FlagName.ClientPrivacy]: false,
  [FlagName.ReferralsInvitations]: false,
  [FlagName.DiscountsGrants]: false,
};

export const FeatureFlags = {
  /** Every flag off — safe when the manifest is missing or partial. */
  defaults(): FeatureFlags {
    return ALL_OFF;
  },

  /** The edge guard for an untrusted key. */
  isFlagName(value: unknown): value is FlagName {
    for (let i = 0; i < FLAG_NAMES.length; i++) {
      if (FLAG_NAMES[i] === value) return true;
    }
    return false;
  },

  /**
   * The edge guard for one environment's raw map: every key known, every
   * value a boolean — or ALL the refusals at once (an unknown key, a
   * non-boolean value). Absent keys stay off.
   */
  parse(raw: {
    readonly [key: string]: unknown;
  }): Result<FeatureFlags, readonly GovernanceError[]> {
    const errors: GovernanceError[] = [];
    const flags: { [K in FlagName]: boolean } = { ...ALL_OFF };
    const keys = Object.keys(raw);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i] as string;
      const value = raw[key];
      if (!FeatureFlags.isFlagName(key)) {
        errors.push(GovernanceError.featureFlagsUnknownKey(key));
      } else if (typeof value !== 'boolean') {
        errors.push(GovernanceError.featureFlagsInvalidValue(key));
      } else {
        flags[key] = value;
      }
    }
    return errors.length > 0 ? Result.err(errors) : Result.ok(flags);
  },

  /** Whether one flag is on. */
  flagOn(flags: FeatureFlags, key: FlagName): boolean {
    return flags[key];
  },

  /** A new map with one flag set — the input is never touched. */
  withFlag(flags: FeatureFlags, key: FlagName, on: boolean): FeatureFlags {
    return { ...flags, [key]: on };
  },
} as const;
