/** Why a journal entry was written, by kind — the stored `source.kind` tags, unchanged. */
export const JournalSourceKind = {
  /** A loyalty rule paid. */
  Rule: 'rule',
  /** A person adjusted the account. */
  Manual: 'manual',
  /** A person corrected an earlier entry. */
  Correction: 'correction',
  /** A scheduled job ran. */
  System: 'system',
  /** A data migration wrote it. */
  Migration: 'migration',
  /** A reward was redeemed. */
  Redemption: 'redemption',
} as const;
export type JournalSourceKind =
  (typeof JournalSourceKind)[keyof typeof JournalSourceKind];

/** The jobs that write the journal — the stored `source.job` strings, unchanged. */
export const JournalSystemJob = {
  Streak: 'streak',
  Tier: 'tier',
  PauseExpiry: 'pauseExpiry',
  PointsExpiry: 'pointsExpiry',
  RewardExpiry: 'rewardExpiry',
} as const;
export type JournalSystemJob =
  (typeof JournalSystemJob)[keyof typeof JournalSystemJob];

/** A rule version an entry cites (`ruleId@version`). */
export type RuleRef = {
  readonly ruleId: string;
  readonly version: number;
};

/**
 * Why an entry was written: a rule paid, a person asked, a job ran, a
 * migration, a redemption (`loyalty-document.ts:719-736`), unchanged.
 * `awardKey` is the rule's once-key; `eventId` the fact that fired it.
 */
export type JournalSource =
  | JournalSource.Rule
  | JournalSource.Adjustment
  | JournalSource.System
  | JournalSource.Migration
  | JournalSource.Redemption;

export const JournalSource = {
  rule(rule: RuleRef, awardKey: string, eventId: string): JournalSource.Rule {
    return { kind: JournalSourceKind.Rule, rule, awardKey, eventId };
  },
  manual(adjustmentId: string): JournalSource.Adjustment {
    return { kind: JournalSourceKind.Manual, adjustmentId };
  },
  correction(adjustmentId: string): JournalSource.Adjustment {
    return { kind: JournalSourceKind.Correction, adjustmentId };
  },
  system(job: JournalSystemJob): JournalSource.System {
    return { kind: JournalSourceKind.System, job };
  },
  migration(batchId: string): JournalSource.Migration {
    return { kind: JournalSourceKind.Migration, batchId };
  },
  redemption(redemptionId: string): JournalSource.Redemption {
    return { kind: JournalSourceKind.Redemption, redemptionId };
  },
} as const;

export namespace JournalSource {
  export type Rule = {
    readonly kind: typeof JournalSourceKind.Rule;
    readonly rule: RuleRef;
    readonly awardKey: string;
    readonly eventId: string;
  };
  /** A person's adjustment, or their correction of an earlier entry — one shape for both. */
  export type Adjustment = {
    readonly kind:
      typeof JournalSourceKind.Manual | typeof JournalSourceKind.Correction;
    readonly adjustmentId: string;
  };
  export type System = {
    readonly kind: typeof JournalSourceKind.System;
    readonly job: JournalSystemJob;
  };
  export type Migration = {
    readonly kind: typeof JournalSourceKind.Migration;
    readonly batchId: string;
  };
  export type Redemption = {
    readonly kind: typeof JournalSourceKind.Redemption;
    readonly redemptionId: string;
  };
}
