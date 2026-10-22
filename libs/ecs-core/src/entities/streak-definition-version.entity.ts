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
 * §3.1) beside how it came to be. `publishedByUserId` is the ACCOUNT that
 * published (D29: an account act, never a client record), `requestId` the
 * intent that made it (a retry writes nothing), `streakTransition` /
 * `streakRuleDirection` what it does to the runs and whom it favoured, and
 * `withdrawnAtUtcMs` the one field ever set later — a scheduled version
 * called off, or replaced, before its day. The id IS the version
 * (`StreakDefinitionVersionId.forVersion`): every writer keeps
 * `id == forVersion(version)`, so the newest document by `version` is the
 * highest number ever written.
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
