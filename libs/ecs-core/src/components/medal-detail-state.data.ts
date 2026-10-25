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
