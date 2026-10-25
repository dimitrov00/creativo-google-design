import type { LocalDate } from '@core/primitives';
import { StreakPeriodMark } from './streak-period-fact.data';
import type { StreakPeriodReason } from './streak-period-reason.data';
import type { FreezeReason } from './streak-phase-state.data';

/** A mark of the track — the field `streakTrackMarkKind`: a closed period's mark, or the open one (`CURRENT`). */
export const StreakTrackMarkKind = {
  Kept: StreakPeriodMark.Kept,
  Protected: StreakPeriodMark.Protected,
  Repaired: StreakPeriodMark.Repaired,
  Missed: StreakPeriodMark.Missed,
  Current: 'CURRENT',
} as const;
export type StreakTrackMarkKind =
  (typeof StreakTrackMarkKind)[keyof typeof StreakTrackMarkKind];

/**
 * One mark of the rhythm's track, oldest first: the projection's closed
 * periods, then the open one (`StreakSystem.track`). Numbers, days and
 * tags — the words and the captions are the template's
 * (`wallet.presenter.ts` `closedPeriod`, `openPeriod`, `rhythmMarks`).
 */
export type StreakTrackMark = {
  readonly streakTrackMarkKind: StreakTrackMarkKind;
  /** The day the mark stands for: a visit's day, a due date, the moved due date, or today. */
  readonly on: LocalDate;
  /** What covered a `PROTECTED` mark (a closed period's reason, or the open phase's `FreezeReason`); `null` otherwise. */
  readonly reason: StreakPeriodReason | FreezeReason | null;
  /** The open period, after every closed one. */
  readonly open: boolean;
  /** The visit a `KEPT` or `REPAIRED` mark stands for; `null` on a due date nobody met and on the open mark. */
  readonly visitDay: LocalDate | null;
};
