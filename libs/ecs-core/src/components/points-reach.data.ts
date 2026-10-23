/**
 * What the points reach in the catalogue (the glance's «Лоялност» sentence,
 * DV5) — the ONLY source of these strings (Law 1, Law 6.2), the field
 * `pointsReach: PointsReach` of `RewardSystem.pointsReach`'s answer: the
 * balance is `ENOUGH_FOR` the costliest reward it buys, else `MORE_TO` the
 * cheapest one out of reach, else `NONE` (nothing left to name).
 */
export const PointsReach = {
  EnoughFor: 'ENOUGH_FOR',
  MoreTo: 'MORE_TO',
  None: 'NONE',
} as const;
export type PointsReach = (typeof PointsReach)[keyof typeof PointsReach];
