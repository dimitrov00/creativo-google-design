import { describe, expect, it } from 'vitest';
import { Currency } from './currency.primitive';
import {
  BadgeCategoryId,
  BadgeSeriesId,
  CourseId,
  EventId,
  LocationId,
  PositionId,
  RewardId,
  SeasonId,
  TierId,
} from './ids.primitive';
import { PriceCents } from './price-cents.primitive';
import { localDate, unwrapOk, utcMs } from '@core/testing';
import {
  ENGAGEMENT_ERROR_CODES,
  EngagementError,
  EngagementErrorCode,
  StreakRuleField,
} from './engagement-errors.data';
import { AwardKind } from './award-kind.data';
import { GrantStatus } from './grant-status.data';
import { VoucherRefusal } from './voucher-refusal.data';

const cents = (raw: number): PriceCents => unwrapOk(PriceCents.of(raw));

describe('EngagementErrorCode', () => {
  it('keeps every code SCREAMING under the ENGAGEMENT_ prefix, each once (Law 7.5)', () => {
    expect(new Set(ENGAGEMENT_ERROR_CODES).size).toBe(
      ENGAGEMENT_ERROR_CODES.length,
    );
    for (const errorCode of ENGAGEMENT_ERROR_CODES) {
      expect(errorCode).toMatch(/^ENGAGEMENT_[A-Z_]+$/);
    }
  });

  it('maps the legacy dotted strings mechanically (flatten-spec §4.2)', () => {
    expect(EngagementErrorCode.PointsInsufficient).toBe(
      'ENGAGEMENT_POINTS_INSUFFICIENT',
    );
    expect(EngagementErrorCode.CouponValueAmountNotPositive).toBe(
      'ENGAGEMENT_COUPON_VALUE_NEGATIVE_AMOUNT',
    );
    expect(EngagementErrorCode.StreakScheduleNotAfterCurrent).toBe(
      'ENGAGEMENT_STREAK_SCHEDULE_SCHEDULED_NOT_AFTER_CURRENT',
    );
  });

  it('retires the schedule id mismatch and the notification title', () => {
    expect(ENGAGEMENT_ERROR_CODES).not.toContain(
      'ENGAGEMENT_STREAK_SCHEDULE_ID_MISMATCH',
    );
    expect(ENGAGEMENT_ERROR_CODES).not.toContain(
      'ENGAGEMENT_NOTIFICATION_EMPTY_TITLE',
    );
  });

  it('names every field of the rule once, by its flat name (the admin page keys it)', () => {
    const fields = Object.values(StreakRuleField);
    expect(new Set(fields).size).toBe(fields.length);
    expect(fields).toContain('effectiveFromLocalDate');
    expect(fields).toContain('intervalDays');
    expect(fields).toContain('protectionsMaxBanked');
    expect(fields).toContain('scheduledVersion');
    expect(fields).not.toContain('effectiveFrom');
    for (const field of fields) expect(field).not.toContain('.');
  });
});

