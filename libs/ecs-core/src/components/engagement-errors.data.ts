import type { AwardKind } from './gamification.data';
import type { GrantState } from './grant-status.data';
import { Locale } from './locale.data';
import type { VoucherRefusal } from './voucher-state.data';

/**
 * The engagement context's error codes — coupons, grants, gift vouchers,
 * points, invitations, the loyalty catalogue, the rhythm's rule,
 * notifications and the programs pages (blueprint §2.3). The legacy
 * `DomainError` subclasses of `libs/domain/engagement`, `libs/domain/
 * notifications` and `libs/domain/programs`, collapsed into ONE dictionary
 * under the `engagement.` namespace: the engagement codes keep their
 * strings; the notification and programs codes move under the namespace
 * (`notifications.notification.read_before_sent` →
 * `engagement.notification.read_before_sent`, `programs.course.*` →
 * `engagement.course.*`) — no i18n table holds any of them yet.
 *
 * Retired with their classes, never ported: the `Achievement`, `Milestone`,
 * `RewardProgram` and `RewardProgress` codes (§2.3: deleted),
 * `engagement.streak_schedule.id_mismatch` (engagement Q8: a constant id
 * cannot mismatch), and `notifications.notification.empty_title` (§9 D20:
 * a notification carries facts, not a title).
 *
 * Every non-`code` field is an i18n parameter, so each is an i18n-safe
 * scalar (`string | number | boolean | null`) — a list the legacy error
 * carried (`levels`, `targets`, `options`, `tierIds`) is joined into one
 * comma-separated string.
 */
/**
 * The field of the rhythm's rule an error names: a path into `StreakRule`
 * (and, for the head, into its name and its waiting version), spelled as
 * the admin page keys its controls (client-card revision 3 §2.6.2). A
 * closed set, so a page that words a refusal by its field cannot miss one.
 * The legacy `StreakDefinitionField` (`streak-definition.errors.ts:9-39`),
 * with `effectiveFrom` renamed `effectiveFromDayKey` as the stored field is.
 */
export const StreakRuleField = {
  Id: 'id',
  NameBg: 'name.bg',
  NameEn: 'name.en',
  Version: 'version',
  EffectiveFromDayKey: 'effectiveFromDayKey',
  QualifierKind: 'qualifier.kind',
  QualifierServiceIds: 'qualifier.serviceIds',
  QualifierCategoryIds: 'qualifier.categoryIds',
  MinGapDays: 'minGapDays',
  BookingHoldMaxDaysPastDue: 'bookingHold.maxDaysPastDue',
  IntervalKind: 'interval.kind',
  IntervalDays: 'interval.days',
  IntervalTolerancePct: 'interval.tolerancePct',
  IntervalMinDays: 'interval.minDays',
  IntervalMaxDays: 'interval.maxDays',
  IntervalFallbackDays: 'interval.fallbackDays',
  GraceDays: 'graceDays',
  RiskLeadDays: 'riskLeadDays',
  ProtectionsMaxBanked: 'protections.maxBanked',
  ProtectionsEarnEvery: 'protections.earnEvery',
  ProtectionsStartWith: 'protections.startWith',
  Excuses: 'excuses',
  ClientPauseMaxDaysPerYear: 'clientPause.maxDaysPerYear',
  RepairWindowDays: 'repair.windowDays',
  RepairPerYear: 'repair.perYear',
  OnBreak: 'onBreak',
  ScheduledVersion: 'scheduled.version',
  ScheduledEffectiveFromDayKey: 'scheduled.effectiveFromDayKey',
  ScheduledTransition: 'scheduled.transition',
} as const;
export type StreakRuleField =
  (typeof StreakRuleField)[keyof typeof StreakRuleField];

