import type { AchievementRuleId } from '@core/primitives';

/**
 * A rule version an entry cites (`ruleId@version`) — a value type for
 * system I/O; a journal RULE source stores it flat as
 * `sourceRuleId`/`sourceRuleVersion` (`JournalSourceRecord.ruleRef`).
 */
export type RuleRef = {
  readonly ruleId: AchievementRuleId;
  readonly version: number;
};
