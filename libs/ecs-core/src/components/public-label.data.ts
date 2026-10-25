import type { LabelParam } from './label-param.data';

/**
 * The client-visible copy keys of a journal row (the row's `labelCode`);
 * i18n resolves each with the row's `labelParams`. i18n message keys, so
 * the stored strings stay dotted lower camel case (flatten-spec §0.4).
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

/**
 * A row's client-visible copy, flat at the entry's root (Law 6.1): a key
 * and its parameters — two root fields, never a nested label object.
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
