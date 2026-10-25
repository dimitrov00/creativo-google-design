/**
 * Where a person stands under one rule, as the rhythm's preview counts them
 * (`StreakPreviewSystem`) — the standing a phase reads as; each person is
 * tallied under exactly one of these in a {@link StreakStandingCounts}.
 */
export const StreakStanding = {
  /** The period is open and its due date ahead: on time, close to it, or held by a protection or a pause. */
  InRhythm: 'IN_RHYTHM',
  /** Past the due date, inside the grace: a visit still keeps the run. */
  InGrace: 'IN_GRACE',
  /** A period was missed and none is open. */
  Broken: 'BROKEN',
} as const;
export type StreakStanding =
  (typeof StreakStanding)[keyof typeof StreakStanding];