export const EngagementErrorCode = {
  /** A blank id at the edge (`idType` names which). */
  IdEmpty: 'engagement.id.empty',

  // ── Coupons ───────────────────────────────────────────────────────────
  CouponNameEmpty: 'engagement.coupon.empty_name',
  /** `CouponExpiry.days`: not a positive whole number of days. */
  CouponExpiryDaysInvalid: 'engagement.coupon.invalid_expiry_days',
  CouponUsageLimitInvalid: 'engagement.coupon.invalid_usage_limit',
  /** A stored occasion outside the `CouponOccasion` dictionary. */
  CouponOccasionUnknown: 'engagement.coupon.occasion_unknown',
  /** `percent_off` outside 0–100. */
  CouponValuePercentageInvalid: 'engagement.coupon_value.invalid_percentage',
  /** `fixed_amount` of zero or less — the legacy string is kept. */
  CouponValueAmountNotPositive: 'engagement.coupon_value.negative_amount',
  CouponGrantCapacityInvalid: 'engagement.coupon_grant.invalid_capacity',
  CouponGrantNotActive: 'engagement.coupon_grant.not_active',
  CouponGrantNotExpiring: 'engagement.coupon_grant.not_expiring',
  CouponGrantReasonEmpty: 'engagement.coupon_grant.empty_reason',
  /** A discount cap outside 0–100 percent. */
  DiscountCapInvalid: 'engagement.discount_application.invalid_cap',

  // ── Gift vouchers ─────────────────────────────────────────────────────
  VoucherCodeInvalid: 'engagement.voucher_code.invalid',
  GiftVoucherValueInvalid: 'engagement.gift_voucher.invalid_value',
  GiftVoucherNotRedeemable: 'engagement.gift_voucher.not_redeemable',
  GiftVoucherInsufficientBalance:
    'engagement.gift_voucher.insufficient_balance',
  GiftVoucherOverRestore: 'engagement.gift_voucher.over_restore',
  GiftVoucherCurrencyMismatch: 'engagement.gift_voucher.currency_mismatch',

  // ── Points ────────────────────────────────────────────────────────────
  PointsInvalid: 'engagement.points.invalid',
  /** A deduction larger than the balance — refused, never clamped. */
  PointsInsufficient: 'engagement.points.insufficient',

  // ── Invitations ───────────────────────────────────────────────────────
  InvitationInviterNameEmpty: 'engagement.invitation.empty_inviter_name',
  InvitationRedemptionCountInvalid:
    'engagement.invitation.invalid_redemption_count',
  InvitationSelfRedemption: 'engagement.invitation.self_redemption',

  // ── The loyalty catalogue ─────────────────────────────────────────────
  BadgeCategoryOrderNegative: 'engagement.badge_category.order_negative',
  BadgeSeriesNoLevels: 'engagement.badge_series.no_levels',
  BadgeSeriesLevelGap: 'engagement.badge_series.level_gap',
  BadgeSeriesTargetsNotRising: 'engagement.badge_series.targets_not_rising',
  BadgeSeriesHomeless: 'engagement.badge_series.homeless',
  BadgeSeriesOneOffWithSeveralLevels:
    'engagement.badge_series.one_off_with_several_levels',
  BadgeSeriesRepeatableWithSeveralLevels:
    'engagement.badge_series.repeatable_with_several_levels',
  BadgeSeriesLevelWithoutRule: 'engagement.badge_series.level_without_rule',
  BadgeSeriesAwardNotPositive: 'engagement.badge_series.award_not_positive',
  SeasonWindowMalformed: 'engagement.season.window_malformed',
  SeasonWindowInverted: 'engagement.season.window_inverted',
  SeasonEventWithTrack: 'engagement.season.event_with_track',
  SeasonWithoutTrack: 'engagement.season.without_track',
  SeasonAnnouncedLate: 'engagement.season.announced_late',
  LoyaltyCatalogDanglingCategory:
    'engagement.loyalty_catalog.dangling_category',
  LoyaltyCatalogDanglingSeason: 'engagement.loyalty_catalog.dangling_season',
  LoyaltyCatalogDuplicateId: 'engagement.loyalty_catalog.duplicate_id',
  LoyaltyCatalogTiersNotRising: 'engagement.loyalty_catalog.tiers_not_rising',
  LoyaltyCatalogCostNotPositive: 'engagement.loyalty_catalog.cost_not_positive',

  // ── The rhythm's rule (StreakRule) and its head ───────────────────────
  StreakIdEmpty: 'engagement.streak_definition.id_empty',
  StreakNameEmpty: 'engagement.streak_definition.name_empty',
  StreakVersionNotPositive: 'engagement.streak_definition.version_not_positive',
  StreakEffectiveDayInvalid:
    'engagement.streak_definition.effective_day_invalid',
  StreakUnknownOption: 'engagement.streak_definition.unknown_option',
  StreakQualifierEmpty: 'engagement.streak_definition.qualifier_empty',
  StreakMinGapOutOfRange: 'engagement.streak_definition.min_gap_out_of_range',
  StreakBookingHoldOutOfRange:
    'engagement.streak_definition.booking_hold_out_of_range',
  StreakIntervalOutOfRange:
    'engagement.streak_definition.interval_out_of_range',
  StreakToleranceOutOfRange:
    'engagement.streak_definition.tolerance_out_of_range',
  StreakClampInverted: 'engagement.streak_definition.clamp_inverted',
  StreakFallbackOutsideClamp:
    'engagement.streak_definition.fallback_outside_clamp',
  StreakGraceOutOfRange: 'engagement.streak_definition.grace_out_of_range',
  StreakGraceNotShorterThanInterval:
    'engagement.streak_definition.grace_not_shorter_than_interval',
  StreakRiskLeadOutOfRange:
    'engagement.streak_definition.risk_lead_out_of_range',
  StreakProtectionsOutOfRange:
    'engagement.streak_definition.protections_out_of_range',
  StreakStartWithAboveCap: 'engagement.streak_definition.start_with_above_cap',
  StreakUnknownExcuse: 'engagement.streak_definition.unknown_excuse',
  StreakClientPauseOutOfRange:
    'engagement.streak_definition.client_pause_out_of_range',
  StreakRepairOutOfRange: 'engagement.streak_definition.repair_out_of_range',
  /** The waiting version does not follow the one in force. */
  StreakScheduleVersionNotRising:
    'engagement.streak_schedule.version_not_rising',
  /** The waiting version does not take effect after the one in force did. */
  StreakScheduleNotAfterCurrent:
    'engagement.streak_schedule.scheduled_not_after_current',

  // ── Notifications ─────────────────────────────────────────────────────
  /** A receipt that predates its own message — surfaced, never rounded. */
  NotificationReadBeforeSent: 'engagement.notification.read_before_sent',

  // ── Programs (positions, courses, shop events) ────────────────────────
  PositionSortOrderInvalid: 'engagement.position.invalid_sort_order',
  PositionApplyUrlInvalid: 'engagement.position.invalid_apply_url',
  CourseSortOrderInvalid: 'engagement.course.invalid_sort_order',
  CourseApplyUrlInvalid: 'engagement.course.invalid_apply_url',
  ShopEventSortOrderInvalid: 'engagement.shop_event.invalid_sort_order',
  ShopEventApplyUrlInvalid: 'engagement.shop_event.invalid_apply_url',
} as const;
export type EngagementErrorCode =
  (typeof EngagementErrorCode)[keyof typeof EngagementErrorCode];

