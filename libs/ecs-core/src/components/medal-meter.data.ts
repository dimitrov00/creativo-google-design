/** The thin meter towards the next level — `medalMeter`. */
export const MedalMeter = {
  /** The visit on screen completes the level: all but closed. */
  Pending: 'PENDING',
  /** The honest fraction of the way to the next level. */
  Fraction: 'FRACTION',
  /** No meter. */
  None: 'NONE',
} as const;
export type MedalMeter = (typeof MedalMeter)[keyof typeof MedalMeter];
