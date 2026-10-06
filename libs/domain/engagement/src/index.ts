export * from './lib/ids';
export * from './lib/ids.errors';

export * from './lib/voucher-code';
export * from './lib/voucher-code.errors';
export * from './lib/points';
export * from './lib/points.errors';
export * from './lib/coupon-value';
export * from './lib/coupon-value.errors';
export * from './lib/coupon-combinability';

export * from './lib/coupon';
export * from './lib/coupon.errors';
export * from './lib/coupon-grant';
export * from './lib/coupon-grant.errors';
export * from './lib/discount-application';
export * from './lib/discount-application.errors';
export * from './lib/gift-voucher';
export * from './lib/gift-voucher.errors';

export * from './lib/reward';
export * from './lib/milestone';
export * from './lib/milestone.errors';
export * from './lib/reward-program';
export * from './lib/reward-program.errors';
export * from './lib/reward-progress';
export * from './lib/reward-progress.errors';

export * from './lib/invitation';
export * from './lib/invitation.errors';
export * from './lib/invitation-redemption';

export * from './lib/achievement';
export * from './lib/achievement.errors';

// The loyalty read model (client-card-redesign §4): the catalogue as
// validated classes, one client's projections as flat values, and the pure
// standing services over both. The legacy `Achievement` above is untouched.
export * from './lib/loyalty/loyalty-calendar';
export * from './lib/loyalty/badge-vocabulary';
export * from './lib/loyalty/badge-category';
export * from './lib/loyalty/badge-category.errors';
export * from './lib/loyalty/badge-series';
export * from './lib/loyalty/badge-series.errors';
export * from './lib/loyalty/season';
export * from './lib/loyalty/season.errors';
export * from './lib/loyalty/catalog-entries';
// The rhythm as a managed rule (client-card-revision-3 §4.1): the rule, its
// two value objects, its errors, and the head that resolves it by date.
export * from './lib/loyalty/streak-interval';
export * from './lib/loyalty/streak-qualifier';
export * from './lib/loyalty/streak-definition';
export * from './lib/loyalty/streak-definition.errors';
export * from './lib/loyalty/streak-schedule';
export * from './lib/loyalty/loyalty-catalog';
export * from './lib/loyalty/loyalty-catalog.errors';
export * from './lib/loyalty/projections';
export * from './lib/loyalty/standing';

// The activity feed's three types (client-card-revision-3 §4.7, §7.3), by
// name: the contract W0 publishes. The star above carries them already; this
// line keeps them on the barrel whatever becomes of it.
export type {
  ActivityEffect,
  ActivityEntry,
  ActivityKind,
} from './lib/loyalty/projections';

// The rhythm's contract (client-card-revision-3 §4.1, §7.3), by name: what
// the application barrel hands on to the features. The stars above carry
// these already; this list keeps them on the barrel whatever becomes of
// the stars.
export {
  STREAK_EXCUSES,
  STREAK_LIMITS,
  StreakDefinition,
} from './lib/loyalty/streak-definition';
export type {
  StreakDefinitionProps,
  StreakExcuse,
  StreakRuleChange,
  StreakRuleDirection,
  StreakRuleSummary,
} from './lib/loyalty/streak-definition';
export { StreakDefinitionError } from './lib/loyalty/streak-definition.errors';
export type { StreakDefinitionField } from './lib/loyalty/streak-definition.errors';
export { StreakInterval } from './lib/loyalty/streak-interval';
export type { StreakIntervalProps } from './lib/loyalty/streak-interval';
export { StreakQualifier } from './lib/loyalty/streak-qualifier';
export type { StreakQualifierProps } from './lib/loyalty/streak-qualifier';
export { StreakDefinitionSchedule } from './lib/loyalty/streak-schedule';
export type { StreakTransition } from './lib/loyalty/streak-schedule';

// The projector (client-card-revision-3 §4.2): the pure fold from one
// client's facts and the rule in force to the rhythm's state. The star
// carries `projectStreak`, `traceStreak`, `StreakFacts`, `StreakTrace`, the
// five fact types and `STREAK_PERIODS_KEPT`; the two names of the contract
// (§7.3) are listed by name as well, as the rule's are above.
export * from './lib/loyalty/streak-projector';
export { projectStreak } from './lib/loyalty/streak-projector';
export type { StreakFacts } from './lib/loyalty/streak-projector';

// `StreakPeriodFact`, `CouponOccasion` and `CouponOccasionUnknownError`
// need no line: the stars of `projections`, `coupon` and `coupon.errors`
// carry them.