/** Every engagement code, dictionary order — derived, never a second source. */
export const ENGAGEMENT_ERROR_CODES: readonly EngagementErrorCode[] =
  Object.values(EngagementErrorCode);

export type EngagementError =
  | EngagementError.IdEmpty
  | EngagementError.CouponNameEmpty
  | EngagementError.CouponExpiryDaysInvalid
  | EngagementError.CouponUsageLimitInvalid
  | EngagementError.CouponOccasionUnknown
  | EngagementError.CouponValuePercentageInvalid
  | EngagementError.CouponValueAmountNotPositive
  | EngagementError.CouponGrantCapacityInvalid
  | EngagementError.CouponGrantNotActive
  | EngagementError.CouponGrantNotExpiring
  | EngagementError.CouponGrantReasonEmpty
  | EngagementError.DiscountCapInvalid
  | EngagementError.VoucherCodeInvalid
  | EngagementError.GiftVoucherValueInvalid
  | EngagementError.GiftVoucherNotRedeemable
  | EngagementError.GiftVoucherInsufficientBalance
  | EngagementError.GiftVoucherOverRestore
  | EngagementError.GiftVoucherCurrencyMismatch
  | EngagementError.PointsInvalid
  | EngagementError.PointsInsufficient
  | EngagementError.InvitationInviterNameEmpty
  | EngagementError.InvitationRedemptionCountInvalid
  | EngagementError.InvitationSelfRedemption
  | EngagementError.BadgeCategoryOrderNegative
  | EngagementError.BadgeSeriesNoLevels
  | EngagementError.BadgeSeriesLevelGap
  | EngagementError.BadgeSeriesTargetsNotRising
  | EngagementError.BadgeSeriesHomeless
  | EngagementError.BadgeSeriesOneOffWithSeveralLevels
  | EngagementError.BadgeSeriesRepeatableWithSeveralLevels
  | EngagementError.BadgeSeriesLevelWithoutRule
  | EngagementError.BadgeSeriesAwardNotPositive
  | EngagementError.SeasonWindowMalformed
  | EngagementError.SeasonWindowInverted
  | EngagementError.SeasonEventWithTrack
  | EngagementError.SeasonWithoutTrack
  | EngagementError.SeasonAnnouncedLate
  | EngagementError.LoyaltyCatalogDanglingCategory
  | EngagementError.LoyaltyCatalogDanglingSeason
  | EngagementError.LoyaltyCatalogDuplicateId
  | EngagementError.LoyaltyCatalogTiersNotRising
  | EngagementError.LoyaltyCatalogCostNotPositive
  | EngagementError.StreakRuleError
  | EngagementError.StreakScheduleVersionNotRising
  | EngagementError.StreakScheduleNotAfterCurrent
  | EngagementError.NotificationReadBeforeSent
  | EngagementError.ProgramError;

/**
 * An i18n-safe parameter: a missing value is `null`, a list is joined with
 * `', '`, anything else (an object) is flattened to a string.
 */
function scalarOf(value: unknown): EngagementError.Scalar {
  if (value === null || value === undefined) return null;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) return listOf(value);
  return String(value);
}

/** A list as one i18n parameter: `'1, 2, 4'`. */
function listOf(values: readonly unknown[]): string {
  let out = '';
  for (let i = 0; i < values.length; i++) {
    out += (i === 0 ? '' : ', ') + String(values[i]);
  }
  return out;
}

