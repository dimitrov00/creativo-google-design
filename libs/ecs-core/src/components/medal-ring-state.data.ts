/**
 * A family's medal in its ring (revision 3 §3.8) — `medalRingState`: the
 * three standings plus the fourth form, `COMPLETE` (every level earned).
 */
export const MedalRingState = {
  NotStarted: 'NOT_STARTED',
  InProgress: 'IN_PROGRESS',
  Earned: 'EARNED',
  Complete: 'COMPLETE',
} as const;
export type MedalRingState =
  (typeof MedalRingState)[keyof typeof MedalRingState];
