import type { LocalizedText } from '../components/localized-text.data';
import type {
  ScheduledStreakRule,
  StreakRule,
} from '../components/streak-rule.data';

export type StreakDefinitionId = string & { readonly __brand: unique symbol };
export const StreakDefinitionId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): StreakDefinitionId => raw as StreakDefinitionId,
} as const;

/**
 * `streakDefinitions/{id}` — the HEAD every reader loads (the stored
 * `StreakDefinitionHeadDocument`, `loyalty-document.ts:415-426`): the rule
 * in force and at most ONE that waits for its day. A reader resolves the
 * rule BY DATE (StreakRuleSystem `inForceOn`), so nothing runs at midnight
 * to flip it. Written by the publish callable only. Each body carries its
 * own `version` and `effectiveFromDayKey`; the name is the head's, once for
 * every version. `updatedAt` → `updatedAtMs`.
 */
export type StreakDefinitionEntity = {
  readonly id: StreakDefinitionId;
  readonly name: LocalizedText;
  readonly current: StreakRule;
  readonly scheduled: ScheduledStreakRule | null;
  readonly updatedAtMs: number;
};