export const EngagementError = {
  idEmpty(idType: string): EngagementError.IdEmpty {
    return { code: EngagementErrorCode.IdEmpty, idType };
  },

  // ── Coupons ───────────────────────────────────────────────────────────
  couponNameEmpty(): EngagementError.CouponNameEmpty {
    return { code: EngagementErrorCode.CouponNameEmpty };
  },
  couponExpiryDaysInvalid(
    attempted: number,
  ): EngagementError.CouponExpiryDaysInvalid {
    return { code: EngagementErrorCode.CouponExpiryDaysInvalid, attempted };
  },
  couponUsageLimitInvalid(
    attempted: number,
  ): EngagementError.CouponUsageLimitInvalid {
    return { code: EngagementErrorCode.CouponUsageLimitInvalid, attempted };
  },
  couponOccasionUnknown(
    attempted: unknown,
  ): EngagementError.CouponOccasionUnknown {
    return {
      code: EngagementErrorCode.CouponOccasionUnknown,
      attempted: scalarOf(attempted),
    };
  },
  couponValuePercentageInvalid(
    attempted: number,
  ): EngagementError.CouponValuePercentageInvalid {
    return {
      code: EngagementErrorCode.CouponValuePercentageInvalid,
      attempted,
    };
  },
  couponValueAmountNotPositive(
    attemptedMinorUnits: number,
  ): EngagementError.CouponValueAmountNotPositive {
    return {
      code: EngagementErrorCode.CouponValueAmountNotPositive,
      attemptedMinorUnits,
    };
  },
  couponGrantCapacityInvalid(
    attempted: number,
  ): EngagementError.CouponGrantCapacityInvalid {
    return { code: EngagementErrorCode.CouponGrantCapacityInvalid, attempted };
  },
  couponGrantNotActive(
    currentState: GrantState,
  ): EngagementError.CouponGrantNotActive {
    return { code: EngagementErrorCode.CouponGrantNotActive, currentState };
  },
  couponGrantNotExpiring(): EngagementError.CouponGrantNotExpiring {
    return { code: EngagementErrorCode.CouponGrantNotExpiring };
  },
  couponGrantReasonEmpty(): EngagementError.CouponGrantReasonEmpty {
    return { code: EngagementErrorCode.CouponGrantReasonEmpty };
  },
  discountCapInvalid(attempted: number): EngagementError.DiscountCapInvalid {
    return { code: EngagementErrorCode.DiscountCapInvalid, attempted };
  },

  // ── Gift vouchers ─────────────────────────────────────────────────────
  voucherCodeInvalid(attempted: string): EngagementError.VoucherCodeInvalid {
    return { code: EngagementErrorCode.VoucherCodeInvalid, attempted };
  },
  giftVoucherValueInvalid(): EngagementError.GiftVoucherValueInvalid {
    return { code: EngagementErrorCode.GiftVoucherValueInvalid };
  },
  giftVoucherNotRedeemable(
    reason: VoucherRefusal,
  ): EngagementError.GiftVoucherNotRedeemable {
    return { code: EngagementErrorCode.GiftVoucherNotRedeemable, reason };
  },
  giftVoucherInsufficientBalance(
    requestedMinorUnits: number,
    balanceMinorUnits: number,
  ): EngagementError.GiftVoucherInsufficientBalance {
    return {
      code: EngagementErrorCode.GiftVoucherInsufficientBalance,
      requestedMinorUnits,
      balanceMinorUnits,
    };
  },
  giftVoucherOverRestore(): EngagementError.GiftVoucherOverRestore {
    return { code: EngagementErrorCode.GiftVoucherOverRestore };
  },
  giftVoucherCurrencyMismatch(
    expected: string,
    found: string,
  ): EngagementError.GiftVoucherCurrencyMismatch {
    return {
      code: EngagementErrorCode.GiftVoucherCurrencyMismatch,
      expected,
      found,
    };
  },

  // ── Points ────────────────────────────────────────────────────────────
  pointsInvalid(attempted: number): EngagementError.PointsInvalid {
    return { code: EngagementErrorCode.PointsInvalid, attempted };
  },
  pointsInsufficient(
    requested: number,
    balance: number,
  ): EngagementError.PointsInsufficient {
    return { code: EngagementErrorCode.PointsInsufficient, requested, balance };
  },

  // ── Invitations ───────────────────────────────────────────────────────
  invitationInviterNameEmpty(): EngagementError.InvitationInviterNameEmpty {
    return { code: EngagementErrorCode.InvitationInviterNameEmpty };
  },
  invitationRedemptionCountInvalid(
    attempted: number,
  ): EngagementError.InvitationRedemptionCountInvalid {
    return {
      code: EngagementErrorCode.InvitationRedemptionCountInvalid,
      attempted,
    };
  },
  invitationSelfRedemption(): EngagementError.InvitationSelfRedemption {
    return { code: EngagementErrorCode.InvitationSelfRedemption };
  },

  // ── The loyalty catalogue ─────────────────────────────────────────────
  badgeCategoryOrderNegative(
    rawValue: number,
  ): EngagementError.BadgeCategoryOrderNegative {
    return { code: EngagementErrorCode.BadgeCategoryOrderNegative, rawValue };
  },
  badgeSeriesNoLevels(): EngagementError.BadgeSeriesNoLevels {
    return { code: EngagementErrorCode.BadgeSeriesNoLevels };
  },
  badgeSeriesLevelGap(
    levels: readonly number[],
  ): EngagementError.BadgeSeriesLevelGap {
    return {
      code: EngagementErrorCode.BadgeSeriesLevelGap,
      levels: listOf(levels),
    };
  },
  badgeSeriesTargetsNotRising(
    targets: readonly number[],
  ): EngagementError.BadgeSeriesTargetsNotRising {
    return {
      code: EngagementErrorCode.BadgeSeriesTargetsNotRising,
      targets: listOf(targets),
    };
  },
  badgeSeriesHomeless(): EngagementError.BadgeSeriesHomeless {
    return { code: EngagementErrorCode.BadgeSeriesHomeless };
  },
  badgeSeriesOneOffWithSeveralLevels(): EngagementError.BadgeSeriesOneOffWithSeveralLevels {
    return { code: EngagementErrorCode.BadgeSeriesOneOffWithSeveralLevels };
  },
  badgeSeriesRepeatableWithSeveralLevels(): EngagementError.BadgeSeriesRepeatableWithSeveralLevels {
    return { code: EngagementErrorCode.BadgeSeriesRepeatableWithSeveralLevels };
  },
  badgeSeriesLevelWithoutRule(
    level: number,
  ): EngagementError.BadgeSeriesLevelWithoutRule {
    return { code: EngagementErrorCode.BadgeSeriesLevelWithoutRule, level };
  },
  badgeSeriesAwardNotPositive(
    level: number,
    kind: AwardKind,
  ): EngagementError.BadgeSeriesAwardNotPositive {
    return {
      code: EngagementErrorCode.BadgeSeriesAwardNotPositive,
      level,
      kind,
    };
  },
  seasonWindowMalformed(
    from: string,
    until: string,
  ): EngagementError.SeasonWindowMalformed {
    return { code: EngagementErrorCode.SeasonWindowMalformed, from, until };
  },
  seasonWindowInverted(
    from: string,
    until: string,
  ): EngagementError.SeasonWindowInverted {
    return { code: EngagementErrorCode.SeasonWindowInverted, from, until };
  },
  seasonEventWithTrack(): EngagementError.SeasonEventWithTrack {
    return { code: EngagementErrorCode.SeasonEventWithTrack };
  },
  seasonWithoutTrack(): EngagementError.SeasonWithoutTrack {
    return { code: EngagementErrorCode.SeasonWithoutTrack };
  },
  seasonAnnouncedLate(
    announcedOn: string,
    from: string,
    noticeDays: number,
  ): EngagementError.SeasonAnnouncedLate {
    return {
      code: EngagementErrorCode.SeasonAnnouncedLate,
      announcedOn,
      from,
      noticeDays,
    };
  },
  loyaltyCatalogDanglingCategory(
    seriesId: string,
    categoryId: string,
  ): EngagementError.LoyaltyCatalogDanglingCategory {
    return {
      code: EngagementErrorCode.LoyaltyCatalogDanglingCategory,
      seriesId,
      categoryId,
    };
  },
  loyaltyCatalogDanglingSeason(
    seasonId: string,
    seriesId: string,
  ): EngagementError.LoyaltyCatalogDanglingSeason {
    return {
      code: EngagementErrorCode.LoyaltyCatalogDanglingSeason,
      seasonId,
      seriesId,
    };
  },
  loyaltyCatalogDuplicateId(
    collection: string,
    id: string,
  ): EngagementError.LoyaltyCatalogDuplicateId {
    return {
      code: EngagementErrorCode.LoyaltyCatalogDuplicateId,
      collection,
      id,
    };
  },
  loyaltyCatalogTiersNotRising(
    tierIds: readonly string[],
  ): EngagementError.LoyaltyCatalogTiersNotRising {
    return {
      code: EngagementErrorCode.LoyaltyCatalogTiersNotRising,
      tierIds: listOf(tierIds),
    };
  },
  loyaltyCatalogCostNotPositive(
    rewardId: string,
    cost: number,
  ): EngagementError.LoyaltyCatalogCostNotPositive {
    return {
      code: EngagementErrorCode.LoyaltyCatalogCostNotPositive,
      rewardId,
      cost,
    };
  },

  // ── The rhythm's rule ─────────────────────────────────────────────────
  /** A rule fault with no bounds: the field at fault and the value handed in. */
  streakRule(
    code: EngagementError.StreakBareCode,
    field: StreakRuleField,
    value: unknown,
  ): EngagementError.StreakBare {
    return { code, field, value: scalarOf(value) };
  },
  /** A figure outside its inclusive range `min`–`max`. */
  streakRuleRange(
    code: EngagementError.StreakRangeCode,
    field: StreakRuleField,
    value: unknown,
    min: number,
    max: number,
  ): EngagementError.StreakRange {
    return { code, field, value: scalarOf(value), min, max };
  },
  streakNameEmpty(
    locale: Locale,
    value: unknown,
  ): EngagementError.StreakNameEmpty {
    return {
      code: EngagementErrorCode.StreakNameEmpty,
      field:
        locale === Locale.Bg ? StreakRuleField.NameBg : StreakRuleField.NameEn,
      value: scalarOf(value),
      locale,
    };
  },
  streakUnknownOption(
    field: StreakRuleField,
    value: unknown,
    options: readonly string[],
  ): EngagementError.StreakUnknownOption {
    return {
      code: EngagementErrorCode.StreakUnknownOption,
      field,
      value: scalarOf(value),
      options: listOf(options),
    };
  },
  /** The personal interval's floor sits above its ceiling. */
  streakClampInverted(
    minDays: number,
    maxDays: number,
  ): EngagementError.StreakClampInverted {
    return {
      code: EngagementErrorCode.StreakClampInverted,
      field: StreakRuleField.IntervalMinDays,
      value: minDays,
      minDays,
      maxDays,
    };
  },
  /** A new client's interval sits outside the personal one's bounds. */
  streakFallbackOutsideClamp(
    value: number,
    minDays: number,
    maxDays: number,
  ): EngagementError.StreakFallbackOutsideClamp {
    return {
      code: EngagementErrorCode.StreakFallbackOutsideClamp,
      field: StreakRuleField.IntervalFallbackDays,
      value,
      minDays,
      maxDays,
    };
  },
  /** A grace as long as the interval is a second interval, not a grace. */
  streakGraceNotShorterThanInterval(
    value: number,
    shortestIntervalDays: number,
  ): EngagementError.StreakGraceNotShorterThanInterval {
    return {
      code: EngagementErrorCode.StreakGraceNotShorterThanInterval,
      field: StreakRuleField.GraceDays,
      value,
      shortestIntervalDays,
    };
  },
  /** Nobody starts with more protections than the reserve holds. */
  streakStartWithAboveCap(
    value: number,
    maxBanked: number,
  ): EngagementError.StreakStartWithAboveCap {
    return {
      code: EngagementErrorCode.StreakStartWithAboveCap,
      field: StreakRuleField.ProtectionsStartWith,
      value,
      maxBanked,
    };
  },
  streakScheduleVersionNotRising(
    currentVersion: number,
    scheduledVersion: number,
  ): EngagementError.StreakScheduleVersionNotRising {
    return {
      code: EngagementErrorCode.StreakScheduleVersionNotRising,
      field: StreakRuleField.ScheduledVersion,
      value: scheduledVersion,
      currentVersion,
    };
  },
  streakScheduleNotAfterCurrent(
    currentEffectiveFromDayKey: string,
    scheduledEffectiveFromDayKey: string,
  ): EngagementError.StreakScheduleNotAfterCurrent {
    return {
      code: EngagementErrorCode.StreakScheduleNotAfterCurrent,
      field: StreakRuleField.ScheduledEffectiveFromDayKey,
      value: scheduledEffectiveFromDayKey,
      currentEffectiveFromDayKey,
    };
  },

  // ── Notifications ─────────────────────────────────────────────────────
  notificationReadBeforeSent(
    sentAtMs: number,
    readAtMs: number,
  ): EngagementError.NotificationReadBeforeSent {
    return {
      code: EngagementErrorCode.NotificationReadBeforeSent,
      sentAtMs,
      readAtMs,
    };
  },

  // ── Programs ──────────────────────────────────────────────────────────
  /** A sort order that is not a non-negative integer, or an apply URL that does not parse. */
  program(
    code: EngagementError.ProgramCode,
    rawValue: unknown,
  ): EngagementError.ProgramError {
    return { code, rawValue: scalarOf(rawValue) };
  },

  /** Narrows an error to one code — `EngagementError.is(e, EngagementErrorCode.PointsInsufficient)`. */
  is<C extends EngagementErrorCode>(
    error: EngagementError,
    code: C,
  ): error is Extract<EngagementError, { readonly code: C }> {
    return error.code === code;
  },
} as const;

