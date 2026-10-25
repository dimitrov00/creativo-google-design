/**
 * How many people stand where, under one rule — one count per
 * `StreakStanding` (the preview's `before`/`after`, and the movement
 * between them).
 */
export type StreakStandingCounts = {
  readonly inRhythm: number;
  readonly inGrace: number;
  readonly broken: number;
};
