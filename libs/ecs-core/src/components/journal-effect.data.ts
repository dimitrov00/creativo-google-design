import type {
  AchievementRuleId,
  CouponGrantId,
  GiftVoucherId,
  PauseId,
  RedemptionId,
  RewardId,
  SeatId,
  StreakDefinitionId,
  TierId,
  LocalDate,
  AttendanceState,
} from '@core/primitives';
import type { PerkId } from './gamification.data';

/**
 * What a journal entry changed — the entry's discriminator `journalEffect`.
 * `POINTS` is the ONLY effect that moves the balance. (Stored bytes are
 * today's lowercase `effect.kind` until the loyalty flip (3); the legacy
 * shims map.)
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

/**
 * A reward a client holds — the discriminator `rewardRef` of
 * {@link RewardRefFields} (and, as `grantRef`, of {@link GrantRefFields}).
 */
export const RewardRef = {
  CouponGrant: 'COUPON_GRANT',
  GiftVoucher: 'GIFT_VOUCHER',
  Perk: 'PERK',
  Cosmetic: 'COSMETIC',
} as const;
export type RewardRef = (typeof RewardRef)[keyof typeof RewardRef];

/** The cosmetics a reward can be — one today. Stable catalogue ids (flatten-spec §0.4). */
export const CosmeticId = {
  FrameWelcome: 'frame.welcome',
} as const;
export type CosmeticId = (typeof CosmeticId)[keyof typeof CosmeticId];

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

/** Who may read an entry — the entry's field `journalVisibility`; the ledger reads `CLIENT` rows only. */
export const JournalVisibility = {
  Client: 'CLIENT',
  Staff: 'STAFF',
} as const;
export type JournalVisibility =
  (typeof JournalVisibility)[keyof typeof JournalVisibility];

/**
 * The client-visible copy keys of a journal row — today the tuple
 * `PUBLIC_LABEL_CODES` (`loyalty-document.ts:153-180`); i18n resolves each
 * with the row's `labelParams`. i18n message keys, so the stored strings are
 * unchanged (flatten-spec §0.4).
 */
export const LabelCode = {
  PointsOpening: 'points.opening',
  PointsRule: 'points.rule',
  PointsGoodwill: 'points.goodwill',
  PointsServiceIssue: 'points.serviceIssue',
  PointsCorrection: 'points.correction',
  PointsAccountMerge: 'points.accountMerge',
  PointsRedeemed: 'points.redeemed',
  PointsRedemptionReversed: 'points.redemptionReversed',
  PointsExpired: 'points.expired',
  PointsDebtCleared: 'points.debtCleared',
  PointsReversed: 'points.reversed',
  AchievementEarned: 'achievement.earned',
  AchievementRevoked: 'achievement.revoked',
  StreakChanged: 'streak.changed',
  FreezeChanged: 'freeze.changed',
  TierChanged: 'tier.changed',
  RewardGranted: 'reward.granted',
  RewardReinstated: 'reward.reinstated',
  RewardRevoked: 'reward.revoked',
  RedemptionChanged: 'redemption.changed',
  PauseChanged: 'pause.changed',
  VisitOutcomeCorrected: 'visit.outcomeCorrected',
  PreviewStat: 'preview.stat',
  ChoiceAwardNoLongerMet: 'choice.awardNoLongerMet',
  ChoiceManualPause: 'choice.manualPause',
  ChoiceUpcomingBooking: 'choice.upcomingBooking',
} as const;
export type LabelCode = (typeof LabelCode)[keyof typeof LabelCode];

/** Every label code, dictionary order — derived, never a second source. */
export const LABEL_CODES: readonly LabelCode[] = Object.values(LabelCode);

/**
 * A reward a client holds, as flat fields beside the one discriminator
 * `rewardRef` — each variant declares only its own id (the REWARD effect,
 * the REWARD_GRANTED notification).
 */
export type RewardRefFields =
  | RewardRefFields.CouponGrant
  | RewardRefFields.GiftVoucher
  | RewardRefFields.Perk
  | RewardRefFields.Cosmetic;

export const RewardRefFields = {
  couponGrant(rewardCouponGrantId: CouponGrantId): RewardRefFields.CouponGrant {
    return { rewardRef: RewardRef.CouponGrant, rewardCouponGrantId };
  },
  giftVoucher(rewardGiftVoucherId: GiftVoucherId): RewardRefFields.GiftVoucher {
    return { rewardRef: RewardRef.GiftVoucher, rewardGiftVoucherId };
  },
  perk(rewardPerkId: PerkId): RewardRefFields.Perk {
    return { rewardRef: RewardRef.Perk, rewardPerkId };
  },
  cosmetic(rewardCosmeticId: CosmeticId): RewardRefFields.Cosmetic {
    return { rewardRef: RewardRef.Cosmetic, rewardCosmeticId };
  },
} as const;