export namespace EngagementError {
  /** An i18n-safe parameter value. */
  export type Scalar = string | number | boolean | null;

  type Bare<C extends EngagementErrorCode> = { readonly code: C };

  export type IdEmpty = {
    readonly code: typeof EngagementErrorCode.IdEmpty;
    /** Which id was blank — `'CouponId'`, `'InvitationId'`, … */
    readonly idType: string;
  };

  export type CouponNameEmpty = Bare<
    typeof EngagementErrorCode.CouponNameEmpty
  >;
  export type CouponExpiryDaysInvalid = {
    readonly code: typeof EngagementErrorCode.CouponExpiryDaysInvalid;
    readonly attempted: number;
  };
  export type CouponUsageLimitInvalid = {
    readonly code: typeof EngagementErrorCode.CouponUsageLimitInvalid;
    readonly attempted: number;
  };
  export type CouponOccasionUnknown = {
    readonly code: typeof EngagementErrorCode.CouponOccasionUnknown;
    readonly attempted: Scalar;
  };
  export type CouponValuePercentageInvalid = {
    readonly code: typeof EngagementErrorCode.CouponValuePercentageInvalid;
    readonly attempted: number;
  };
  export type CouponValueAmountNotPositive = {
    readonly code: typeof EngagementErrorCode.CouponValueAmountNotPositive;
    readonly attemptedMinorUnits: number;
  };
  export type CouponGrantCapacityInvalid = {
    readonly code: typeof EngagementErrorCode.CouponGrantCapacityInvalid;
    readonly attempted: number;
  };
  export type CouponGrantNotActive = {
    readonly code: typeof EngagementErrorCode.CouponGrantNotActive;
    readonly currentState: GrantState;
  };
  export type CouponGrantNotExpiring = Bare<
    typeof EngagementErrorCode.CouponGrantNotExpiring
  >;
  export type CouponGrantReasonEmpty = Bare<
    typeof EngagementErrorCode.CouponGrantReasonEmpty
  >;
  export type DiscountCapInvalid = {
    readonly code: typeof EngagementErrorCode.DiscountCapInvalid;
    readonly attempted: number;
  };

