/** How a season's track reads — `seasonTrackState`. */
export const SeasonTrackState = {
  Ended: 'ENDED',
  Complete: 'COMPLETE',
  Pending: 'PENDING',
  ToNext: 'TO_NEXT',
} as const;
export type SeasonTrackState =
  (typeof SeasonTrackState)[keyof typeof SeasonTrackState];
