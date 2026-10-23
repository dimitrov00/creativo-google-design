import type { CatalogError } from './catalog-errors.data';
import type { Currency } from './currency.primitive';
import type {
  BadgeCategoryId,
  BadgeSeriesId,
  CourseId,
  EventId,
  InvitationId,
  LocationId,
  PositionId,
  RewardId,
  SeasonId,
  TierId,
} from './ids.primitive';
import type { LocalDate } from './local-date.primitive';
import type { PriceCents } from './price-cents.primitive';
import type { PrimitiveError } from './primitive-errors.data';
import type { RepositoryError } from './repository-errors.data';
import type { TimeError } from './time-errors.data';
import type { UtcEpochMs } from './utc-epoch-ms.primitive';
import type { AwardKind } from './award-kind.data';
import type { GrantStatus } from './grant-status.data';
import { Locale } from './locale.data';
import type { VoucherRefusal } from './voucher-refusal.data';

/**
 * The engagement context's error codes — coupons, grants, gift vouchers,
 * points, invitations, the loyalty catalogue, the rhythm's rule,
 * notifications and the programs pages (blueprint §2.3). The legacy
 * `DomainError` subclasses of the engagement and notifications domain
 * libraries (deleted in Phase 4b), and the programs classes (deleted by
 * flip 4), collapsed into ONE dictionary of flat `{ errorCode, … }` structs
 * (Law 7.5): SCREAMING_SNAKE codes under the `ENGAGEMENT_` prefix
 * (flatten-spec §4.2), the UI's lookup key `errors.<errorCode>` (the
 * catalogues hold copy only for the codes a surface words) and the code the
 * edge sends on the wire (Phase 4a 4A-4).
 *
 * `RepositoryFailure` is the admin rhythm page's own failure word (Phase 4b,
 * 4B-4): no system or pipeline raises it, so it stays outside the
 * {@link EngagementError} union and its edge row is inert.
 *
 * Retired with their classes, never ported: the `Achievement`, `Milestone`,
 * `RewardProgram` and `RewardProgress` codes (§2.3: deleted),
 * `engagement.streak_schedule.id_mismatch` (engagement Q8: a constant id
 * cannot mismatch), and `notifications.notification.empty_title` (§9 D20:
 * a notification carries facts, not a title).
 *
 * Every non-`errorCode` field is an i18n parameter, so each is an i18n-safe
 * scalar (`string | number | boolean | null`) — a list the legacy error
 * carried (`levels`, `targets`, `options`, `tierIds`) is joined into one
 * comma-separated string.
 */
/**
 * The field of the rhythm's rule an error names: the FLAT field of
 * `StreakRule` at fault (and, for the head, its name's two locales and the
 * waiting version's three identity fields, prefixed `scheduled`), spelled
 * as the admin page keys its controls (client-card revision 3 §2.6.2). A
 * closed set, so a page that words a refusal by its field cannot miss one.
 * Field locators on the wire, not codes (flatten-spec §3.5): the publish
 * callable answers with these flat names since the loyalty flip (3), which
 * retired the legacy dotted paths of `StreakDefinitionField`
 * (`'interval.days'`, `'scheduled.version'`).
 */
export const StreakRuleField = {
  Id: 'id',
  NameBg: 'nameBg',
  NameEn: 'nameEn',
  Version: 'version',
  EffectiveFromLocalDate: 'effectiveFromLocalDate',
  QualifierKind: 'streakQualifier',
  QualifierServiceIds: 'qualifierServiceIds',
  QualifierCategoryIds: 'qualifierCategoryIds',
  MinGapDays: 'minGapDays',
  BookingHoldMaxDaysPastDue: 'bookingHoldMaxDaysPastDue',
  IntervalKind: 'streakInterval',
  IntervalDays: 'intervalDays',
  IntervalTolerancePct: 'intervalTolerancePct',
  IntervalMinDays: 'intervalMinDays',
  IntervalMaxDays: 'intervalMaxDays',
  IntervalFallbackDays: 'intervalFallbackDays',
  GraceDays: 'graceDays',
  RiskLeadDays: 'riskLeadDays',
  ProtectionsMaxBanked: 'protectionsMaxBanked',
  ProtectionsEarnEvery: 'protectionsEarnEvery',
  ProtectionsStartWith: 'protectionsStartWith',
  Excuses: 'excuses',
  ClientPauseMaxDaysPerYear: 'clientPauseMaxDaysPerYear',
  RepairWindowDays: 'repairWindowDays',
  RepairPerYear: 'repairPerYear',
  OnBreak: 'onBreak',
  ScheduledVersion: 'scheduledVersion',
  ScheduledEffectiveFromLocalDate: 'scheduledEffectiveFromLocalDate',
  ScheduledTransition: 'scheduledStreakTransition',
} as const;
export type StreakRuleField =
  (typeof StreakRuleField)[keyof typeof StreakRuleField];

