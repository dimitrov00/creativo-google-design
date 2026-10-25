import type { StreakIntervalSource } from './streak-interval-source.data';

/**
 * The open period's terms, pinned when it opened — a system value (the
 * projector's own); the state stores them flat as `period*`. A later visit,
 * or a habit that moved since, never changes a due date already promised.
 * `habitDays` is the person's own interval to one decimal (the only figure
 * that is not whole), known only where `source` is `PERSONAL`.
 */
export type StreakPeriodTerms = {
  readonly intervalDays: number;
  readonly graceDays: number;
  readonly source: StreakIntervalSource;
  readonly habitDays: number | null;
};
