import type {
  LocalDate,
  PublishRequestId,
  StreakDefinitionId,
} from '@core/primitives';
import type {
  StreakRule,
  StreakRuleDirection,
  StreakTransition,
} from './streak-rule.data';

/**
 * A publish of the rhythm's rule as the admin page SENDS it — the argument
 * of the gateway's `PublishStreakRule` port and the shape the publish
 * system judges (flip-3 plan §3.1.1). A component, never a ports-tier or
 * pipeline-tier type, so the system that judges a call and builds its
 * receipt may name it (Law 8.2).
 *
 * `rule` is the rule AS PROPOSED — its `version` the proposal
 * `baseVersion + 1`, its `effectiveFromLocalDate` the day asked — carried
 * whole: a call is a request in flight, never a stored document, and the
 * rule is the one value `StreakRule.parse` answers and the publish judges
 * (the version document it becomes stores it flat at its root).
 * `baseVersion` is the head's version the draft was made against (0 for a
 * rhythm nothing was published under); `requestId` the intent, so a retry
 * answers the first receipt and writes nothing; `previewHash` the preview
 * the admin saw, `null` when none was shown.
 */
export type StreakPublishCall = {
  readonly requestId: PublishRequestId;
  readonly streakId: StreakDefinitionId;
  readonly baseVersion: number;
  readonly rule: StreakRule;
  readonly streakTransition: StreakTransition;
  readonly previewHash: string | null;
};

export const StreakPublishCall = {
  /** A call to withdraw the version that waits for its day — `version` names it. */
  withdraw(
    requestId: PublishRequestId,
    streakId: StreakDefinitionId,
    version: number,
  ): StreakPublishCall.Withdraw {
    return { requestId, streakId, version };
  },

  /**
   * What a landed publish answers: the version it made, the day it starts
   * judging by, and whom the change favoured against the version before it.
   * A replayed publish answers the ORIGINAL receipt.
   */
  receipt(
    version: number,
    effectiveFromLocalDate: LocalDate,
    streakRuleDirection: StreakRuleDirection,
  ): StreakPublishCall.Receipt {
    return { version, effectiveFromLocalDate, streakRuleDirection };
  },
} as const;

export namespace StreakPublishCall {
  /** A withdrawal of the waiting version — the gateway's `WithdrawStreakRule` argument. */
  export type Withdraw = {
    readonly requestId: PublishRequestId;
    readonly streakId: StreakDefinitionId;
    readonly version: number;
  };
  /** A landed publish's answer — the gateway's and the pipeline's. */
  export type Receipt = {
    readonly version: number;
    readonly effectiveFromLocalDate: LocalDate;
    readonly streakRuleDirection: StreakRuleDirection;
  };
}
