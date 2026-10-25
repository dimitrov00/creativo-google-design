import type { TierOverride } from './tier-override.data';
import type { TierStanding } from './tier-standing.data';

/**
 * The account's tier — the computed standing and the optional manual
 * override, both flat at the account's root (Law 6).
 */
export type TierState = TierStanding & TierOverride;
