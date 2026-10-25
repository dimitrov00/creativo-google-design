/**
 * The capsule beside the rhythm's figure — the field `streakCapsule` (Law
 * 6), `null` in the answer while the run is healthy (nothing stands beside
 * a healthy figure). `HELD` stands where a warning would have stood: a
 * visit on the book answers the cue.
 */
export const StreakCapsule = {
  Frozen: 'FROZEN',
  Broken: 'BROKEN',
  Held: 'HELD',
  AtRisk: 'AT_RISK',
  InGrace: 'IN_GRACE',
} as const;
export type StreakCapsule = (typeof StreakCapsule)[keyof typeof StreakCapsule];