export const EngagementErrorCode = {
  /** A blank id at the edge (`idType` names which). */
  IdEmpty: 'ENGAGEMENT_ID_EMPTY',

  // ── Coupons ───────────────────────────────────────────────────────────
  CouponNameEmpty: 'ENGAGEMENT_COUPON_EMPTY_NAME',
  /** `CouponExpiry.days`: not a positive whole number of days. */
  CouponExpiryDaysInvalid: 'ENGAGEMENT_COUPON_INVALID_EXPIRY_DAYS',
  CouponUsageLimitInvalid: 'ENGAGEMENT_COUPON_INVALID_USAGE_LIMIT',
  /** A stored occasion outside the `CouponOccasion` dictionary. */
  CouponOccasionUnknown: 'ENGAGEMENT_COUPON_OCCASION_UNKNOWN',
  /** `percent_off` outside 0–100. */
  CouponValuePercentageInvalid: 'ENGAGEMENT_COUPON_VALUE_INVALID_PERCENTAGE',
  /** `fixed_amount` of zero or less — the legacy string is kept. */
  CouponValueAmountNotPositive: 'ENGAGEMENT_COUPON_VALUE_NEGATIVE_AMOUNT',
  CouponGrantCapacityInvalid: 'ENGAGEMENT_COUPON_GRANT_INVALID_CAPACITY',
  CouponGrantNotActive: 'ENGAGEMENT_COUPON_GRANT_NOT_ACTIVE',
  CouponGrantNotExpiring: 'ENGAGEMENT_COUPON_GRANT_NOT_EXPIRING',
  CouponGrantReasonEmpty: 'ENGAGEMENT_COUPON_GRANT_EMPTY_REASON',
  /** A discount cap outside 0–100 percent. */
  DiscountCapInvalid: 'ENGAGEMENT_DISCOUNT_APPLICATION_INVALID_CAP',

  // ── Gift vouchers ─────────────────────────────────────────────────────
  VoucherCodeInvalid: 'ENGAGEMENT_VOUCHER_CODE_INVALID',
  GiftVoucherValueInvalid: 'ENGAGEMENT_GIFT_VOUCHER_INVALID_VALUE',
  GiftVoucherNotRedeemable: 'ENGAGEMENT_GIFT_VOUCHER_NOT_REDEEMABLE',
  GiftVoucherInsufficientBalance:
    'ENGAGEMENT_GIFT_VOUCHER_INSUFFICIENT_BALANCE',
  GiftVoucherOverRestore: 'ENGAGEMENT_GIFT_VOUCHER_OVER_RESTORE',
  GiftVoucherCurrencyMismatch: 'ENGAGEMENT_GIFT_VOUCHER_CURRENCY_MISMATCH',

  // ── Points ────────────────────────────────────────────────────────────
  PointsInvalid: 'ENGAGEMENT_POINTS_INVALID',
  /** A deduction larger than the balance — refused, never clamped. */
  PointsInsufficient: 'ENGAGEMENT_POINTS_INSUFFICIENT',

  // ── Invitations ───────────────────────────────────────────────────────
  InvitationInviterNameEmpty: 'ENGAGEMENT_INVITATION_EMPTY_INVITER_NAME',
  InvitationRedemptionCountInvalid:
    'ENGAGEMENT_INVITATION_INVALID_REDEMPTION_COUNT',
  InvitationSelfRedemption: 'ENGAGEMENT_INVITATION_SELF_REDEMPTION',
  /** `redeemInvitation`: no `invitations/{id}` (Phase 4a, F3-2). */
  InvitationNotFound: 'ENGAGEMENT_INVITATION_NOT_FOUND',
  /** `redeemInvitation`: the caller's redemption exists — existence alone prevents a second one. */
  InvitationAlreadyRedeemed: 'ENGAGEMENT_INVITATION_ALREADY_REDEEMED',
  /** `redeemInvitation` called without a signed-in session. */
  InvitationUnauthenticated: 'ENGAGEMENT_INVITATION_UNAUTHENTICATED',

  // ── The loyalty catalogue ─────────────────────────────────────────────
  BadgeCategoryOrderNegative: 'ENGAGEMENT_BADGE_CATEGORY_ORDER_NEGATIVE',
  BadgeSeriesNoLevels: 'ENGAGEMENT_BADGE_SERIES_NO_LEVELS',
  BadgeSeriesLevelGap: 'ENGAGEMENT_BADGE_SERIES_LEVEL_GAP',
  BadgeSeriesTargetsNotRising: 'ENGAGEMENT_BADGE_SERIES_TARGETS_NOT_RISING',
  BadgeSeriesHomeless: 'ENGAGEMENT_BADGE_SERIES_HOMELESS',
  BadgeSeriesOneOffWithSeveralLevels:
    'ENGAGEMENT_BADGE_SERIES_ONE_OFF_WITH_SEVERAL_LEVELS',
  BadgeSeriesRepeatableWithSeveralLevels:
    'ENGAGEMENT_BADGE_SERIES_REPEATABLE_WITH_SEVERAL_LEVELS',
  BadgeSeriesLevelWithoutRule: 'ENGAGEMENT_BADGE_SERIES_LEVEL_WITHOUT_RULE',
  BadgeSeriesAwardNotPositive: 'ENGAGEMENT_BADGE_SERIES_AWARD_NOT_POSITIVE',
  SeasonWindowMalformed: 'ENGAGEMENT_SEASON_WINDOW_MALFORMED',
  SeasonWindowInverted: 'ENGAGEMENT_SEASON_WINDOW_INVERTED',
  SeasonEventWithTrack: 'ENGAGEMENT_SEASON_EVENT_WITH_TRACK',
  SeasonWithoutTrack: 'ENGAGEMENT_SEASON_WITHOUT_TRACK',
  SeasonAnnouncedLate: 'ENGAGEMENT_SEASON_ANNOUNCED_LATE',
  LoyaltyCatalogDanglingCategory:
    'ENGAGEMENT_LOYALTY_CATALOG_DANGLING_CATEGORY',
  LoyaltyCatalogDanglingSeason: 'ENGAGEMENT_LOYALTY_CATALOG_DANGLING_SEASON',
  LoyaltyCatalogDuplicateId: 'ENGAGEMENT_LOYALTY_CATALOG_DUPLICATE_ID',
  LoyaltyCatalogTiersNotRising: 'ENGAGEMENT_LOYALTY_CATALOG_TIERS_NOT_RISING',
  LoyaltyCatalogCostNotPositive: 'ENGAGEMENT_LOYALTY_CATALOG_COST_NOT_POSITIVE',

  // ── The rhythm's rule (StreakRule) and its head ───────────────────────
  StreakIdEmpty: 'ENGAGEMENT_STREAK_DEFINITION_ID_EMPTY',
  StreakNameEmpty: 'ENGAGEMENT_STREAK_DEFINITION_NAME_EMPTY',
  StreakVersionNotPositive: 'ENGAGEMENT_STREAK_DEFINITION_VERSION_NOT_POSITIVE',
  StreakEffectiveDayInvalid:
    'ENGAGEMENT_STREAK_DEFINITION_EFFECTIVE_DAY_INVALID',
  StreakUnknownOption: 'ENGAGEMENT_STREAK_DEFINITION_UNKNOWN_OPTION',
  StreakQualifierEmpty: 'ENGAGEMENT_STREAK_DEFINITION_QUALIFIER_EMPTY',
  StreakMinGapOutOfRange: 'ENGAGEMENT_STREAK_DEFINITION_MIN_GAP_OUT_OF_RANGE',
  StreakBookingHoldOutOfRange:
    'ENGAGEMENT_STREAK_DEFINITION_BOOKING_HOLD_OUT_OF_RANGE',
  StreakIntervalOutOfRange:
    'ENGAGEMENT_STREAK_DEFINITION_INTERVAL_OUT_OF_RANGE',
  StreakToleranceOutOfRange:
    'ENGAGEMENT_STREAK_DEFINITION_TOLERANCE_OUT_OF_RANGE',
  StreakClampInverted: 'ENGAGEMENT_STREAK_DEFINITION_CLAMP_INVERTED',
  StreakFallbackOutsideClamp:
    'ENGAGEMENT_STREAK_DEFINITION_FALLBACK_OUTSIDE_CLAMP',
  StreakGraceOutOfRange: 'ENGAGEMENT_STREAK_DEFINITION_GRACE_OUT_OF_RANGE',
  StreakGraceNotShorterThanInterval:
    'ENGAGEMENT_STREAK_DEFINITION_GRACE_NOT_SHORTER_THAN_INTERVAL',
  StreakRiskLeadOutOfRange:
    'ENGAGEMENT_STREAK_DEFINITION_RISK_LEAD_OUT_OF_RANGE',
  StreakProtectionsOutOfRange:
    'ENGAGEMENT_STREAK_DEFINITION_PROTECTIONS_OUT_OF_RANGE',
  StreakStartWithAboveCap: 'ENGAGEMENT_STREAK_DEFINITION_START_WITH_ABOVE_CAP',
  StreakUnknownExcuse: 'ENGAGEMENT_STREAK_DEFINITION_UNKNOWN_EXCUSE',
  StreakClientPauseOutOfRange:
    'ENGAGEMENT_STREAK_DEFINITION_CLIENT_PAUSE_OUT_OF_RANGE',
  StreakRepairOutOfRange: 'ENGAGEMENT_STREAK_DEFINITION_REPAIR_OUT_OF_RANGE',
  /** The waiting version does not follow the one in force. */
  StreakScheduleVersionNotRising:
    'ENGAGEMENT_STREAK_SCHEDULE_VERSION_NOT_RISING',
  /** The waiting version does not take effect after the one in force did. */
  StreakScheduleNotAfterCurrent:
    'ENGAGEMENT_STREAK_SCHEDULE_SCHEDULED_NOT_AFTER_CURRENT',
  /**
   * The admin rhythm page's publish or undo failed for any reason but a
   * refusal of the rule — the page's toast and refusal fallback word it
   * (`admin-rhythm.ts`); no pipeline raises it (succeeds a retired dotted
   * i18n key — `docs/architecture/flips/phase-4b-delete.md` §2 row 7).
   */
  RepositoryFailure: 'ENGAGEMENT_REPOSITORY_FAILURE',

  // ── Notifications ─────────────────────────────────────────────────────
  /** A receipt that predates its own message — surfaced, never rounded. */
  NotificationReadBeforeSent: 'ENGAGEMENT_NOTIFICATION_READ_BEFORE_SENT',

  // ── Programs (positions, courses, shop events) ────────────────────────
  PositionSortOrderInvalid: 'ENGAGEMENT_POSITION_INVALID_SORT_ORDER',
  PositionApplyUrlInvalid: 'ENGAGEMENT_POSITION_INVALID_APPLY_URL',
  CourseSortOrderInvalid: 'ENGAGEMENT_COURSE_INVALID_SORT_ORDER',
  CourseApplyUrlInvalid: 'ENGAGEMENT_COURSE_INVALID_APPLY_URL',
  ShopEventSortOrderInvalid: 'ENGAGEMENT_SHOP_EVENT_INVALID_SORT_ORDER',
  ShopEventApplyUrlInvalid: 'ENGAGEMENT_SHOP_EVENT_INVALID_APPLY_URL',
  /** An admin update of a role that is no longer stored — nothing is written. */
  PositionNotFound: 'ENGAGEMENT_POSITION_NOT_FOUND',
  /** An admin update of a course that is no longer stored — nothing is written. */
  CourseNotFound: 'ENGAGEMENT_COURSE_NOT_FOUND',
  /** An admin update of an event that is no longer stored — nothing is written. */
  ShopEventNotFound: 'ENGAGEMENT_SHOP_EVENT_NOT_FOUND',
  /**
   * No shop's zone can place the event's wall clock: neither its own
   * location nor the deployment's default shop is stored (F-4).
   */
  ShopEventZoneUnknown: 'ENGAGEMENT_SHOP_EVENT_ZONE_UNKNOWN',
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
  | EngagementError.InvitationNotFound
  | EngagementError.InvitationAlreadyRedeemed
  | EngagementError.InvitationUnauthenticated
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
  | EngagementError.ProgramError
  | EngagementError.ProgramNotFound
  | EngagementError.ShopEventZoneUnknown;

/**
 * Any refusal of a programs field the admin typed (`ProgramsSystem`): a sort
 * order or apply URL, a blank locale, a location id, the start's form or date.
 */
export type ProgramFieldError =
  EngagementError.ProgramError | CatalogError | PrimitiveError | TimeError;

/**
 * Any refusal of an admin programs save (`program-content.pipeline.ts`): the
 * field refusals, an update of a document that is gone, an event no shop's
 * zone can place, or a failed read or write.
 */
export type ProgramSaveError =
  | ProgramFieldError
  | EngagementError.ProgramNotFound
  | EngagementError.ShopEventZoneUnknown
  | RepositoryError;

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
    return { errorCode: EngagementErrorCode.IdEmpty, idType };
  },

  // ── Coupons ───────────────────────────────────────────────────────────
  couponNameEmpty(): EngagementError.CouponNameEmpty {
    return { errorCode: EngagementErrorCode.CouponNameEmpty };
  },
  couponExpiryDaysInvalid(
    attempted: number,
  ): EngagementError.CouponExpiryDaysInvalid {
    return {
      errorCode: EngagementErrorCode.CouponExpiryDaysInvalid,
      attempted,
    };
  },
  couponUsageLimitInvalid(
    attempted: number,
  ): EngagementError.CouponUsageLimitInvalid {
    return {
      errorCode: EngagementErrorCode.CouponUsageLimitInvalid,
      attempted,
    };
  },
  couponOccasionUnknown(
    attempted: unknown,
  ): EngagementError.CouponOccasionUnknown {
    return {
      errorCode: EngagementErrorCode.CouponOccasionUnknown,
      attempted: scalarOf(attempted),
    };
  },
  couponValuePercentageInvalid(
    attempted: number,
  ): EngagementError.CouponValuePercentageInvalid {
    return {
      errorCode: EngagementErrorCode.CouponValuePercentageInvalid,
      attempted,
    };
  },
  couponValueAmountNotPositive(
    attemptedCents: PriceCents,
  ): EngagementError.CouponValueAmountNotPositive {
    return {
      errorCode: EngagementErrorCode.CouponValueAmountNotPositive,
      attemptedCents,
    };
  },
  couponGrantCapacityInvalid(
    attempted: number,
  ): EngagementError.CouponGrantCapacityInvalid {
    return {
      errorCode: EngagementErrorCode.CouponGrantCapacityInvalid,
      attempted,
    };
  },
  couponGrantNotActive(
    currentState: GrantStatus,
  ): EngagementError.CouponGrantNotActive {
    return {
      errorCode: EngagementErrorCode.CouponGrantNotActive,
      currentState,
    };
  },
  couponGrantNotExpiring(): EngagementError.CouponGrantNotExpiring {
    return { errorCode: EngagementErrorCode.CouponGrantNotExpiring };
  },
  couponGrantReasonEmpty(): EngagementError.CouponGrantReasonEmpty {
    return { errorCode: EngagementErrorCode.CouponGrantReasonEmpty };
  },
  discountCapInvalid(attempted: number): EngagementError.DiscountCapInvalid {
    return { errorCode: EngagementErrorCode.DiscountCapInvalid, attempted };
  },

  // ── Gift vouchers ─────────────────────────────────────────────────────
  voucherCodeInvalid(attempted: string): EngagementError.VoucherCodeInvalid {
    return { errorCode: EngagementErrorCode.VoucherCodeInvalid, attempted };
  },
  giftVoucherValueInvalid(): EngagementError.GiftVoucherValueInvalid {
    return { errorCode: EngagementErrorCode.GiftVoucherValueInvalid };
  },
  giftVoucherNotRedeemable(
    reason: VoucherRefusal,
  ): EngagementError.GiftVoucherNotRedeemable {
    return { errorCode: EngagementErrorCode.GiftVoucherNotRedeemable, reason };
  },
  giftVoucherInsufficientBalance(
    requestedCents: PriceCents,
    balanceCents: PriceCents,
  ): EngagementError.GiftVoucherInsufficientBalance {
    return {
      errorCode: EngagementErrorCode.GiftVoucherInsufficientBalance,
      requestedCents,
      balanceCents,
    };
  },
  giftVoucherOverRestore(): EngagementError.GiftVoucherOverRestore {
    return { errorCode: EngagementErrorCode.GiftVoucherOverRestore };
  },
  giftVoucherCurrencyMismatch(
    expected: Currency,
    found: Currency,
  ): EngagementError.GiftVoucherCurrencyMismatch {
    return {
      errorCode: EngagementErrorCode.GiftVoucherCurrencyMismatch,
      expected,
      found,
    };
  },

  // ── Points ────────────────────────────────────────────────────────────
  pointsInvalid(attempted: number): EngagementError.PointsInvalid {
    return { errorCode: EngagementErrorCode.PointsInvalid, attempted };
  },
  pointsInsufficient(
    requested: number,
    balance: number,
  ): EngagementError.PointsInsufficient {
    return {
      errorCode: EngagementErrorCode.PointsInsufficient,
      requested,
      balance,
    };
  },

  // ── Invitations ───────────────────────────────────────────────────────
  invitationInviterNameEmpty(): EngagementError.InvitationInviterNameEmpty {
    return { errorCode: EngagementErrorCode.InvitationInviterNameEmpty };
  },
  invitationRedemptionCountInvalid(
    attempted: number,
  ): EngagementError.InvitationRedemptionCountInvalid {
    return {
      errorCode: EngagementErrorCode.InvitationRedemptionCountInvalid,
      attempted,
    };
  },
  invitationSelfRedemption(): EngagementError.InvitationSelfRedemption {
    return { errorCode: EngagementErrorCode.InvitationSelfRedemption };
  },
  invitationNotFound(
    invitationId: InvitationId,
  ): EngagementError.InvitationNotFound {
    return { errorCode: EngagementErrorCode.InvitationNotFound, invitationId };
  },
  invitationAlreadyRedeemed(
    invitationId: InvitationId,
  ): EngagementError.InvitationAlreadyRedeemed {
    return {
      errorCode: EngagementErrorCode.InvitationAlreadyRedeemed,
      invitationId,
    };
  },
  invitationUnauthenticated(): EngagementError.InvitationUnauthenticated {
    return { errorCode: EngagementErrorCode.InvitationUnauthenticated };
  },

  // ── The loyalty catalogue ─────────────────────────────────────────────
  badgeCategoryOrderNegative(
    rawValue: number,
  ): EngagementError.BadgeCategoryOrderNegative {
    return {
      errorCode: EngagementErrorCode.BadgeCategoryOrderNegative,
      rawValue,
    };
  },
  badgeSeriesNoLevels(): EngagementError.BadgeSeriesNoLevels {
    return { errorCode: EngagementErrorCode.BadgeSeriesNoLevels };
  },
  badgeSeriesLevelGap(
    levels: readonly number[],
  ): EngagementError.BadgeSeriesLevelGap {
    return {
      errorCode: EngagementErrorCode.BadgeSeriesLevelGap,
      levels: listOf(levels),
    };
  },
  badgeSeriesTargetsNotRising(
    targets: readonly number[],
  ): EngagementError.BadgeSeriesTargetsNotRising {
    return {
      errorCode: EngagementErrorCode.BadgeSeriesTargetsNotRising,
      targets: listOf(targets),
    };
  },
  badgeSeriesHomeless(): EngagementError.BadgeSeriesHomeless {
    return { errorCode: EngagementErrorCode.BadgeSeriesHomeless };
  },
  badgeSeriesOneOffWithSeveralLevels(): EngagementError.BadgeSeriesOneOffWithSeveralLevels {
    return {
      errorCode: EngagementErrorCode.BadgeSeriesOneOffWithSeveralLevels,
    };
  },
  badgeSeriesRepeatableWithSeveralLevels(): EngagementError.BadgeSeriesRepeatableWithSeveralLevels {
    return {
      errorCode: EngagementErrorCode.BadgeSeriesRepeatableWithSeveralLevels,
    };
  },
  badgeSeriesLevelWithoutRule(
    level: number,
  ): EngagementError.BadgeSeriesLevelWithoutRule {
    return {
      errorCode: EngagementErrorCode.BadgeSeriesLevelWithoutRule,
      level,
    };
  },
  badgeSeriesAwardNotPositive(
    level: number,
    awardKind: AwardKind,
  ): EngagementError.BadgeSeriesAwardNotPositive {
    return {
      errorCode: EngagementErrorCode.BadgeSeriesAwardNotPositive,
      level,
      awardKind,
    };
  },
  seasonWindowMalformed(
    from: string,
    until: string,
  ): EngagementError.SeasonWindowMalformed {
    return {
      errorCode: EngagementErrorCode.SeasonWindowMalformed,
      from,
      until,
    };
  },
  seasonWindowInverted(
    from: LocalDate,
    until: LocalDate,
  ): EngagementError.SeasonWindowInverted {
    return { errorCode: EngagementErrorCode.SeasonWindowInverted, from, until };
  },
  seasonEventWithTrack(): EngagementError.SeasonEventWithTrack {
    return { errorCode: EngagementErrorCode.SeasonEventWithTrack };
  },
  seasonWithoutTrack(): EngagementError.SeasonWithoutTrack {
    return { errorCode: EngagementErrorCode.SeasonWithoutTrack };
  },
  seasonAnnouncedLate(
    announcedOn: LocalDate,
    from: LocalDate,
    noticeDays: number,
  ): EngagementError.SeasonAnnouncedLate {
    return {
      errorCode: EngagementErrorCode.SeasonAnnouncedLate,
      announcedOn,
      from,
      noticeDays,
    };
  },
  loyaltyCatalogDanglingCategory(
    seriesId: BadgeSeriesId,
    categoryId: BadgeCategoryId,
  ): EngagementError.LoyaltyCatalogDanglingCategory {
    return {
      errorCode: EngagementErrorCode.LoyaltyCatalogDanglingCategory,
      seriesId,
      categoryId,
    };
  },
  loyaltyCatalogDanglingSeason(
    seasonId: SeasonId,
    seriesId: BadgeSeriesId,
  ): EngagementError.LoyaltyCatalogDanglingSeason {
    return {
      errorCode: EngagementErrorCode.LoyaltyCatalogDanglingSeason,
      seasonId,
      seriesId,
    };
  },
  loyaltyCatalogDuplicateId(
    collection: string,
    id: string,
  ): EngagementError.LoyaltyCatalogDuplicateId {
    return {
      errorCode: EngagementErrorCode.LoyaltyCatalogDuplicateId,
      collection,
      id,
    };
  },
  loyaltyCatalogTiersNotRising(
    tierIds: readonly TierId[],
  ): EngagementError.LoyaltyCatalogTiersNotRising {
    return {
      errorCode: EngagementErrorCode.LoyaltyCatalogTiersNotRising,
      tierIds: [...tierIds],
    };
  },
  loyaltyCatalogCostNotPositive(
    rewardId: RewardId,
    cost: number,
  ): EngagementError.LoyaltyCatalogCostNotPositive {
    return {
      errorCode: EngagementErrorCode.LoyaltyCatalogCostNotPositive,
      rewardId,
      cost,
    };
  },

  // ── The rhythm's rule ─────────────────────────────────────────────────
  /** A rule fault with no bounds: the field at fault and the value handed in. */
  streakRule(
    errorCode: EngagementError.StreakBareCode,
    field: StreakRuleField,
    value: unknown,
  ): EngagementError.StreakBare {
    return { errorCode, field, value: scalarOf(value) };
  },
  /** A figure outside its inclusive range `min`–`max`. */
  streakRuleRange(
    errorCode: EngagementError.StreakRangeCode,
    field: StreakRuleField,
    value: unknown,
    min: number,
    max: number,
  ): EngagementError.StreakRange {
    return { errorCode, field, value: scalarOf(value), min, max };
  },
  streakNameEmpty(
    locale: Locale,
    value: unknown,
  ): EngagementError.StreakNameEmpty {
    return {
      errorCode: EngagementErrorCode.StreakNameEmpty,
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
      errorCode: EngagementErrorCode.StreakUnknownOption,
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
      errorCode: EngagementErrorCode.StreakClampInverted,
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
      errorCode: EngagementErrorCode.StreakFallbackOutsideClamp,
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
      errorCode: EngagementErrorCode.StreakGraceNotShorterThanInterval,
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
      errorCode: EngagementErrorCode.StreakStartWithAboveCap,
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
      errorCode: EngagementErrorCode.StreakScheduleVersionNotRising,
      field: StreakRuleField.ScheduledVersion,
      value: scheduledVersion,
      currentVersion,
    };
  },
  streakScheduleNotAfterCurrent(
    currentEffectiveFromLocalDate: LocalDate,
    scheduledEffectiveFromLocalDate: LocalDate,
  ): EngagementError.StreakScheduleNotAfterCurrent {
    return {
      errorCode: EngagementErrorCode.StreakScheduleNotAfterCurrent,
      field: StreakRuleField.ScheduledEffectiveFromLocalDate,
      value: scheduledEffectiveFromLocalDate,
      currentEffectiveFromLocalDate,
    };
  },
  repositoryFailure(): EngagementError.RepositoryFailure {
    return { errorCode: EngagementErrorCode.RepositoryFailure };
  },

  // ── Notifications ─────────────────────────────────────────────────────
  notificationReadBeforeSent(
    sentAtUtcMs: UtcEpochMs,
    readAtUtcMs: UtcEpochMs,
  ): EngagementError.NotificationReadBeforeSent {
    return {
      errorCode: EngagementErrorCode.NotificationReadBeforeSent,
      sentAtUtcMs,
      readAtUtcMs,
    };
  },

  // ── Programs ──────────────────────────────────────────────────────────
  /** A sort order that is not a non-negative integer, or an apply URL that does not parse. */
  program(
    errorCode: EngagementError.ProgramCode,
    rawValue: unknown,
  ): EngagementError.ProgramError {
    return { errorCode, rawValue: scalarOf(rawValue) };
  },
  /** An update of a role, course or event that is no longer stored. */
  programNotFound(
    errorCode: EngagementError.ProgramNotFoundCode,
    programId: PositionId | CourseId | EventId,
  ): EngagementError.ProgramNotFound {
    return { errorCode, programId };
  },
  /** No zone can place the event: its location and the default shop are both absent. */
  shopEventZoneUnknown(
    locationId: LocationId,
  ): EngagementError.ShopEventZoneUnknown {
    return { errorCode: EngagementErrorCode.ShopEventZoneUnknown, locationId };
  },

  /** Narrows an error to one code — `EngagementError.is(e, EngagementErrorCode.PointsInsufficient)`. */
  is<C extends EngagementErrorCode>(
    error: EngagementError,
    errorCode: C,
  ): error is Extract<EngagementError, { readonly errorCode: C }> {
    return error.errorCode === errorCode;
  },
} as const;

