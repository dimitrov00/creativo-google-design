import type { AchievementRuleId } from '@core/primitives';
import type { LocalizedText } from './localized-text.data';

/**
 * A stamp card, «4 от 10», titled by what its last stamp pays — an element
 * of `loyaltyAccounts/{customerId}.punchCards[]` (flip 3).
 * `ruleId` names the loyalty engine's rule that stamps it.
 */
export type PunchCard = {
  readonly ruleId: AchievementRuleId;
  /** Stamps so far, `0 … size`. */
  readonly filled: number;
  /** Stamps to fill, at least 1. */
  readonly size: number;
  readonly title: LocalizedText;
};
