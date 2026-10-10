/**
 * The names this lib re-exports from other modules, by name. Kept out of
 * `index.ts` and reached through its `export *`, so a bundle that uses none
 * of them never reaches their modules (esbuild follows a barrel's named
 * re-exports unconditionally, its star re-exports only when used).
 */
export {
  Coupon,
  CouponCombinability,
  CouponValue,
  DiscountApplication,
  GiftVoucher,
} from '@creativo/domain/engagement';
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
export {
  STREAK_EXCUSES,
  STREAK_LIMITS,
  STREAK_SHOP_EXCUSES,
  StreakDefinition,
  StreakDefinitionError,
  StreakDefinitionSchedule,
  projectStreak,
} from '@creativo/domain/engagement';
