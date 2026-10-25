import type { AchievementRuleId } from '@core/primitives';
import type { AwardSummary } from './award-summary.data';
import type { LocalizedText } from './localized-text.data';

/**
 * One level of a medal family, drawn «I»…«V» (`badge-series.ts:30-48`) — an
 * element of the family's `levels` array. Each level is its own once-rule
 * under its own award key, so a summary counts LEVELS and a level never
 * pays twice. The family checks its levels together (contiguous from 1,
 * rising targets — LoyaltyCatalogSystem).
 */
export type BadgeLevel = {
  /** 1-based, drawn as a numeral by the template. */
  readonly level: number;
  /** The once-rule that awards this level. */
  readonly ruleId: AchievementRuleId;
  /** On the family's metric; `null` = a one-off act, then the family's only level. */
  readonly target: number | null;
  /** «25 посещения с фейд» */
  readonly requirement: LocalizedText;
  /** `[]` = recognition only — each element a flat award (`awardKind`). */
  readonly awards: readonly AwardSummary[];
};

export const BadgeLevel = {
  /** A one-off act (no target): the family's only level. */
  isOneOff(level: BadgeLevel): boolean {
    return level.target === null;
  },
} as const;