export namespace EngagementError {
  /** An i18n-safe parameter value. */
  export type Scalar = string | number | boolean | null;

  type Bare<C extends EngagementErrorCode> = { readonly errorCode: C };

  export type IdEmpty = {
    readonly errorCode: typeof EngagementErrorCode.IdEmpty;
    /** Which id was blank — `'CouponId'`, `'InvitationId'`, … */
    readonly idType: string;
  };

  export type CouponNameEmpty = Bare<
    typeof EngagementErrorCode.CouponNameEmpty
  >;
  export type CouponExpiryDaysInvalid = {
    readonly errorCode: typeof EngagementErrorCode.CouponExpiryDaysInvalid;
    readonly attempted: number;
  };
  export type CouponUsageLimitInvalid = {
    readonly errorCode: typeof EngagementErrorCode.CouponUsageLimitInvalid;
    readonly attempted: number;
  };
  export type CouponOccasionUnknown = {
    readonly errorCode: typeof EngagementErrorCode.CouponOccasionUnknown;
    readonly attempted: Scalar;
  };
  export type CouponValuePercentageInvalid = {
    readonly errorCode: typeof EngagementErrorCode.CouponValuePercentageInvalid;
    readonly attempted: number;
  };
  export type CouponValueAmountNotPositive = {
    readonly errorCode: typeof EngagementErrorCode.CouponValueAmountNotPositive;
    readonly attemptedCents: PriceCents;
  };
  export type CouponGrantCapacityInvalid = {
    readonly errorCode: typeof EngagementErrorCode.CouponGrantCapacityInvalid;
    readonly attempted: number;
  };
  export type CouponGrantNotActive = {
    readonly errorCode: typeof EngagementErrorCode.CouponGrantNotActive;
    readonly currentState: GrantStatus;
  };
  export type CouponGrantNotExpiring = Bare<
    typeof EngagementErrorCode.CouponGrantNotExpiring
  >;
  export type CouponGrantReasonEmpty = Bare<
    typeof EngagementErrorCode.CouponGrantReasonEmpty
  >;
  export type DiscountCapInvalid = {
    readonly errorCode: typeof EngagementErrorCode.DiscountCapInvalid;
    readonly attempted: number;
  };