  export type VoucherCodeInvalid = {
    readonly code: typeof EngagementErrorCode.VoucherCodeInvalid;
    readonly attempted: string;
  };
  export type GiftVoucherValueInvalid = Bare<
    typeof EngagementErrorCode.GiftVoucherValueInvalid
  >;
  export type GiftVoucherNotRedeemable = {
    readonly code: typeof EngagementErrorCode.GiftVoucherNotRedeemable;
    readonly reason: VoucherRefusal;
  };
  export type GiftVoucherInsufficientBalance = {
    readonly code: typeof EngagementErrorCode.GiftVoucherInsufficientBalance;
    readonly requestedMinorUnits: number;
    readonly balanceMinorUnits: number;
  };
  export type GiftVoucherOverRestore = Bare<
    typeof EngagementErrorCode.GiftVoucherOverRestore
  >;
  export type GiftVoucherCurrencyMismatch = {
    readonly code: typeof EngagementErrorCode.GiftVoucherCurrencyMismatch;
    readonly expected: string;
    readonly found: string;
  };

  export type PointsInvalid = {
    readonly code: typeof EngagementErrorCode.PointsInvalid;
    readonly attempted: number;
  };
  export type PointsInsufficient = {
    readonly code: typeof EngagementErrorCode.PointsInsufficient;
    readonly requested: number;
    /** The most that may be taken («може да се отнемат до 280 т.»). */
    readonly balance: number;
  };

