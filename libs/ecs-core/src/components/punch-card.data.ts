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

export const PunchCard = {
  /**
   * How far the card has come (Law 10.2 — the wallet's stamp card words
   * these, never derives them): the stamps `filled`, clamped to
   * `[0, size]` so a stored count out of range never overdraws the gauge;
   * the stamps `left` to the reward, `max(0, size − filled)`; and the count
   * the «N to the next» sentence names, `toNext = max(1, left)` — a full
   * card still says the one stamp that pays.
   */
  progress(card: PunchCard): PunchCard.Progress {
    const filled = Math.min(Math.max(card.filled, 0), card.size);
    const left = Math.max(0, card.size - filled);
    return { filled, left, toNext: Math.max(1, left) };
  },
} as const;

export namespace PunchCard {
  /** {@link PunchCard.progress}'s answer — counts of stamps, never words. */
  export type Progress = {
    readonly filled: number;
    readonly left: number;
    readonly toNext: number;
  };
}
