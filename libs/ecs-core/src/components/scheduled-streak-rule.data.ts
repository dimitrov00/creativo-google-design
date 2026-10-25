import type { StreakRule } from './streak-rule.data';
import type { StreakTransition } from './streak-transition.data';

/** The version that waits for its day, and what it will do to the runs that exist — a system value. */
export type ScheduledStreakRule = StreakRule & {
  readonly streakTransition: StreakTransition;
};
