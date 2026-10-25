import type { StreakIntervalRule } from './streak-interval.data';
import type { StreakQualifierRule } from './streak-qualifier.data';
import type { StreakRule } from './streak-rule.data';

/**
 * A rule as FOREIGN input (the L3 escape, F-22): every figure as a draft or
 * an admin callable holds it, and its first day AS WRITTEN — the editor's
 * day is no brand until {@link StreakRule.parse}, the only way it becomes a
 * `LocalDate` (Law 7.4). Every `StreakRule` is one.
 */
export type StreakRuleInput = Omit<
  StreakRule.Options,
  'effectiveFromLocalDate'
> & {
  /** The first day the version would judge by, as written — `parse` checks it is a real calendar day. */
  readonly effectiveFromLocalDate: string;
} & StreakQualifierRule &
  StreakIntervalRule;
