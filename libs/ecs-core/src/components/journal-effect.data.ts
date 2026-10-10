import type { AppointmentId } from '../entities/appointment.entity';
import type { CouponGrantId } from '../entities/coupon-grant.entity';
import type { GiftVoucherId } from '../entities/gift-voucher.entity';
import type { RewardId } from '../entities/reward-catalog-item.entity';
import type { StreakDefinitionId } from '../entities/streak-definition.entity';
import type { TierId } from '../entities/tier-definition.entity';
import type { DayKey } from './day-key.data';
import type { PerkId } from './gamification.data';
import type { RuleRef } from './journal-source.data';
import type { Points as PointsAmount } from './points.data';
import type { SeatOutcomeKind } from './seat-outcome.data';

/**
 * What a journal entry changed, by kind — the stored `effect.kind` tags,
 * unchanged; index #21 orders on `effect.kind`. `points` is the ONLY
 * effect that moves the balance.
 */
export const JournalEffectKind = {
  Points: 'points',
  Streak: 'streak',
  Freeze: 'freeze',
  Achievement: 'achievement',
  Tier: 'tier',
  Reward: 'reward',
  Redemption: 'redemption',
  Pause: 'pause',
  VisitOutcome: 'visitOutcome',
} as const;
export type JournalEffectKind =
  (typeof JournalEffectKind)[keyof typeof JournalEffectKind];

/** What happened to a run. */
export const StreakEffectOp = {
  Extended: 'extended',
  Broken: 'broken',
  Repaired: 'repaired',
  ExtendedDue: 'extendedDue',
  Excused: 'excused',
  Reset: 'reset',
  Set: 'set',
  Recomputed: 'recomputed',
} as const;
export type StreakEffectOp =
  (typeof StreakEffectOp)[keyof typeof StreakEffectOp];

/** What happened to the protections a run banks. */
export const FreezeEffectOp = {
  Earned: 'earned',
  Granted: 'granted',
  Applied: 'applied',
} as const;
export type FreezeEffectOp =
  (typeof FreezeEffectOp)[keyof typeof FreezeEffectOp];

export const AchievementEffectOp = {
  Granted: 'granted',
  Revoked: 'revoked',
} as const;
export type AchievementEffectOp =
  (typeof AchievementEffectOp)[keyof typeof AchievementEffectOp];

export const TierEffectOp = {
  Changed: 'changed',
  Granted: 'granted',
  Overridden: 'overridden',
  OverrideCleared: 'overrideCleared',
} as const;
export type TierEffectOp = (typeof TierEffectOp)[keyof typeof TierEffectOp];

export const RewardEffectOp = {
  Granted: 'granted',
  Reinstated: 'reinstated',
  Revoked: 'revoked',
} as const;
export type RewardEffectOp =
  (typeof RewardEffectOp)[keyof typeof RewardEffectOp];

export const RedemptionEffectOp = {
  Redeemed: 'redeemed',
  Reversed: 'reversed',
  Expired: 'expired',
} as const;
export type RedemptionEffectOp =
  (typeof RedemptionEffectOp)[keyof typeof RedemptionEffectOp];

export const PauseEffectOp = {
  Applied: 'applied',
  Edited: 'edited',
  Lifted: 'lifted',
  Expired: 'expired',
} as const;
export type PauseEffectOp = (typeof PauseEffectOp)[keyof typeof PauseEffectOp];

/** A reward a client holds, by kind. */
export const RewardRefKind = {
  CouponGrant: 'couponGrant',
  GiftVoucher: 'giftVoucher',
  Perk: 'perk',
  Cosmetic: 'cosmetic',
} as const;
export type RewardRefKind = (typeof RewardRefKind)[keyof typeof RewardRefKind];

/** The cosmetics a reward can be — one today. */
export const CosmeticId = {
  FrameWelcome: 'frame.welcome',
} as const;
export type CosmeticId = (typeof CosmeticId)[keyof typeof CosmeticId];

/** How long a pause lasts, by kind. */
export const PauseTermKind = {
  Temporary: 'temporary',
  Permanent: 'permanent',
} as const;
export type PauseTermKind = (typeof PauseTermKind)[keyof typeof PauseTermKind];

/** What a pause stops: the client's own bookings, or every booking. */
export const PauseScope = {
  SelfService: 'selfService',
  AllBookings: 'allBookings',
} as const;
export type PauseScope = (typeof PauseScope)[keyof typeof PauseScope];

/** Who may read an entry: the ledger reads `client` rows only. */
export const JournalVisibility = {
  Client: 'client',
  Staff: 'staff',
} as const;
export type JournalVisibility =
  (typeof JournalVisibility)[keyof typeof JournalVisibility];

/**
 * The client-visible copy keys of a journal row — today the tuple
 * `PUBLIC_LABEL_CODES` (`loyalty-document.ts:153-180`); i18n resolves each
 * with the row's `params`. Stored strings unchanged.
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

/** A reward a client holds. */
export type RewardRef =
  | RewardRef.CouponGrant
  | RewardRef.GiftVoucher
  | RewardRef.Perk
  | RewardRef.Cosmetic;

export const RewardRef = {
  couponGrant(id: CouponGrantId): RewardRef.CouponGrant {
    return { kind: RewardRefKind.CouponGrant, id };
  },
  giftVoucher(id: GiftVoucherId): RewardRef.GiftVoucher {
    return { kind: RewardRefKind.GiftVoucher, id };
  },
  perk(perkId: PerkId): RewardRef.Perk {
    return { kind: RewardRefKind.Perk, perkId };
  },
  cosmetic(cosmeticId: CosmeticId): RewardRef.Cosmetic {
    return { kind: RewardRefKind.Cosmetic, cosmeticId };
  },
} as const;

