export * from './lib/ports/coupon-grant-repository.port';
export * from './lib/ports/coupon-reader.port';
export * from './lib/ports/gift-voucher-reader.port';
export * from './lib/ports/gift-voucher-document';
export * from './lib/ports/loyalty-document';
export * from './lib/ports/loyalty-reader.port';
export * from './lib/ports/loyalty-catalog-reader.port';
export * from './lib/ports/reward-progress-reader.port';
export * from './lib/ports/invitation.port';
export * from './lib/ports/streak-definition.port';
export * from './lib/ports/client-vouchers-reader.port';
export * from './lib/ports/loyalty-activity-reader.port';
export * from './lib/use-cases/apply-discounts.errors';
export * from './lib/use-cases/apply-discounts.use-case';
export * from './lib/use-cases/create-invitation.errors';
export * from './lib/use-cases/create-invitation.use-case';
export * from './lib/use-cases/redeem-invitation.errors';
export * from './lib/use-cases/redeem-invitation.use-case';
export * from './lib/use-cases/observe-streak-definition.use-case';
export * from './lib/use-cases/publish-streak-definition.use-case';
export * from './lib/use-cases/preview-streak-definition.use-case';

// The engagement DOMAIN, for the features that read a bill: the value a
// coupon carries and the evaluator that applies a set of them, the coupon
// and the voucher themselves. Features never import a domain lib directly
// (module boundaries); the application layer is where they reach it.
export {
  Coupon,
  CouponCombinability,
  CouponValue,
  DiscountApplication,
  GiftVoucher,
} from '@creativo/domain/engagement';
export type {
  DiscountBreakdown,
  DiscountInput,
  DiscountLine,
} from '@creativo/domain/engagement';

// The loyalty read model (client-card-redesign §4, §7.3), for the client
// card: the catalogue's classes, one client's projections and the pure
// standing services over both. By name, never `export *`, for the reason
// above: a feature sees exactly what it reads.
export {
  BadgeCategory,
  BadgeCategoryId,
  BadgeSeries,
  BadgeSeriesId,
  LoyaltyCatalog,
  Season,
  SeasonId,
  bestAffordable,
  closestLevels,
  earnedLevelCount,
  familiesIn,
  familyCounts,
  isNewSince,
  levelNumeral,
  nextAffordable,
  recentLevelsByDay,
  redeemProblem,
  sofiaDayOf,
  tierSteps,
} from '@creativo/domain/engagement';
export type {
  ActivityEffect,
  ActivityEntry,
  ActivityKind,
  AwardSummary,
  BadgeCategoryKind,
  BadgeEmblem,
  BadgeLevel,
  BadgeProgress,
  BadgeSubject,
  ClosestLevel,
  EarnedDay,
  EarnedLevel,
  FamilyScope,
  IsoDate,
  LedgerEntry,
  LoyaltyAccount,
  MedalState,
  Metric,
  MetricRef,
  PersonalRecord,
  PersonalRecordKind,
  PunchCard,
  RedeemProblem,
  RedemptionRecord,
  RewardCatalogItem,
  RewardGrant,
  SeasonPhase,
  SeasonProgress,
  SeriesStanding,
  StreakPhase,
  StreakState,
  TierDefinition,
  TierState,
} from '@creativo/domain/engagement';

// The rhythm as a managed rule (client-card-revision-3 §4.1, §4.2, §7.3):
// the rule and its head as the classes they are, the rule's vocabulary and
// its ranges, the projector, and the shapes a feature names when it words
// the rule, edits it or previews it. `StreakDefinition` is the CLASS,
// resolved by date from `LoyaltyCatalog.streakInForce`.
export {
  STREAK_EXCUSES,
  STREAK_LIMITS,
  STREAK_SHOP_EXCUSES,
  StreakDefinition,
  StreakDefinitionError,
  StreakDefinitionSchedule,
  projectStreak,
} from '@creativo/domain/engagement';
export type {
  CouponOccasion,
  StreakDefinitionField,
  StreakDefinitionProps,
  StreakExcuse,
  StreakFacts,
  StreakHold,
  StreakIntervalProps,
  StreakNoticePolicy,
  StreakPeriodFact,
  StreakPeriodTerms,
  StreakQualifierProps,
  StreakRuleChange,
  StreakRuleDirection,
  StreakRuleSummary,
  StreakTransition,
} from '@creativo/domain/engagement';