  export type VoucherCodeInvalid = {
    readonly errorCode: typeof EngagementErrorCode.VoucherCodeInvalid;
    readonly attempted: string;
  };
  export type GiftVoucherValueInvalid = Bare<
    typeof EngagementErrorCode.GiftVoucherValueInvalid
  >;
  export type GiftVoucherNotRedeemable = {
    readonly errorCode: typeof EngagementErrorCode.GiftVoucherNotRedeemable;
    readonly reason: VoucherRefusal;
  };
  export type GiftVoucherInsufficientBalance = {
    readonly errorCode: typeof EngagementErrorCode.GiftVoucherInsufficientBalance;
    readonly requestedCents: PriceCents;
    readonly balanceCents: PriceCents;
  };
  export type GiftVoucherOverRestore = Bare<
    typeof EngagementErrorCode.GiftVoucherOverRestore
  >;
  export type GiftVoucherCurrencyMismatch = {
    readonly errorCode: typeof EngagementErrorCode.GiftVoucherCurrencyMismatch;
    readonly expected: Currency;
    readonly found: Currency;
  };

  export type PointsInvalid = {
    readonly errorCode: typeof EngagementErrorCode.PointsInvalid;
    readonly attempted: number;
  };
  export type PointsInsufficient = {
    readonly errorCode: typeof EngagementErrorCode.PointsInsufficient;
    readonly requested: number;
    /** The most that may be taken («може да се отнемат до 280 т.»). */
    readonly balance: number;
  };

