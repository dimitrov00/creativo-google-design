import { FeatureFlagKey } from '@creativo/domain/governance';
import { BooleanParam, defineBoolean } from 'firebase-functions/params';

/**
 * The functions half of the build-time flags (R41, §12.1). Each value comes
 * from `dist/apps/functions/.env.<projectId>`, which
 * `tools/flags/write-functions-env.mjs` writes from `config/feature-flags.json`
 * after the build, so the server and the web bundle read one manifest.
 * Every default is false: a param with no value keeps its feature off.
 *
 * When off, triggers return early and callables refuse with
 * `failed-precondition` / `feature.off`. Enable a param before its web flag,
 * disable it after (R52).
 */
const flag = (name: string, description: string): BooleanParam =>
  defineBoolean(name, { default: false, description });

export const CLIENT_PROFILE = flag(
  'CLIENT_PROFILE',
  'Client page, history and tags (P1)',
);
export const CLIENT_PAUSE = flag('CLIENT_PAUSE', 'Client pauses (P2)');
export const LOYALTY_POINTS = flag('LOYALTY_POINTS', 'Loyalty points (P3)');
export const LOYALTY_STREAKS = flag(
  'LOYALTY_STREAKS',
  'Visit rhythm and protection (P3)',
);
export const LOYALTY_ACHIEVEMENTS = flag(
  'LOYALTY_ACHIEVEMENTS',
  'Badges and punch cards (P3)',
);
export const LOYALTY_TIERS = flag('LOYALTY_TIERS', 'Loyalty tiers (P3)');
export const CLIENT_SUPPORT = flag(
  'CLIENT_SUPPORT',
  'Corrections, approvals and the activity timeline (P4)',
);
export const LOYALTY_SELF_VIEW = flag(
  'LOYALTY_SELF_VIEW',
  "The client's own loyalty view and redemption (P5)",
);
export const CLIENT_MERGE = flag('CLIENT_MERGE', 'Client merge (P5)');
export const SUPPORT_BULK = flag(
  'SUPPORT_BULK',
  'Bulk goodwill and rule authoring (P5)',
);
export const CLIENT_PRIVACY = flag(
  'CLIENT_PRIVACY',
  'Data export and erasure (P5)',
);
// The two earlier keys get params too, so every manifest key reaches the
// server and `FLAG_PARAMS` stays exhaustive over `FeatureFlagKey`.
export const REFERRALS_INVITATIONS = flag(
  'REFERRALS_INVITATIONS',
  'Referral invitations',
);
export const DISCOUNTS_GRANTS = flag('DISCOUNTS_GRANTS', 'Discount grants');

/** Exhaustive: a new `FeatureFlagKey` fails compilation until it has a param. */
export const FLAG_PARAMS: Readonly<Record<FeatureFlagKey, BooleanParam>> = {
  'client.profile': CLIENT_PROFILE,
  'client.pause': CLIENT_PAUSE,
  'loyalty.points': LOYALTY_POINTS,
  'loyalty.streaks': LOYALTY_STREAKS,
  'loyalty.achievements': LOYALTY_ACHIEVEMENTS,
  'loyalty.tiers': LOYALTY_TIERS,
  'client.support': CLIENT_SUPPORT,
  'loyalty.selfView': LOYALTY_SELF_VIEW,
  'client.merge': CLIENT_MERGE,
  'support.bulk': SUPPORT_BULK,
  'client.privacy': CLIENT_PRIVACY,
  'referrals.invitations': REFERRALS_INVITATIONS,
  'discounts.grants': DISCOUNTS_GRANTS,
};

/**
 * Call inside a handler, never at module load: during deploy analysis the
 * env holds no values yet, so a top-level read would bake in `false`.
 */
export function flagOn(key: FeatureFlagKey): boolean {
  // eslint-disable-next-line security/detect-object-injection -- `key` is a closed `FeatureFlagKey` literal and `FLAG_PARAMS` is exhaustive over it.
  return FLAG_PARAMS[key].value();
}
