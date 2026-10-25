import type {
  AchievementRuleId,
  PauseId,
  RedemptionId,
  RewardId,
  SeatId,
  StreakDefinitionId,
  TierId,
  LocalDate,
  AttendanceState,
} from '@core/primitives';
import type { GrantRefFields } from './grant-ref-fields.data';
import type { RewardRefFields } from './reward-ref-fields.data';

/**
 * What a journal entry changed — the entry's discriminator `journalEffect`,
 * a root key of every `clientJournal` row (the ledger's index #21 queries
 * it). `POINTS` is the ONLY effect that moves the balance.
 */
export const JournalEffect = {
  Points: 'POINTS',
  Streak: 'STREAK',
  Freeze: 'FREEZE',
  Achievement: 'ACHIEVEMENT',
  Tier: 'TIER',
  Reward: 'REWARD',
  Redemption: 'REDEMPTION',
  Pause: 'PAUSE',
  VisitOutcome: 'VISIT_OUTCOME',
} as const;
export type JournalEffect = (typeof JournalEffect)[keyof typeof JournalEffect];

/** What happened to a run — the STREAK effect's field `streakOp`. */
export const StreakOp = {
  Extended: 'EXTENDED',
  Broken: 'BROKEN',
  Repaired: 'REPAIRED',
  ExtendedDue: 'EXTENDED_DUE',
  Excused: 'EXCUSED',
  Reset: 'RESET',
  Set: 'SET',
  Recomputed: 'RECOMPUTED',
} as const;
export type StreakOp = (typeof StreakOp)[keyof typeof StreakOp];

/** What happened to the protections a run banks — the field `freezeOp`. */
export const FreezeOp = {
  Earned: 'EARNED',
  Granted: 'GRANTED',
  Applied: 'APPLIED',
} as const;
export type FreezeOp = (typeof FreezeOp)[keyof typeof FreezeOp];

/** The field `achievementOp`. */
export const AchievementOp = {
  Granted: 'GRANTED',
  Revoked: 'REVOKED',
} as const;
export type AchievementOp = (typeof AchievementOp)[keyof typeof AchievementOp];

/** The field `tierOp`. */
export const TierOp = {
  Changed: 'CHANGED',
  Granted: 'GRANTED',
  Overridden: 'OVERRIDDEN',
  OverrideCleared: 'OVERRIDE_CLEARED',
} as const;
export type TierOp = (typeof TierOp)[keyof typeof TierOp];

/** The field `rewardOp`. */
export const RewardOp = {
  Granted: 'GRANTED',
  Reinstated: 'REINSTATED',
  Revoked: 'REVOKED',
} as const;
export type RewardOp = (typeof RewardOp)[keyof typeof RewardOp];

/** The field `redemptionOp`. */
export const RedemptionOp = {
  Redeemed: 'REDEEMED',
  Reversed: 'REVERSED',
  Expired: 'EXPIRED',
} as const;
export type RedemptionOp = (typeof RedemptionOp)[keyof typeof RedemptionOp];

/** The field `pauseOp`. */
export const PauseOp = {
  Applied: 'APPLIED',
  Edited: 'EDITED',
  Lifted: 'LIFTED',
  Expired: 'EXPIRED',
} as const;
export type PauseOp = (typeof PauseOp)[keyof typeof PauseOp];

/** How long a pause lasts — the PAUSE effect's field `pauseTerm`. */
export const PauseTerm = {
  /** Through `pauseUntil`, inclusive. */
  Temporary: 'TEMPORARY',
  /** Until somebody lifts it. */
  Permanent: 'PERMANENT',
} as const;
export type PauseTerm = (typeof PauseTerm)[keyof typeof PauseTerm];

/** What a pause stops: the client's own bookings, or every booking — the field `pauseScope`. */
export const PauseScope = {
  SelfService: 'SELF_SERVICE',
  AllBookings: 'ALL_BOOKINGS',
} as const;
export type PauseScope = (typeof PauseScope)[keyof typeof PauseScope];

/**
 * What a journal entry changed — a union of FLAT variant slices at the
 * entry's root, discriminated by `journalEffect`; every variant-only field
 * carries its effect's prefix so the slice never collides with the entry's
 * other slices. Dates are shop-calendar days (`streakDueBy`, `tierUntil`,
 * `pauseUntil`).
 */
