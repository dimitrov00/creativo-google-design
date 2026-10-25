/**
 * What a new rule does to the runs that exist — the field
 * `streakTransition`: `GRANDFATHER` keeps every count, best and banked
 * protection and never moves an open due date earlier; `RECOMPUTE` replays
 * the history under the new rule.
 */
export const StreakTransition = {
  Grandfather: 'GRANDFATHER',
  Recompute: 'RECOMPUTE',
} as const;
export type StreakTransition =
  (typeof StreakTransition)[keyof typeof StreakTransition];
