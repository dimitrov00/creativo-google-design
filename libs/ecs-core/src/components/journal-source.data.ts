import type {
  AchievementRuleId,
  AdjustmentId,
  JournalEventId,
  MigrationBatchId,
  RedemptionId,
} from '@core/primitives';

/** Why a journal entry was written — the entry's discriminator `journalSource`. */
export const JournalSource = {
  /** A loyalty rule paid. */
  Rule: 'RULE',
  /** A person adjusted the account. */
  Manual: 'MANUAL',
  /** A person corrected an earlier entry. */
  Correction: 'CORRECTION',
  /** A scheduled job ran. */
  System: 'SYSTEM',
  /** A data migration wrote it. */
  Migration: 'MIGRATION',
  /** A reward was redeemed. */
  Redemption: 'REDEMPTION',
} as const;
export type JournalSource = (typeof JournalSource)[keyof typeof JournalSource];

/** The jobs that write the journal — the SYSTEM source's field `sourceSystemJob`. */
export const JournalSystemJob = {
  Streak: 'STREAK',
  Tier: 'TIER',
  PauseExpiry: 'PAUSE_EXPIRY',
  PointsExpiry: 'POINTS_EXPIRY',
  RewardExpiry: 'REWARD_EXPIRY',
} as const;
export type JournalSystemJob =
  (typeof JournalSystemJob)[keyof typeof JournalSystemJob];

/** A rule version an entry cites (`ruleId@version`) — a value type for system I/O. */
export type RuleRef = {
  readonly ruleId: AchievementRuleId;
  readonly version: number;
};

/**
 * Why an entry was written: a rule paid, a person asked, a job ran, a
 * migration, a redemption (the legacy `loyalty-document.ts`, deleted in flip 3) — a union of FLAT
 * variant slices at the entry's root, every variant-only field prefixed
 * `source`. `sourceAwardKey` is the rule's once-key; `sourceEventId` the
 * fact that fired it.
 */
export type JournalSourceRecord =
  | JournalSourceRecord.Rule
  | JournalSourceRecord.Adjustment
  | JournalSourceRecord.System
  | JournalSourceRecord.Migration
  | JournalSourceRecord.Redemption;

export const JournalSourceRecord = {
  rule(
    rule: RuleRef,
    sourceAwardKey: string,
    sourceEventId: JournalEventId,
  ): JournalSourceRecord.Rule {
    return {
      journalSource: JournalSource.Rule,
      sourceRuleId: rule.ruleId,
      sourceRuleVersion: rule.version,
      sourceAwardKey,
      sourceEventId,
    };
  },
  manual(sourceAdjustmentId: AdjustmentId): JournalSourceRecord.Adjustment {
    return { journalSource: JournalSource.Manual, sourceAdjustmentId };
  },
  correction(sourceAdjustmentId: AdjustmentId): JournalSourceRecord.Adjustment {
    return { journalSource: JournalSource.Correction, sourceAdjustmentId };
  },
  system(sourceSystemJob: JournalSystemJob): JournalSourceRecord.System {
    return { journalSource: JournalSource.System, sourceSystemJob };
  },
  migration(sourceBatchId: MigrationBatchId): JournalSourceRecord.Migration {
    return { journalSource: JournalSource.Migration, sourceBatchId };
  },
  redemption(sourceRedemptionId: RedemptionId): JournalSourceRecord.Redemption {
    return { journalSource: JournalSource.Redemption, sourceRedemptionId };
  },
  /** The rule version a RULE source cites, as the value type. */
  ruleRef(source: JournalSourceRecord.Rule): RuleRef {
    return { ruleId: source.sourceRuleId, version: source.sourceRuleVersion };
  },
} as const;

export namespace JournalSourceRecord {
  export type Rule = {
    readonly journalSource: typeof JournalSource.Rule;
    readonly sourceRuleId: AchievementRuleId;
    readonly sourceRuleVersion: number;
    readonly sourceAwardKey: string;
    readonly sourceEventId: JournalEventId;
  };
  /** A person's adjustment, or their correction of an earlier entry — one shape for both. */
  export type Adjustment = {
    readonly journalSource:
      typeof JournalSource.Manual | typeof JournalSource.Correction;
    readonly sourceAdjustmentId: AdjustmentId;
  };
  export type System = {
    readonly journalSource: typeof JournalSource.System;
    readonly sourceSystemJob: JournalSystemJob;
  };
  export type Migration = {
    readonly journalSource: typeof JournalSource.Migration;
    readonly sourceBatchId: MigrationBatchId;
  };
  export type Redemption = {
    readonly journalSource: typeof JournalSource.Redemption;
    readonly sourceRedemptionId: RedemptionId;
  };
}