  export type InvitationInviterNameEmpty = Bare<
    typeof EngagementErrorCode.InvitationInviterNameEmpty
  >;
  export type InvitationRedemptionCountInvalid = {
    readonly errorCode: typeof EngagementErrorCode.InvitationRedemptionCountInvalid;
    readonly attempted: number;
  };
  export type InvitationSelfRedemption = Bare<
    typeof EngagementErrorCode.InvitationSelfRedemption
  >;

  export type BadgeCategoryOrderNegative = {
    readonly errorCode: typeof EngagementErrorCode.BadgeCategoryOrderNegative;
    readonly rawValue: number;
  };
  export type BadgeSeriesNoLevels = Bare<
    typeof EngagementErrorCode.BadgeSeriesNoLevels
  >;
  export type BadgeSeriesLevelGap = {
    readonly errorCode: typeof EngagementErrorCode.BadgeSeriesLevelGap;
    /** The levels as written, comma-separated. */
    readonly levels: string;
  };
  export type BadgeSeriesTargetsNotRising = {
    readonly errorCode: typeof EngagementErrorCode.BadgeSeriesTargetsNotRising;
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
    readonly errorCode: typeof EngagementErrorCode.BadgeSeriesLevelWithoutRule;
    readonly level: number;
  };
  export type BadgeSeriesAwardNotPositive = {
    readonly errorCode: typeof EngagementErrorCode.BadgeSeriesAwardNotPositive;
    readonly level: number;
    readonly awardKind: AwardKind;
  };
  export type SeasonWindowMalformed = {
    readonly errorCode: typeof EngagementErrorCode.SeasonWindowMalformed;
    readonly from: string;
    readonly until: string;
  };
  export type SeasonWindowInverted = {
    readonly errorCode: typeof EngagementErrorCode.SeasonWindowInverted;
    readonly from: LocalDate;
    readonly until: LocalDate;
  };
  export type SeasonEventWithTrack = Bare<
    typeof EngagementErrorCode.SeasonEventWithTrack
  >;
  export type SeasonWithoutTrack = Bare<
    typeof EngagementErrorCode.SeasonWithoutTrack
  >;
  export type SeasonAnnouncedLate = {
    readonly errorCode: typeof EngagementErrorCode.SeasonAnnouncedLate;
    readonly announcedOn: LocalDate;
    readonly from: LocalDate;
    readonly noticeDays: number;
  };
  export type LoyaltyCatalogDanglingCategory = {
    readonly errorCode: typeof EngagementErrorCode.LoyaltyCatalogDanglingCategory;
    readonly seriesId: BadgeSeriesId;
    readonly categoryId: BadgeCategoryId;
  };
  export type LoyaltyCatalogDanglingSeason = {
    readonly errorCode: typeof EngagementErrorCode.LoyaltyCatalogDanglingSeason;
    readonly seasonId: SeasonId;
    readonly seriesId: BadgeSeriesId;
  };
  export type LoyaltyCatalogDuplicateId = {
    readonly errorCode: typeof EngagementErrorCode.LoyaltyCatalogDuplicateId;
    readonly collection: string;
    readonly id: string;
  };
  export type LoyaltyCatalogTiersNotRising = {
    readonly errorCode: typeof EngagementErrorCode.LoyaltyCatalogTiersNotRising;
    /** The tier ids in rank order — a 1-to-N list of brands (L3), not a joined string. */
    readonly tierIds: readonly TierId[];
  };
  export type LoyaltyCatalogCostNotPositive = {
    readonly errorCode: typeof EngagementErrorCode.LoyaltyCatalogCostNotPositive;
    readonly rewardId: RewardId;
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
    readonly errorCode: StreakBareCode;
    readonly field: StreakRuleField;
    readonly value: Scalar;
  };
  export type StreakRange = {
    readonly errorCode: StreakRangeCode;
    readonly field: StreakRuleField;
    readonly value: Scalar;
    readonly min: number;
    readonly max: number;
  };
  export type StreakNameEmpty = {
    readonly errorCode: typeof EngagementErrorCode.StreakNameEmpty;
    readonly field: StreakRuleField;
    readonly value: Scalar;
    readonly locale: Locale;
  };
  export type StreakUnknownOption = {
    readonly errorCode: typeof EngagementErrorCode.StreakUnknownOption;
    readonly field: StreakRuleField;
    readonly value: Scalar;
    /** The closed set, comma-separated. */
    readonly options: string;
  };
  export type StreakClampInverted = {
    readonly errorCode: typeof EngagementErrorCode.StreakClampInverted;
    readonly field: StreakRuleField;
    readonly value: number;
    readonly minDays: number;
    readonly maxDays: number;
  };
  export type StreakFallbackOutsideClamp = {
    readonly errorCode: typeof EngagementErrorCode.StreakFallbackOutsideClamp;
    readonly field: StreakRuleField;
    readonly value: number;
    readonly minDays: number;
    readonly maxDays: number;
  };
  export type StreakGraceNotShorterThanInterval = {
    readonly errorCode: typeof EngagementErrorCode.StreakGraceNotShorterThanInterval;
    readonly field: StreakRuleField;
    readonly value: number;
    readonly shortestIntervalDays: number;
  };
  export type StreakStartWithAboveCap = {
    readonly errorCode: typeof EngagementErrorCode.StreakStartWithAboveCap;
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
    readonly errorCode: typeof EngagementErrorCode.StreakScheduleVersionNotRising;
    readonly field: StreakRuleField;
    readonly value: number;
    readonly currentVersion: number;
  };
  export type StreakScheduleNotAfterCurrent = {
    readonly errorCode: typeof EngagementErrorCode.StreakScheduleNotAfterCurrent;
    readonly field: StreakRuleField;
    readonly value: LocalDate;
    readonly currentEffectiveFromLocalDate: LocalDate;
  };
  export type RepositoryFailure = Bare<
    typeof EngagementErrorCode.RepositoryFailure
  >;