  export type InvitationInviterNameEmpty = Bare<
    typeof EngagementErrorCode.InvitationInviterNameEmpty
  >;
  export type InvitationRedemptionCountInvalid = {
    readonly code: typeof EngagementErrorCode.InvitationRedemptionCountInvalid;
    readonly attempted: number;
  };
  export type InvitationSelfRedemption = Bare<
    typeof EngagementErrorCode.InvitationSelfRedemption
  >;

  export type BadgeCategoryOrderNegative = {
    readonly code: typeof EngagementErrorCode.BadgeCategoryOrderNegative;
    readonly rawValue: number;
  };
  export type BadgeSeriesNoLevels = Bare<
    typeof EngagementErrorCode.BadgeSeriesNoLevels
  >;
  export type BadgeSeriesLevelGap = {
    readonly code: typeof EngagementErrorCode.BadgeSeriesLevelGap;
    /** The levels as written, comma-separated. */
    readonly levels: string;
  };
  export type BadgeSeriesTargetsNotRising = {
    readonly code: typeof EngagementErrorCode.BadgeSeriesTargetsNotRising;
    /** The targets as written, comma-separated. */
    readonly targets: string;
  };
  export type BadgeSeriesHomeless = Bare<
    typeof EngagementErrorCode.BadgeSeriesHomeless
  >;
  export type BadgeSeriesOneOffWithSeveralLevels = Bare<
    typeof EngagementErrorCode.BadgeSeriesOneOffWithSeveralLevels
  >;
  export type BadgeSeriesRepeatableWithSeveralLevels = Bare<
    typeof EngagementErrorCode.BadgeSeriesRepeatableWithSeveralLevels
  >;
  export type BadgeSeriesLevelWithoutRule = {
    readonly code: typeof EngagementErrorCode.BadgeSeriesLevelWithoutRule;
    readonly level: number;
  };
  export type BadgeSeriesAwardNotPositive = {
    readonly code: typeof EngagementErrorCode.BadgeSeriesAwardNotPositive;
    readonly level: number;
    readonly kind: AwardKind;
  };
  export type SeasonWindowMalformed = {
    readonly code: typeof EngagementErrorCode.SeasonWindowMalformed;
    readonly from: string;
    readonly until: string;
  };
  export type SeasonWindowInverted = {
    readonly code: typeof EngagementErrorCode.SeasonWindowInverted;
    readonly from: string;
    readonly until: string;
  };
  export type SeasonEventWithTrack = Bare<
    typeof EngagementErrorCode.SeasonEventWithTrack
  >;
  export type SeasonWithoutTrack = Bare<
    typeof EngagementErrorCode.SeasonWithoutTrack
  >;
  export type SeasonAnnouncedLate = {
    readonly code: typeof EngagementErrorCode.SeasonAnnouncedLate;
    readonly announcedOn: string;
    readonly from: string;
    readonly noticeDays: number;
  };
  export type LoyaltyCatalogDanglingCategory = {
    readonly code: typeof EngagementErrorCode.LoyaltyCatalogDanglingCategory;
    readonly seriesId: string;
    readonly categoryId: string;
  };
  export type LoyaltyCatalogDanglingSeason = {
    readonly code: typeof EngagementErrorCode.LoyaltyCatalogDanglingSeason;
    readonly seasonId: string;
    readonly seriesId: string;
  };
  export type LoyaltyCatalogDuplicateId = {
    readonly code: typeof EngagementErrorCode.LoyaltyCatalogDuplicateId;
    readonly collection: string;
    readonly id: string;
  };
  export type LoyaltyCatalogTiersNotRising = {
    readonly code: typeof EngagementErrorCode.LoyaltyCatalogTiersNotRising;
    /** The tier ids in rank order, comma-separated. */
    readonly tierIds: string;
  };
  export type LoyaltyCatalogCostNotPositive = {
    readonly code: typeof EngagementErrorCode.LoyaltyCatalogCostNotPositive;
    readonly rewardId: string;
    readonly cost: number;
  };

