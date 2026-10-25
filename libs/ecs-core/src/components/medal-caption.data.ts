/** The caption a medal wears on a rail or a grid, by the numeral rule — `medalCaption`. */
export const MedalCaption = {
  /** The visit on screen completes its next level. */
  WithThisVisit: 'WITH_THIS_VISIT',
  /** An ended season's family that stopped where it stopped: no caption. */
  None: 'NONE',
  /** A calendar-driven family: the day its next level lands. */
  LandsOn: 'LANDS_ON',
  /** A single act not yet done. */
  NotYet: 'NOT_YET',
  /** «23/25 до III» — the count towards the next level. */
  ToLevel: 'TO_LEVEL',
  /** A single level or a yearly act, earned: its day. */
  OnDay: 'ON_DAY',
  /** Every level earned. */
  Complete: 'COMPLETE',
} as const;
export type MedalCaption = (typeof MedalCaption)[keyof typeof MedalCaption];
