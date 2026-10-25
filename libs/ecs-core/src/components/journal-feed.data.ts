import { JournalEffect } from './journal-effect.data';

/** The pills' values — the ONLY source of these strings (the companion below spreads them). */
const JOURNAL_FEED_VALUES = {
  All: 'ALL',
  Points: 'POINTS',
  Rewards: 'REWARDS',
  Status: 'STATUS',
} as const;

/**
 * The activity feed's pills — «Всички», «Точки», «Награди», «Статус».
 * The words on screen (and their lowercase test ids and i18n keys) are the
 * feature's, keyed by this dictionary.
 */
export type JournalFeed =
  (typeof JOURNAL_FEED_VALUES)[keyof typeof JOURNAL_FEED_VALUES];

/**
 * The pills (`JournalFeed.All` …) and the journal effects each one reads:
 * `JournalFeed.effectsOf(feed)` is the `journalEffect in […]` filter of a
 * feed page (`PageClientJournal`). The feed shows five effects; a streak,
 * freeze, pause or visit-outcome row is never one of its rows.
 */
export const JournalFeed = {
  ...JOURNAL_FEED_VALUES,

  /** The effects a pill reads, in the feed's order — a fresh array each call. */
  effectsOf(feed: JournalFeed): readonly JournalEffect[] {
    switch (feed) {
      case JOURNAL_FEED_VALUES.All:
        return [
          JournalEffect.Points,
          JournalEffect.Achievement,
          JournalEffect.Tier,
          JournalEffect.Reward,
          JournalEffect.Redemption,
        ];
      case JOURNAL_FEED_VALUES.Points:
        return [JournalEffect.Points];
      case JOURNAL_FEED_VALUES.Rewards:
        return [JournalEffect.Reward, JournalEffect.Redemption];
      case JOURNAL_FEED_VALUES.Status:
        return [JournalEffect.Tier];
    }
  },
} as const;