describe('EngagementError factories', () => {
  it('build each struct with its errorCode and i18n params', () => {
    expect(EngagementError.idEmpty('CouponId')).toEqual({
      errorCode: 'ENGAGEMENT_ID_EMPTY',
      idType: 'CouponId',
    });
    expect(EngagementError.couponNameEmpty()).toEqual({
      errorCode: 'ENGAGEMENT_COUPON_EMPTY_NAME',
    });
    expect(EngagementError.couponUsageLimitInvalid(0)).toEqual({
      errorCode: 'ENGAGEMENT_COUPON_INVALID_USAGE_LIMIT',
      attempted: 0,
    });
    expect(EngagementError.couponGrantNotActive(GrantStatus.Used)).toEqual({
      errorCode: 'ENGAGEMENT_COUPON_GRANT_NOT_ACTIVE',
      currentState: 'USED',
    });
    expect(EngagementError.couponGrantNotExpiring()).toEqual({
      errorCode: 'ENGAGEMENT_COUPON_GRANT_NOT_EXPIRING',
    });
    expect(EngagementError.couponGrantReasonEmpty()).toEqual({
      errorCode: 'ENGAGEMENT_COUPON_GRANT_EMPTY_REASON',
    });
    expect(EngagementError.discountCapInvalid(120)).toEqual({
      errorCode: 'ENGAGEMENT_DISCOUNT_APPLICATION_INVALID_CAP',
      attempted: 120,
    });
    expect(EngagementError.giftVoucherValueInvalid()).toEqual({
      errorCode: 'ENGAGEMENT_GIFT_VOUCHER_INVALID_VALUE',
    });
    expect(
      EngagementError.giftVoucherNotRedeemable(VoucherRefusal.Expired),
    ).toEqual({
      errorCode: 'ENGAGEMENT_GIFT_VOUCHER_NOT_REDEEMABLE',
      reason: VoucherRefusal.Expired,
    });
    expect(
      EngagementError.giftVoucherInsufficientBalance(cents(5000), cents(2000)),
    ).toEqual({
      errorCode: 'ENGAGEMENT_GIFT_VOUCHER_INSUFFICIENT_BALANCE',
      requestedCents: 5000,
      balanceCents: 2000,
    });
    expect(EngagementError.giftVoucherOverRestore()).toEqual({
      errorCode: 'ENGAGEMENT_GIFT_VOUCHER_OVER_RESTORE',
    });
    expect(
      EngagementError.giftVoucherCurrencyMismatch(Currency.EUR, Currency.BGN),
    ).toEqual({
      errorCode: 'ENGAGEMENT_GIFT_VOUCHER_CURRENCY_MISMATCH',
      expected: 'EUR',
      found: 'BGN',
    });
    expect(EngagementError.invitationInviterNameEmpty()).toEqual({
      errorCode: 'ENGAGEMENT_INVITATION_EMPTY_INVITER_NAME',
    });
    expect(EngagementError.invitationSelfRedemption()).toEqual({
      errorCode: 'ENGAGEMENT_INVITATION_SELF_REDEMPTION',
    });
    expect(EngagementError.couponValueAmountNotPositive(cents(0))).toEqual({
      errorCode: 'ENGAGEMENT_COUPON_VALUE_NEGATIVE_AMOUNT',
      attemptedCents: 0,
    });
  });

  it('build the catalogue faults, a list of figures as one comma-separated param and a list of ids as brands', () => {
    expect(EngagementError.badgeCategoryOrderNegative(-1)).toEqual({
      errorCode: 'ENGAGEMENT_BADGE_CATEGORY_ORDER_NEGATIVE',
      rawValue: -1,
    });
    expect(EngagementError.badgeSeriesNoLevels()).toEqual({
      errorCode: 'ENGAGEMENT_BADGE_SERIES_NO_LEVELS',
    });
    expect(EngagementError.badgeSeriesLevelGap([1, 2, 4])).toEqual({
      errorCode: 'ENGAGEMENT_BADGE_SERIES_LEVEL_GAP',
      levels: '1, 2, 4',
    });
    expect(EngagementError.badgeSeriesTargetsNotRising([5, 5])).toEqual({
      errorCode: 'ENGAGEMENT_BADGE_SERIES_TARGETS_NOT_RISING',
      targets: '5, 5',
    });
    expect(EngagementError.badgeSeriesHomeless().errorCode).toBe(
      'ENGAGEMENT_BADGE_SERIES_HOMELESS',
    );
    expect(EngagementError.badgeSeriesOneOffWithSeveralLevels().errorCode).toBe(
      'ENGAGEMENT_BADGE_SERIES_ONE_OFF_WITH_SEVERAL_LEVELS',
    );
    expect(
      EngagementError.badgeSeriesRepeatableWithSeveralLevels().errorCode,
    ).toBe('ENGAGEMENT_BADGE_SERIES_REPEATABLE_WITH_SEVERAL_LEVELS');
    expect(EngagementError.badgeSeriesLevelWithoutRule(2)).toEqual({
      errorCode: 'ENGAGEMENT_BADGE_SERIES_LEVEL_WITHOUT_RULE',
      level: 2,
    });
    expect(
      EngagementError.badgeSeriesAwardNotPositive(3, AwardKind.Points),
    ).toEqual({
      errorCode: 'ENGAGEMENT_BADGE_SERIES_AWARD_NOT_POSITIVE',
      level: 3,
      awardKind: 'POINTS',
    });
    expect(
      EngagementError.seasonWindowMalformed('2026-13-01', '2026-11-30'),
    ).toEqual({
      errorCode: 'ENGAGEMENT_SEASON_WINDOW_MALFORMED',
      from: '2026-13-01',
      until: '2026-11-30',
    });
    expect(
      EngagementError.seasonWindowInverted(
        localDate('2026-12-01'),
        localDate('2026-11-30'),
      ).errorCode,
    ).toBe('ENGAGEMENT_SEASON_WINDOW_INVERTED');
    expect(EngagementError.seasonEventWithTrack().errorCode).toBe(
      'ENGAGEMENT_SEASON_EVENT_WITH_TRACK',
    );
    expect(EngagementError.seasonWithoutTrack().errorCode).toBe(
      'ENGAGEMENT_SEASON_WITHOUT_TRACK',
    );
    expect(
      EngagementError.seasonAnnouncedLate(
        localDate('2026-10-20'),
        localDate('2026-11-01'),
        30,
      ),
    ).toEqual({
      errorCode: 'ENGAGEMENT_SEASON_ANNOUNCED_LATE',
      announcedOn: '2026-10-20',
      from: '2026-11-01',
      noticeDays: 30,
    });
    expect(
      EngagementError.loyaltyCatalogDanglingCategory(
        BadgeSeriesId.of('series-a'),
        BadgeCategoryId.of('cat-x'),
      ),
    ).toEqual({
      errorCode: 'ENGAGEMENT_LOYALTY_CATALOG_DANGLING_CATEGORY',
      seriesId: 'series-a',
      categoryId: 'cat-x',
    });
    expect(
      EngagementError.loyaltyCatalogDanglingSeason(
        SeasonId.of('season-x'),
        BadgeSeriesId.of('series-a'),
      ),
    ).toEqual({
      errorCode: 'ENGAGEMENT_LOYALTY_CATALOG_DANGLING_SEASON',
      seasonId: 'season-x',
      seriesId: 'series-a',
    });
    expect(
      EngagementError.loyaltyCatalogDuplicateId('badgeSeries', 'series-a'),
    ).toEqual({
      errorCode: 'ENGAGEMENT_LOYALTY_CATALOG_DUPLICATE_ID',
      collection: 'badgeSeries',
      id: 'series-a',
    });
    expect(
      EngagementError.loyaltyCatalogTiersNotRising([
        TierId.of('gold'),
        TierId.of('silver'),
      ]),
    ).toEqual({
      errorCode: 'ENGAGEMENT_LOYALTY_CATALOG_TIERS_NOT_RISING',
      tierIds: ['gold', 'silver'],
    });
    expect(
      EngagementError.loyaltyCatalogCostNotPositive(RewardId.of('reward-a'), 0),
    ).toEqual({
      errorCode: 'ENGAGEMENT_LOYALTY_CATALOG_COST_NOT_POSITIVE',
      rewardId: 'reward-a',
      cost: 0,
    });
  });

  it('build the schedule, notification and programs faults', () => {
    expect(EngagementError.streakScheduleVersionNotRising(3, 3)).toEqual({
      errorCode: 'ENGAGEMENT_STREAK_SCHEDULE_VERSION_NOT_RISING',
      field: 'scheduledVersion',
      value: 3,
      currentVersion: 3,
    });
    expect(
      EngagementError.streakScheduleNotAfterCurrent(
        localDate('2026-09-01'),
        localDate('2026-08-01'),
      ),
    ).toEqual({
      errorCode: 'ENGAGEMENT_STREAK_SCHEDULE_SCHEDULED_NOT_AFTER_CURRENT',
      field: 'scheduledEffectiveFromLocalDate',
      value: '2026-08-01',
      currentEffectiveFromLocalDate: '2026-09-01',
    });
    const sent = utcMs('2026-09-28T09:00:02.000+03:00');
    const read = utcMs('2026-09-28T09:00:01.000+03:00');
    expect(EngagementError.notificationReadBeforeSent(sent, read)).toEqual({
      errorCode: 'ENGAGEMENT_NOTIFICATION_READ_BEFORE_SENT',
      sentAtUtcMs: sent,
      readAtUtcMs: read,
    });
    expect(
      EngagementError.program(
        EngagementErrorCode.CourseApplyUrlInvalid,
        'not a url',
      ),
    ).toEqual({
      errorCode: 'ENGAGEMENT_COURSE_INVALID_APPLY_URL',
      rawValue: 'not a url',
    });
    expect(
      EngagementError.program(EngagementErrorCode.PositionSortOrderInvalid, -1),
    ).toEqual({
      errorCode: 'ENGAGEMENT_POSITION_INVALID_SORT_ORDER',
      rawValue: -1,
    });
  });

  it('build the programs save refusals with branded ids (flip 4, F4-6)', () => {
    expect(
      EngagementError.programNotFound(
        EngagementErrorCode.PositionNotFound,
        PositionId.of('pos-1'),
      ),
    ).toEqual({
      errorCode: 'ENGAGEMENT_POSITION_NOT_FOUND',
      programId: 'pos-1',
    });
    expect(
      EngagementError.programNotFound(
        EngagementErrorCode.CourseNotFound,
        CourseId.of('course-1'),
      ),
    ).toEqual({
      errorCode: 'ENGAGEMENT_COURSE_NOT_FOUND',
      programId: 'course-1',
    });
    expect(
      EngagementError.programNotFound(
        EngagementErrorCode.ShopEventNotFound,
        EventId.of('evt-1'),
      ),
    ).toEqual({
      errorCode: 'ENGAGEMENT_SHOP_EVENT_NOT_FOUND',
      programId: 'evt-1',
    });
    expect(
      EngagementError.shopEventZoneUnknown(LocationId.of('loc-center')),
    ).toEqual({
      errorCode: 'ENGAGEMENT_SHOP_EVENT_ZONE_UNKNOWN',
      locationId: 'loc-center',
    });
  });

  it('keeps the four programs save codes after the six field codes', () => {
    const codes = ENGAGEMENT_ERROR_CODES;
    const at = (code: EngagementErrorCode) => codes.indexOf(code);
    expect(at(EngagementErrorCode.PositionNotFound)).toBe(
      at(EngagementErrorCode.ShopEventApplyUrlInvalid) + 1,
    );
    expect(codes.slice(at(EngagementErrorCode.PositionNotFound))).toEqual([
      'ENGAGEMENT_POSITION_NOT_FOUND',
      'ENGAGEMENT_COURSE_NOT_FOUND',
      'ENGAGEMENT_SHOP_EVENT_NOT_FOUND',
      'ENGAGEMENT_SHOP_EVENT_ZONE_UNKNOWN',
    ]);
  });

  it('flatten any rule value to an i18n-safe scalar', () => {
    const value = (raw: unknown) =>
      EngagementError.streakRule(
        EngagementErrorCode.StreakUnknownExcuse,
        StreakRuleField.Excuses,
        raw,
      ).value;
    expect(value('weather')).toBe('weather');
    expect(value(3)).toBe(3);
    expect(value(true)).toBe(true);
    expect(value(null)).toBeNull();
    expect(value(undefined)).toBeNull();
    expect(value(['a', 'b'])).toBe('a, b');
    expect(value({})).toBe('[object Object]');
  });

  it('is() narrows by errorCode', () => {
    const error: EngagementError = EngagementError.pointsInsufficient(10, 5);
    expect(
      EngagementError.is(error, EngagementErrorCode.PointsInsufficient),
    ).toBe(true);
    expect(EngagementError.is(error, EngagementErrorCode.PointsInvalid)).toBe(
      false,
    );
    if (EngagementError.is(error, EngagementErrorCode.PointsInsufficient)) {
      expect(error.balance).toBe(5);
    }
  });
});