/**
 * What a redemption minted — today's nullable `grant` ref as a variant
 * SLICE (F-26) on `grantRef` (`null` = nothing minted yet): every variant
 * narrows, never four independent nullable ids.
 */
export type GrantRefFields =
  | GrantRefFields.None
  | GrantRefFields.CouponGrant
  | GrantRefFields.GiftVoucher
  | GrantRefFields.Perk
  | GrantRefFields.Cosmetic;

export const GrantRefFields = {
  none(): GrantRefFields.None {
    return { grantRef: null };
  },
  couponGrant(grantCouponGrantId: CouponGrantId): GrantRefFields.CouponGrant {
    return { grantRef: RewardRef.CouponGrant, grantCouponGrantId };
  },
  giftVoucher(grantGiftVoucherId: GiftVoucherId): GrantRefFields.GiftVoucher {
    return { grantRef: RewardRef.GiftVoucher, grantGiftVoucherId };
  },
  perk(grantPerkId: PerkId): GrantRefFields.Perk {
    return { grantRef: RewardRef.Perk, grantPerkId };
  },
  cosmetic(grantCosmeticId: CosmeticId): GrantRefFields.Cosmetic {
    return { grantRef: RewardRef.Cosmetic, grantCosmeticId };
  },
} as const;

/**
 * One named i18n parameter of a row's label — non-personal, never a note
 * or a name. Declared change (§3.2): today's open `params` map
 * (`Record<string, string | number>`, a dynamic field path per key across
 * the collection) is an array of these.
 */
export type LabelParam = {
  readonly name: string;
  readonly value: string | number;
};

/**
 * A row's client-visible copy, flat at the entry's root (Law 6.1): a key
 * and its parameters (today's nested `publicLabel { code; params }`).
 */
export type PublicLabel = {
  readonly labelCode: LabelCode;
  readonly labelParams: readonly LabelParam[];
};

export const PublicLabel = {
  of(labelCode: LabelCode, labelParams: readonly LabelParam[]): PublicLabel {
    return { labelCode, labelParams };
  },

  /** A parameter's value by name, or `null` — what i18n interpolation reads. */
  param(
    label: Pick<PublicLabel, 'labelParams'>,
    name: string,
  ): string | number | null {
    for (let i = 0; i < label.labelParams.length; i++) {
      const param = label.labelParams[i] as LabelParam;
      if (param.name === name) return param.value;
    }
    return null;
  },
} as const;

/**
 * What a journal entry changed (`loyalty-document.ts:648-717`) — a union of
 * FLAT variant slices at the entry's root, discriminated by
 * `journalEffect`; every variant-only field carries its effect's prefix so
 * the slice never collides with the entry's other slices. Dates are
 * shop-calendar days (`streakDueBy`, `tierUntil`, `pauseUntil`).
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

  /** What the effect adds to the balance: its signed `pointsDelta`, `0` for every other effect. */
  pointsDelta(effect: JournalEffectRecord): number {
    return effect.journalEffect === JournalEffect.Points
      ? effect.pointsDelta
      : 0;
  },
} as const;

export namespace RewardRefFields {
  export type CouponGrant = {
    readonly rewardRef: typeof RewardRef.CouponGrant;
    readonly rewardCouponGrantId: CouponGrantId;
  };
  export type GiftVoucher = {
    readonly rewardRef: typeof RewardRef.GiftVoucher;
    readonly rewardGiftVoucherId: GiftVoucherId;
  };
  export type Perk = {
    readonly rewardRef: typeof RewardRef.Perk;
    readonly rewardPerkId: PerkId;
  };
  export type Cosmetic = {
    readonly rewardRef: typeof RewardRef.Cosmetic;
    readonly rewardCosmeticId: CosmeticId;
  };
}

export namespace GrantRefFields {
  export type None = { readonly grantRef: null };
  export type CouponGrant = {
    readonly grantRef: typeof RewardRef.CouponGrant;
    readonly grantCouponGrantId: CouponGrantId;
  };
  export type GiftVoucher = {
    readonly grantRef: typeof RewardRef.GiftVoucher;
    readonly grantGiftVoucherId: GiftVoucherId;
  };
  export type Perk = {
    readonly grantRef: typeof RewardRef.Perk;
    readonly grantPerkId: PerkId;
  };
  export type Cosmetic = {
    readonly grantRef: typeof RewardRef.Cosmetic;
    readonly grantCosmeticId: CosmeticId;
  };
}

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
