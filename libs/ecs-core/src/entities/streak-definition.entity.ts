import type { LocalizedText } from '../components/localized-text.data';
import type { StreakHeadRule } from '../components/streak-rule.data';
import type { StreakDefinitionId } from '../primitives/ids.primitive';
import type { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';

/*
 * The id lives in `primitives/ids.primitive.ts` (flatten-spec §1.5); it is
 * re-exported here only while the barrel's staging block still names this
 * file (`index.ts`), and leaves with that line.
 */

/**
 * `streakDefinitions/{id}` — the HEAD every reader loads: the rule in force
 * and at most ONE that waits for its day, as the 1-to-N `rules` list of
 * flat rules (F-9) — one `CURRENT` element, at most one `SCHEDULED`, sorted
 * by `effectiveFromLocalDate` — instead of two nested thirty-field rules.
 * A reader resolves the rule BY DATE (StreakRuleSystem `inForceOn`), so
 * nothing runs at midnight to flip it. Written by the publish callable
 * only. Each element carries its own `version` and
 * `effectiveFromLocalDate`; the name is the head's, once for every version.
 */
export type StreakDefinition = {
  readonly id: StreakDefinitionId;
  readonly name: LocalizedText;
  readonly rules: readonly StreakHeadRule[];
  readonly updatedAtUtcMs: UtcEpochMs;
};
