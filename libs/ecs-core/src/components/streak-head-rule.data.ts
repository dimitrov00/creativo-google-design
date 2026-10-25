import type { StreakRule } from './streak-rule.data';
import type { StreakTransition } from './streak-transition.data';

/** Where a rule stands in its head's `rules` list — the field `headRole`. */
export const HeadRole = {
  /** In force since its day — exactly one per head. */
  Current: 'CURRENT',
  /** Waiting for its day — at most one per head. */
  Scheduled: 'SCHEDULED',
} as const;
export type HeadRole = (typeof HeadRole)[keyof typeof HeadRole];

/**
 * One element of the head's 1-to-N `rules` list (F-9): a whole flat rule
 * and its role — the `CURRENT` one in force (no transition), or the
 * `SCHEDULED` one waiting with what it will do to the runs.
 */
export type StreakHeadRule = StreakRule & {
  readonly headRole: HeadRole;
  readonly streakTransition: StreakTransition | null;
};
