import type { LocalDate, UtcEpochMs } from '@core/primitives';

/** How a level was earned — the field `earnedVia`. */
export const EarnedVia = {
  Rule: 'RULE',
  Manual: 'MANUAL',
} as const;
export type EarnedVia = (typeof EarnedVia)[keyof typeof EarnedVia];

/**
 * One earned level of a family's progress (`badgeProgress.earned[]`, an
 * array element): when — the latest time, for a yearly one —, on which shop
 * day (T5: the stamp a system buckets by day carries its day, both written
 * from the same `ShopNow`), how, and how often.
 */
export type EarnedLevel = {
  readonly level: number;
  readonly earnedAtUtcMs: UtcEpochMs;
  /** The shop day of `earnedAtUtcMs` — what «Последни» and a day's scope group by. */
  readonly earnedLocalDate: LocalDate;
  readonly earnedVia: EarnedVia;
  /** How many times a repeatable level was earned; 1 otherwise. */
  readonly count: number;
};
