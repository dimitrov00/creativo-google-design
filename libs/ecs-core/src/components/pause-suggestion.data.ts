import type { ClientStats } from './client-stats.data';

/*
 * Split out of `client-stats.data.ts` (pass D, S-21; one name per file,
 * L-1). The fields are `ClientStats`'s own, picked — declared once, there.
 */

/** The pause suggestion's fields — all empty when none stands. */
export type PauseSuggestion = Pick<
  ClientStats,
  | 'pauseSuggestedNoShows'
  | 'pauseSuggestedWindowDays'
  | 'pauseSuggestionBasis'
  | 'pauseSuggestedAtUtcMs'
>;

const NO_PAUSE_SUGGESTION: PauseSuggestion = {
  pauseSuggestedNoShows: null,
  pauseSuggestedWindowDays: null,
  pauseSuggestionBasis: [],
  pauseSuggestedAtUtcMs: null,
};

export const PauseSuggestion = {
  /** No suggestion stands. */
  NONE: NO_PAUSE_SUGGESTION,

  /** A suggestion stands — the three scalars are set together (N9). */
  isRaised(suggestion: PauseSuggestion): boolean {
    return suggestion.pauseSuggestedAtUtcMs !== null;
  },
} as const;
