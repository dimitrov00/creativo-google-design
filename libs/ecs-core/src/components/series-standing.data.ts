import type { BadgeLevel } from './badge-level.data';

/** A family for one client (§4.2) — the field `medalState`. `EARNED` = at least one level. */
export const MedalState = {
  NotStarted: 'NOT_STARTED',
  InProgress: 'IN_PROGRESS',
  Earned: 'EARNED',
} as const;
export type MedalState = (typeof MedalState)[keyof typeof MedalState];

/**
 * Where a family stands for one client — BadgeSystem's `standing` answer
 * (`BadgeSeries.standing`, `badge-series.ts:57-66`): the rim numeral is
 * `highestLevel` (0 = none, no numeral), the caption `value` / `target`.
 */
export type SeriesStanding = {
  readonly medalState: MedalState;
  readonly highestLevel: number;
  /** `null` = complete — a yearly family once earned, too. */
  readonly next: BadgeLevel | null;
  readonly value: number;
  readonly target: number | null;
};
