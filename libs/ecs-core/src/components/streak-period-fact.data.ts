import type { LocalDate } from '@core/primitives';
import type { StreakPeriodReason } from './streak-period-reason.data';

/**
 * One closed period, as the track draws it — the field `streakPeriodMark`:
 * `KEPT` and `REPAIRED` are a counted visit, dated by its day; `PROTECTED`
 * and `MISSED` a due date nobody met, dated by that due date — covered, or
 * not.
 */
export const StreakPeriodMark = {
  Kept: 'KEPT',
  Protected: 'PROTECTED',
  Repaired: 'REPAIRED',
  Missed: 'MISSED',
} as const;
export type StreakPeriodMark =
  (typeof StreakPeriodMark)[keyof typeof StreakPeriodMark];

/** One closed period of the rhythm (client-card revision 3 §4.2) — an element of `periods`. */
export type StreakPeriodFact = {
  readonly streakPeriodMark: StreakPeriodMark;
  readonly on: LocalDate;
  /** What covered a `PROTECTED` period; `null` on every other mark. */
  readonly periodReason: StreakPeriodReason | null;
};
