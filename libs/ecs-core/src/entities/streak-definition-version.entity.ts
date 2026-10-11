import type {
  StreakRule,
  StreakRuleDirection,
  StreakRuleParameter,
  StreakTransition,
} from '@core/components';
import type {
  PublishRequestId,
  StreakDefinitionVersionId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';

/**
 * `streakDefinitions/{streakId}/versions/{version:06}` — ONE publish,
 * immutable: the FLAT rule at the document ROOT (there is no `rule` field,
 * §3.1) beside how it came to be. `publishedByUserId` is the account that
 * published (was `publishedBy`), `requestId` the intent that made it (a
 * retry writes nothing), `streakTransition` / `streakRuleDirection` were
 * `transition` / `direction` (N15), and `withdrawnAtUtcMs` the one field
 * ever set later — a scheduled version called off, or replaced, before its
 * day. The id IS the version: a body numbered otherwise is malformed.
 */
export type StreakDefinitionVersion = StreakRule & {
  readonly id: StreakDefinitionVersionId;
  readonly publishedAtUtcMs: UtcEpochMs;
  readonly publishedByUserId: UserId;
  readonly streakTransition: StreakTransition;
  /** Whom the change favoured, against the version before it. */
  readonly streakRuleDirection: StreakRuleDirection;
  /** The parameters that differ from the version before it, in the rule's order; never a version's identity. */
  readonly changed: readonly StreakRuleParameter[];
  readonly requestId: PublishRequestId;
  readonly withdrawnAtUtcMs: UtcEpochMs | null;
};