  /** The rule faults that carry only the field and the value. */
  export type StreakBareCode =
    | typeof EngagementErrorCode.StreakIdEmpty
    | typeof EngagementErrorCode.StreakVersionNotPositive
    | typeof EngagementErrorCode.StreakEffectiveDayInvalid
    | typeof EngagementErrorCode.StreakQualifierEmpty
    | typeof EngagementErrorCode.StreakUnknownExcuse;
  /** The rule faults of a figure outside its inclusive range. */
  export type StreakRangeCode =
    | typeof EngagementErrorCode.StreakMinGapOutOfRange
    | typeof EngagementErrorCode.StreakBookingHoldOutOfRange
    | typeof EngagementErrorCode.StreakIntervalOutOfRange
    | typeof EngagementErrorCode.StreakToleranceOutOfRange
    | typeof EngagementErrorCode.StreakGraceOutOfRange
    | typeof EngagementErrorCode.StreakRiskLeadOutOfRange
    | typeof EngagementErrorCode.StreakProtectionsOutOfRange
    | typeof EngagementErrorCode.StreakClientPauseOutOfRange
    | typeof EngagementErrorCode.StreakRepairOutOfRange;

  /** Every rule fault names the field at fault and the value handed in — all a page needs to name the control. */
  export type StreakBare = {
    readonly code: StreakBareCode;
    readonly field: StreakRuleField;
    readonly value: Scalar;
  };
  export type StreakRange = {
    readonly code: StreakRangeCode;
    readonly field: StreakRuleField;
    readonly value: Scalar;
    readonly min: number;
    readonly max: number;
  };
  export type StreakNameEmpty = {
    readonly code: typeof EngagementErrorCode.StreakNameEmpty;
    readonly field: StreakRuleField;
    readonly value: Scalar;
    readonly locale: Locale;
  };
  export type StreakUnknownOption = {
    readonly code: typeof EngagementErrorCode.StreakUnknownOption;
    readonly field: StreakRuleField;
    readonly value: Scalar;
    /** The closed set, comma-separated. */
    readonly options: string;
  };
  export type StreakClampInverted = {
    readonly code: typeof EngagementErrorCode.StreakClampInverted;
    readonly field: StreakRuleField;
    readonly value: number;
    readonly minDays: number;
    readonly maxDays: number;
  };
  export type StreakFallbackOutsideClamp = {
    readonly code: typeof EngagementErrorCode.StreakFallbackOutsideClamp;
    readonly field: StreakRuleField;
    readonly value: number;
    readonly minDays: number;
    readonly maxDays: number;
  };
  export type StreakGraceNotShorterThanInterval = {
    readonly code: typeof EngagementErrorCode.StreakGraceNotShorterThanInterval;
    readonly field: StreakRuleField;
    readonly value: number;
    readonly shortestIntervalDays: number;
  };
  export type StreakStartWithAboveCap = {
    readonly code: typeof EngagementErrorCode.StreakStartWithAboveCap;
    readonly field: StreakRuleField;
    readonly value: number;
    readonly maxBanked: number;
  };
  /** Any fault `StreakRule.parse` (and its interval and qualifier) can report. */
  export type StreakRuleError =
    | StreakBare
    | StreakRange
    | StreakNameEmpty
    | StreakUnknownOption
    | StreakClampInverted
    | StreakFallbackOutsideClamp
    | StreakGraceNotShorterThanInterval
    | StreakStartWithAboveCap;
  export type StreakScheduleVersionNotRising = {
    readonly code: typeof EngagementErrorCode.StreakScheduleVersionNotRising;
    readonly field: StreakRuleField;
    readonly value: number;
    readonly currentVersion: number;
  };
  export type StreakScheduleNotAfterCurrent = {
    readonly code: typeof EngagementErrorCode.StreakScheduleNotAfterCurrent;
    readonly field: StreakRuleField;
    readonly value: string;
    readonly currentEffectiveFromDayKey: string;
  };

  export type NotificationReadBeforeSent = {
    readonly code: typeof EngagementErrorCode.NotificationReadBeforeSent;
    readonly sentAtMs: number;
    readonly readAtMs: number;
  };

  export type ProgramCode =
    | typeof EngagementErrorCode.PositionSortOrderInvalid
    | typeof EngagementErrorCode.PositionApplyUrlInvalid
    | typeof EngagementErrorCode.CourseSortOrderInvalid
    | typeof EngagementErrorCode.CourseApplyUrlInvalid
    | typeof EngagementErrorCode.ShopEventSortOrderInvalid
    | typeof EngagementErrorCode.ShopEventApplyUrlInvalid;
  export type ProgramError = {
    readonly code: ProgramCode;
    readonly rawValue: Scalar;
  };
}