  export type NotificationReadBeforeSent = {
    readonly errorCode: typeof EngagementErrorCode.NotificationReadBeforeSent;
    readonly sentAtUtcMs: UtcEpochMs;
    readonly readAtUtcMs: UtcEpochMs;
  };

  export type ProgramCode =
    | typeof EngagementErrorCode.PositionSortOrderInvalid
    | typeof EngagementErrorCode.PositionApplyUrlInvalid
    | typeof EngagementErrorCode.CourseSortOrderInvalid
    | typeof EngagementErrorCode.CourseApplyUrlInvalid
    | typeof EngagementErrorCode.ShopEventSortOrderInvalid
    | typeof EngagementErrorCode.ShopEventApplyUrlInvalid;
  export type ProgramError = {
    readonly errorCode: ProgramCode;
    readonly rawValue: Scalar;
  };
  export type ProgramNotFoundCode =
    | typeof EngagementErrorCode.PositionNotFound
    | typeof EngagementErrorCode.CourseNotFound
    | typeof EngagementErrorCode.ShopEventNotFound;
  export type ProgramNotFound = {
    readonly errorCode: ProgramNotFoundCode;
    readonly programId: PositionId | CourseId | EventId;
  };
  export type ShopEventZoneUnknown = {
    readonly errorCode: typeof EngagementErrorCode.ShopEventZoneUnknown;
    /** The default shop the save fell back to and found absent. */
    readonly locationId: LocationId;
  };
  export type InvitationNotFound = {
    readonly errorCode: typeof EngagementErrorCode.InvitationNotFound;
    readonly invitationId: InvitationId;
  };
  export type InvitationAlreadyRedeemed = {
    readonly errorCode: typeof EngagementErrorCode.InvitationAlreadyRedeemed;
    readonly invitationId: InvitationId;
  };
  export type InvitationUnauthenticated = Bare<
    typeof EngagementErrorCode.InvitationUnauthenticated
  >;
}
