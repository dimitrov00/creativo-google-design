import type { AnalyticsGoal } from '@core/components';
import type { AnalyticsGoalKey } from '@core/primitives';

/** The identity slice: the document key, `{barberId|shop}__{YYYY-MM}`. */
export type AnalyticsGoalMeta = {
  readonly id: AnalyticsGoalKey;
};

/**
 * `analyticsGoals/{key}` — one scope's takings goal for one month (staff
 * analytics v2 PR 6, «Goals»): the key's two halves are the body's
 * `barberId` (`null` for the shop) and `goalMonth`, so a set overwrites and
 * the callable reads a month's goal by key. The document is this minus
 * `id` (Law 5); written only by `setAnalyticsGoal`, read only by
 * `staffAnalytics` on a `MONTH` — a colleague never reads another's money.
 * (`StoredAnalyticsGoal`: the slice keeps the archetype's noun, `AnalyticsGoal`.)
 */
export type StoredAnalyticsGoal = AnalyticsGoalMeta & AnalyticsGoal;
