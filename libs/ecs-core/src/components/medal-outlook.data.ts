/*
 * HOW A MEDAL FAMILY READS FOR ONE CLIENT (Law 10.2, the decision-extraction
 * pass §2.4) — the tags the medal systems answer with (`BadgeSystem`,
 * `StandingSystem`, `SeasonSystem`), so a presenter only words a decision
 * that was taken here: which caption a tile wears, how its ring and meter
 * are drawn, which state line a detail page says, how its progress card
 * reads, where each rung of its ladder stands, which cue a strip names,
 * which section a scope page files a family under and how a season's track
 * reads. Each dictionary is named after its field (Law 6); the words, the
 * icons and the DS states are the presenters' tables. Every dictionary
 * stands alone: none extends `MedalState` (badge-level.data.ts, D-5).
 */

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

/** A detail page's state line — `medalDetailState`, in its precedence. */
export const MedalDetailState = {
  /** No longer awarded. */
  Retired: 'RETIRED',
  /** A yearly act earned more than once: how many times, and when last. */
  Repeated: 'REPEATED',
  /** Its season or event ended before the family was complete. */
  SeasonEnded: 'SEASON_ENDED',
  /** A single act (or one level) done, by its day. */
  OneOffEarned: 'ONE_OFF_EARNED',
  /** A single act not yet done. */
  OneOffNotYet: 'ONE_OFF_NOT_YET',
  /** Nothing moved it yet. */
  NotStarted: 'NOT_STARTED',
  /** Under way, no level earned yet. */
  UnderWay: 'UNDER_WAY',
  /** Every level earned, no day to name. */
  Complete: 'COMPLETE',
  /** Every level earned, since the last one's day. */
  CompleteSince: 'COMPLETE_SINCE',
  /** At a level, since its day. */
  LevelSince: 'LEVEL_SINCE',
} as const;
export type MedalDetailState =
  (typeof MedalDetailState)[keyof typeof MedalDetailState];

/** A detail page's progress card — `medalProgressCard`. */
export const MedalProgressCard = {
  /** A single act: its day once done, «0 от 1» until then. */
  OneOff: 'ONE_OFF',
  /** A ladder climbed to its top: its last threshold. */
  Complete: 'COMPLETE',
  /** A family that can no longer move: where it stopped. */
  Stopped: 'STOPPED',
  /** Towards the next level: the figure, its threshold, what is left. */
  ToNext: 'TO_NEXT',
} as const;
export type MedalProgressCard =
  (typeof MedalProgressCard)[keyof typeof MedalProgressCard];

/** Where one level of a detail page's ladder stands — `ladderRung`. */
export const LadderRung = {
  Passed: 'PASSED',
  Next: 'NEXT',
  Later: 'LATER',
} as const;
export type LadderRung = (typeof LadderRung)[keyof typeof LadderRung];

/** The one cue of the medal strip — `medalCue`, first match wins. */
export const MedalCue = {
  WithThisVisit: 'WITH_THIS_VISIT',
  New: 'NEW',
  Close: 'CLOSE',
} as const;
export type MedalCue = (typeof MedalCue)[keyof typeof MedalCue];

/** A scope page's section — `scopeSection`. */
export const ScopeSection = {
  ServiceCategory: 'SERVICE_CATEGORY',
  Barbers: 'BARBERS',
  Shops: 'SHOPS',
  General: 'GENERAL',
  Whole: 'WHOLE',
} as const;
export type ScopeSection = (typeof ScopeSection)[keyof typeof ScopeSection];

/** How a season's track reads — `seasonTrackState`. */
export const SeasonTrackState = {
  Ended: 'ENDED',
  Complete: 'COMPLETE',
  Pending: 'PENDING',
  ToNext: 'TO_NEXT',
} as const;
export type SeasonTrackState =
  (typeof SeasonTrackState)[keyof typeof SeasonTrackState];
