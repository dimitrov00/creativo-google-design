import { StreakPreviewOutcome } from './streak-preview-outcome.data';
import type { StreakPreviewUnavailable } from './streak-preview-unavailable.data';
import type { StreakStandingCounts } from './streak-standing-counts.data';

/**
 * What a change of the rhythm's rule does to the people it judges, in
 * counts (`StreakPreviewSystem.estimate`) — discriminated by
 * `streakPreviewOutcome`. `before`/`after` are `null` under a rule that is
 * OFF: an off rule judges nobody, which is not "nobody is in rhythm".
 * `back` and `out` count the people a change moves INTO `inRhythm` and out
 * of it, so `after.inRhythm − before.inRhythm` is `back − out`; both are 0
 * while either rule is off, because then it is the rule that comes or goes.
 */
export type StreakPreview = StreakPreview.Estimate | StreakPreview.Unavailable;

export const StreakPreview = {
  estimate(
    clients: number,
    before: StreakStandingCounts | null,
    after: StreakStandingCounts | null,
    back: number,
    out: number,
  ): StreakPreview.Estimate {
    return {
      streakPreviewOutcome: StreakPreviewOutcome.Estimate,
      clients,
      before,
      after,
      back,
      out,
    };
  },
  unavailable(reason: StreakPreviewUnavailable): StreakPreview.Unavailable {
    return { streakPreviewOutcome: StreakPreviewOutcome.Unavailable, reason };
  },
} as const;

export namespace StreakPreview {
  export type Estimate = {
    readonly streakPreviewOutcome: typeof StreakPreviewOutcome.Estimate;
    /** The people with a visit to judge: each is in exactly one count of a rule that is on. */
    readonly clients: number;
    readonly before: StreakStandingCounts | null;
    readonly after: StreakStandingCounts | null;
    readonly back: number;
    readonly out: number;
  };
  export type Unavailable = {
    readonly streakPreviewOutcome: typeof StreakPreviewOutcome.Unavailable;
    readonly reason: StreakPreviewUnavailable;
  };
}