export type JournalEffectRecord =
  | JournalEffectRecord.Points
  | JournalEffectRecord.Streak
  | JournalEffectRecord.Freeze
  | JournalEffectRecord.Achievement
  | JournalEffectRecord.Tier
  | JournalEffectRecord.Reward
  | JournalEffectRecord.Redemption
  | JournalEffectRecord.Pause
  | JournalEffectRecord.VisitOutcome;

export const JournalEffectRecord = {
  points(pointsDelta: number): JournalEffectRecord.Points {
    return { journalEffect: JournalEffect.Points, pointsDelta };
  },

  /** Only a `POINTS` effect moves the balance. */
  movesBalance(
    effect: JournalEffectRecord,
  ): effect is JournalEffectRecord.Points {
    return effect.journalEffect === JournalEffect.Points;
  },

  /** A `TIER` effect — the guard a reader narrows by once a system has said the line is a tier change (`LedgerSystem.lineOf`). */
  isTier(effect: JournalEffectRecord): effect is JournalEffectRecord.Tier {
    return effect.journalEffect === JournalEffect.Tier;
  },

  /** What the effect adds to the balance: its signed `pointsDelta`, `0` for every other effect. */
  pointsDelta(effect: JournalEffectRecord): number {
    return effect.journalEffect === JournalEffect.Points
      ? effect.pointsDelta
      : 0;
  },
} as const;

export namespace JournalEffectRecord {
  export type Points = {
    readonly journalEffect: typeof JournalEffect.Points;
    /** Signed: a spend or a reversal is negative. */
    readonly pointsDelta: number;
  };
  export type Streak = {
    readonly journalEffect: typeof JournalEffect.Streak;
    readonly streakId: StreakDefinitionId;
    readonly streakOp: StreakOp;
    readonly streakFrom: number;
    readonly streakTo: number;
    readonly streakDueBy: LocalDate | null;
  };
  export type Freeze = {
    readonly journalEffect: typeof JournalEffect.Freeze;
    readonly streakId: StreakDefinitionId;
    readonly freezeOp: FreezeOp;
    readonly freezeCount: number;
    readonly freezesBankedAfter: number;
  };
  export type Achievement = {
    readonly journalEffect: typeof JournalEffect.Achievement;
    /** The rule version cited (`ruleId@version`, today's nested `rule: RuleRef`). */
    readonly achievementRuleId: AchievementRuleId;
    readonly achievementRuleVersion: number;
    readonly achievementAwardKey: string;
    readonly achievementOp: AchievementOp;
  };
  export type Tier = {
    readonly journalEffect: typeof JournalEffect.Tier;
    readonly tierOp: TierOp;
    readonly tierFrom: TierId;
    readonly tierTo: TierId;
    readonly tierUntil: LocalDate | null;
  };
  export type Reward = {
    readonly journalEffect: typeof JournalEffect.Reward;
    readonly rewardOp: RewardOp;
  } & RewardRefFields;
  export type Redemption = {
    readonly journalEffect: typeof JournalEffect.Redemption;
    readonly redemptionOp: RedemptionOp;
    readonly redemptionId: RedemptionId;
    readonly redeemedRewardId: RewardId;
    /** What the reward cost, in points. */
    readonly redemptionCost: number;
  } & GrantRefFields;
  export type Pause = {
    readonly journalEffect: typeof JournalEffect.Pause;
    readonly pauseOp: PauseOp;
    readonly pauseId: PauseId;
    readonly pauseTerm: PauseTerm;
    /** The last paused day, inclusive, of a `TEMPORARY` term; `null` for a `PERMANENT` one. */
    readonly pauseUntil: LocalDate | null;
    readonly pauseScope: PauseScope;
    /** Before → after on every pause row; the three `null` together on `APPLIED`. */
    readonly priorPauseTerm: PauseTerm | null;
    readonly priorPauseUntil: LocalDate | null;
    readonly priorPauseScope: PauseScope | null;
  };
  export type VisitOutcome = {
    readonly journalEffect: typeof JournalEffect.VisitOutcome;
    /** The visit is the entry's root `appointmentId`. */
    readonly outcomeSeatId: SeatId;
    readonly outcomeFrom: AttendanceState;
    readonly outcomeTo: AttendanceState;
    readonly outcomeRevision: number;
  };
}
