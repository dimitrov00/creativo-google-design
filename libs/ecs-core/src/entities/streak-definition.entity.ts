import type { LocalizedText, StreakHeadRule } from '@core/components';
import type { StreakDefinitionId, UtcEpochMs } from '@core/primitives';

/**
 * `streakDefinitions/{id}` — the HEAD every reader loads: the rule in force
 * and at most ONE that waits for its day, as the 1-to-N `rules` list of
 * flat rules (F-9) — one `CURRENT` element, at most one `SCHEDULED`, sorted
 * by `effectiveFromLocalDate` — instead of two nested thirty-field rules.
 * A reader resolves the rule BY DATE (StreakRuleSystem `inForceOn`), so
 * nothing runs at midnight to flip it. Written whole by the publish
 * pipeline (`publishStreakDefinition` / `withdrawStreakDefinition`, behind
 * the admin-only callable) and by the dev seed. Each element carries its
 * own `version` and `effectiveFromLocalDate`; the name is the head's, once
 * for every version.
 */
export type StreakDefinition = {
  readonly id: StreakDefinitionId;
  readonly name: LocalizedText;
  readonly rules: readonly StreakHeadRule[];
  readonly updatedAtUtcMs: UtcEpochMs;
};
