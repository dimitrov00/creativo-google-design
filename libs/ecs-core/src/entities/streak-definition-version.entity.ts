import type {
  StreakRule,
  StreakRuleDirection,
  StreakRuleParameter,
  StreakTransition,
} from '../components/streak-rule.data';
import type { UserId } from './user.entity';

export type StreakDefinitionVersionId = string & {
  readonly __brand: unique symbol;
};
export const StreakDefinitionVersionId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): StreakDefinitionVersionId =>
    raw as StreakDefinitionVersionId,

  /**
   * A version's document id: the version padded to six digits
   * (`streakDefinitionVersionId`, `loyalty-document.ts:147`), so the history
   * sorts by document id and needs no index.
   */
  forVersion: (version: number): StreakDefinitionVersionId =>
    StreakDefinitionVersionId.of(String(version).padStart(6, '0')),
} as const;

/**
 * `streakDefinitions/{streakId}/versions/{version:06}` — ONE publish,
 * immutable (the stored `StreakDefinitionVersionDocument`,
 * `loyalty-document.ts:428-445`): the rule's body spread at the document
 * ROOT (there is no `rule` field, §3.1) beside how it came to be.
 * `publishedBy` is a uid, `requestId` the intent that made it (a retry
 * writes nothing), and `withdrawnAtMs` the one field ever set later — a
 * scheduled version called off, or replaced, before its day. The id IS the
 * version: a body numbered otherwise is malformed. ISO → `*Ms` only.
 */
export type StreakDefinitionVersionEntity = StreakRule & {
  readonly id: StreakDefinitionVersionId;
  readonly publishedAtMs: number;
  readonly publishedBy: UserId;
  readonly transition: StreakTransition;
  /** Whom the change favoured, against the version before it. */
  readonly direction: StreakRuleDirection;
  /** The parameters that differ from the version before it, in the rule's order; never a version's identity. */
  readonly changed: readonly StreakRuleParameter[];
  readonly requestId: string;
  readonly withdrawnAtMs: number | null;
};
