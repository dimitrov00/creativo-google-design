import type { LocalizedText } from './localized-text.data';

/**
 * A stamp card, «4 от 10», titled by what its last stamp pays — an entry of
 * `loyaltyAccounts/{uid}.punchCards[]` (`loyalty-document.ts:545-550`),
 * unchanged. `ruleId` names the loyalty engine's rule that stamps it.
 */
export type PunchCard = {
  readonly ruleId: string;
  /** Stamps so far, `0 … size`. */
  readonly filled: number;
  /** Stamps to fill, at least 1. */
  readonly size: number;
  readonly title: LocalizedText;
};