/** How long a pause lasts: through a day (inclusive), or until lifted. */
export type PauseTerm = PauseTerm.Temporary | PauseTerm.Permanent;

export const PauseTerm = {
  /** Through `until`, inclusive. */
  temporary(until: DayKey): PauseTerm.Temporary {
    return { kind: PauseTermKind.Temporary, until };
  },
  /** Until somebody lifts it. */
  permanent(): PauseTerm.Permanent {
    return { kind: PauseTermKind.Permanent };
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

/** A row's client-visible copy: a key and its parameters. */
export type PublicLabel = {
  readonly code: LabelCode;
  readonly params: readonly LabelParam[];
};

export const PublicLabel = {
  of(code: LabelCode, params: readonly LabelParam[]): PublicLabel {
    return { code, params };
  },

  /** A parameter's value by name, or `null` — what i18n interpolation reads. */
  param(label: PublicLabel, name: string): string | number | null {
    for (let i = 0; i < label.params.length; i++) {
      const param = label.params[i] as LabelParam;
      if (param.name === name) return param.value;
    }
    return null;
  },
} as const;

/**
 * What a journal entry changed (`loyalty-document.ts:648-717`), the stored
 * union with its tags and keys unchanged; dates are shop-calendar day keys
 * (`dueBy`, a tier override's or a pause's `until`).
 */
export type JournalEffect =
  | JournalEffect.Points
  | JournalEffect.Streak
  | JournalEffect.Freeze
  | JournalEffect.Achievement
  | JournalEffect.Tier
  | JournalEffect.Reward
  | JournalEffect.Redemption
  | JournalEffect.Pause
  | JournalEffect.VisitOutcome;

export const JournalEffect = {
  points(delta: number): JournalEffect.Points {
    return { kind: JournalEffectKind.Points, delta };
  },

  /** Only a `points` effect moves the balance. */
  movesBalance(effect: JournalEffect): effect is JournalEffect.Points {
    return effect.kind === JournalEffectKind.Points;
  },

  /** What the effect adds to the balance: its signed `delta`, `0` for every other effect. */
  pointsDelta(effect: JournalEffect): number {
    return effect.kind === JournalEffectKind.Points ? effect.delta : 0;
  },
} as const;

export namespace RewardRef {
  export type CouponGrant = {
    readonly kind: typeof RewardRefKind.CouponGrant;
    readonly id: CouponGrantId;
  };
  export type GiftVoucher = {
    readonly kind: typeof RewardRefKind.GiftVoucher;
    readonly id: GiftVoucherId;
  };
  export type Perk = {
    readonly kind: typeof RewardRefKind.Perk;
    readonly perkId: PerkId;
  };
  export type Cosmetic = {
    readonly kind: typeof RewardRefKind.Cosmetic;
    readonly cosmeticId: CosmeticId;
  };
}

export namespace PauseTerm {
  export type Temporary = {
    readonly kind: typeof PauseTermKind.Temporary;
    readonly until: DayKey;
  };
  export type Permanent = { readonly kind: typeof PauseTermKind.Permanent };
}

export namespace JournalEffect {
  export type Points = {
    readonly kind: typeof JournalEffectKind.Points;
    /** Signed: a spend or a reversal is negative. */
    readonly delta: number;
  };
  export type Streak = {
    readonly kind: typeof JournalEffectKind.Streak;
    readonly streakId: StreakDefinitionId;
    readonly op: StreakEffectOp;
    readonly from: number;
    readonly to: number;
    readonly dueBy: DayKey | null;
  };
  export type Freeze = {
    readonly kind: typeof JournalEffectKind.Freeze;
    readonly streakId: StreakDefinitionId;
    readonly op: FreezeEffectOp;
    readonly count: number;
    readonly bankedAfter: number;
  };
  export type Achievement = {
    readonly kind: typeof JournalEffectKind.Achievement;
    readonly rule: RuleRef;
    readonly awardKey: string;
    readonly op: AchievementEffectOp;
  };
  export type Tier = {
    readonly kind: typeof JournalEffectKind.Tier;
    readonly op: TierEffectOp;
    readonly from: TierId;
    readonly to: TierId;
    readonly until: DayKey | null;
  };
  export type Reward = {
    readonly kind: typeof JournalEffectKind.Reward;
    readonly op: RewardEffectOp;
    readonly ref: RewardRef;
  };
  export type Redemption = {
    readonly kind: typeof JournalEffectKind.Redemption;
    readonly op: RedemptionEffectOp;
    readonly redemptionId: string;
    readonly rewardId: RewardId;
    /** What the reward cost, in points. */
    readonly cost: PointsAmount;
    readonly grant: RewardRef | null;
  };
  export type Pause = {
    readonly kind: typeof JournalEffectKind.Pause;
    readonly op: PauseEffectOp;
    readonly pauseId: string;
    readonly term: PauseTerm;
    readonly scope: PauseScope;
    /** Before → after on every pause row; `null` on `applied`. */
    readonly prior: {
      readonly term: PauseTerm;
      readonly scope: PauseScope;
    } | null;
  };
  export type VisitOutcome = {
    readonly kind: typeof JournalEffectKind.VisitOutcome;
    readonly appointmentId: AppointmentId;
    readonly seatId: string;
    readonly from: SeatOutcomeKind;
    readonly to: SeatOutcomeKind;
    readonly revision: number;
  };
}
