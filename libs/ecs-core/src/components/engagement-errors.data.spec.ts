import { describe, expect, it } from 'vitest';
import {
  ENGAGEMENT_ERROR_CODES,
  EngagementError,
  EngagementErrorCode,
  StreakRuleField,
} from './engagement-errors.data';

describe('EngagementErrorCode', () => {
  it('keeps every code in the engagement namespace, each once', () => {
    expect(new Set(ENGAGEMENT_ERROR_CODES).size).toBe(
      ENGAGEMENT_ERROR_CODES.length,
    );
    for (const code of ENGAGEMENT_ERROR_CODES) {
      expect(code).toMatch(/^engagement\.[a-z_]+\.[a-z_]+$/);
    }
  });

  it('keeps the legacy engagement strings', () => {
    expect(EngagementErrorCode.PointsInsufficient).toBe(
      'engagement.points.insufficient',
    );
    expect(EngagementErrorCode.CouponValueAmountNotPositive).toBe(
      'engagement.coupon_value.negative_amount',
    );
    expect(EngagementErrorCode.StreakScheduleNotAfterCurrent).toBe(
      'engagement.streak_schedule.scheduled_not_after_current',
    );
  });

  it('retires the schedule id mismatch and the notification title', () => {
    expect(ENGAGEMENT_ERROR_CODES).not.toContain(
      'engagement.streak_schedule.id_mismatch',
    );
    expect(ENGAGEMENT_ERROR_CODES).not.toContain(
      'engagement.notification.empty_title',
    );
  });

  it('names every field of the rule once, as the admin page keys it', () => {
    const fields = Object.values(StreakRuleField);
    expect(new Set(fields).size).toBe(fields.length);
    expect(fields).toContain('effectiveFromDayKey');
    expect(fields).not.toContain('effectiveFrom');
  });
});

describe('EngagementError factories', () => {
  it('build each struct with its code and i18n params', () => {
    expect(EngagementError.idEmpty('CouponId')).toEqual({
      code: 'engagement.id.empty',
      idType: 'CouponId',
    });
    expect(EngagementError.couponNameEmpty()).toEqual({
      code: 'engagement.coupon.empty_name',
    });
    expect(EngagementError.couponUsageLimitInvalid(0)).toEqual({
      code: 'engagement.coupon.invalid_usage_limit',
      attempted: 0,
    });
    expect(EngagementError.couponGrantNotActive('used')).toEqual({
      code: 'engagement.coupon_grant.not_active',
      currentState: 'used',
    });
    expect(EngagementError.couponGrantNotExpiring()).toEqual({
      code: 'engagement.coupon_grant.not_expiring',
    });
    expect(EngagementError.couponGrantReasonEmpty()).toEqual({
      code: 'engagement.coupon_grant.empty_reason',
    });
    expect(EngagementError.discountCapInvalid(120)).toEqual({
      code: 'engagement.discount_application.invalid_cap',
      attempted: 120,
    });
    expect(EngagementError.giftVoucherValueInvalid()).toEqual({
      code: 'engagement.gift_voucher.invalid_value',
    });
    expect(EngagementError.giftVoucherNotRedeemable('expired')).toEqual({
      code: 'engagement.gift_voucher.not_redeemable',
      reason: 'expired',
    });
    expect(EngagementError.giftVoucherInsufficientBalance(5000, 2000)).toEqual({
      code: 'engagement.gift_voucher.insufficient_balance',
      requestedMinorUnits: 5000,
      balanceMinorUnits: 2000,
    });
    expect(EngagementError.giftVoucherOverRestore()).toEqual({
      code: 'engagement.gift_voucher.over_restore',
    });
    expect(EngagementError.giftVoucherCurrencyMismatch('EUR', 'BGN')).toEqual({
      code: 'engagement.gift_voucher.currency_mismatch',
      expected: 'EUR',
      found: 'BGN',
    });
    expect(EngagementError.invitationInviterNameEmpty()).toEqual({
      code: 'engagement.invitation.empty_inviter_name',
    });
    expect(EngagementError.invitationSelfRedemption()).toEqual({
      code: 'engagement.invitation.self_redemption',
    });
  });

  it('build the catalogue faults, a list as one comma-separated param', () => {
    expect(EngagementError.badgeCategoryOrderNegative(-1)).toEqual({
      code: 'engagement.badge_category.order_negative',
      rawValue: -1,
    });
    expect(EngagementError.badgeSeriesNoLevels()).toEqual({
      code: 'engagement.badge_series.no_levels',
    });
    expect(EngagementError.badgeSeriesLevelGap([1, 2, 4])).toEqual({
      code: 'engagement.badge_series.level_gap',
      levels: '1, 2, 4',
    });
    expect(EngagementError.badgeSeriesTargetsNotRising([5, 5])).toEqual({
      code: 'engagement.badge_series.targets_not_rising',
      targets: '5, 5',
    });
    expect(EngagementError.badgeSeriesHomeless().code).toBe(
      'engagement.badge_series.homeless',
    );
    expect(EngagementError.badgeSeriesOneOffWithSeveralLevels().code).toBe(
      'engagement.badge_series.one_off_with_several_levels',
    );
    expect(EngagementError.badgeSeriesRepeatableWithSeveralLevels().code).toBe(
      'engagement.badge_series.repeatable_with_several_levels',
    );
    expect(EngagementError.badgeSeriesLevelWithoutRule(2)).toEqual({
      code: 'engagement.badge_series.level_without_rule',
      level: 2,
    });
    expect(EngagementError.badgeSeriesAwardNotPositive(3, 'points')).toEqual({
      code: 'engagement.badge_series.award_not_positive',
      level: 3,
      kind: 'points',
    });
    expect(
      EngagementError.seasonWindowMalformed('2026-13-01', '2026-11-30'),
    ).toEqual({
      code: 'engagement.season.window_malformed',
      from: '2026-13-01',
      until: '2026-11-30',
    });
    expect(
      EngagementError.seasonWindowInverted('2026-12-01', '2026-11-30').code,
    ).toBe('engagement.season.window_inverted');
    expect(EngagementError.seasonEventWithTrack().code).toBe(
      'engagement.season.event_with_track',
    );
    expect(EngagementError.seasonWithoutTrack().code).toBe(
      'engagement.season.without_track',
    );
    expect(
      EngagementError.seasonAnnouncedLate('2026-10-20', '2026-11-01', 30),
    ).toEqual({
      code: 'engagement.season.announced_late',
      announcedOn: '2026-10-20',
      from: '2026-11-01',
      noticeDays: 30,
    });
    expect(
      EngagementError.loyaltyCatalogDanglingCategory('series-a', 'cat-x'),
    ).toEqual({
      code: 'engagement.loyalty_catalog.dangling_category',
      seriesId: 'series-a',
      categoryId: 'cat-x',
    });
    expect(
      EngagementError.loyaltyCatalogDanglingSeason('season-x', 'series-a'),
    ).toEqual({
      code: 'engagement.loyalty_catalog.dangling_season',
      seasonId: 'season-x',
      seriesId: 'series-a',
    });
    expect(
      EngagementError.loyaltyCatalogDuplicateId('badgeSeries', 'series-a'),
    ).toEqual({
      code: 'engagement.loyalty_catalog.duplicate_id',
      collection: 'badgeSeries',
      id: 'series-a',
    });
    expect(
      EngagementError.loyaltyCatalogTiersNotRising(['gold', 'silver']),
    ).toEqual({
      code: 'engagement.loyalty_catalog.tiers_not_rising',
      tierIds: 'gold, silver',
    });
    expect(
      EngagementError.loyaltyCatalogCostNotPositive('reward-a', 0),
    ).toEqual({
      code: 'engagement.loyalty_catalog.cost_not_positive',
      rewardId: 'reward-a',
      cost: 0,
    });
  });

  it('build the schedule, notification and programs faults', () => {
    expect(EngagementError.streakScheduleVersionNotRising(3, 3)).toEqual({
      code: 'engagement.streak_schedule.version_not_rising',
      field: 'scheduled.version',
      value: 3,
      currentVersion: 3,
    });
    expect(
      EngagementError.streakScheduleNotAfterCurrent('2026-09-01', '2026-08-01'),
    ).toEqual({
      code: 'engagement.streak_schedule.scheduled_not_after_current',
      field: 'scheduled.effectiveFromDayKey',
      value: '2026-08-01',
      currentEffectiveFromDayKey: '2026-09-01',
    });
    expect(EngagementError.notificationReadBeforeSent(2_000, 1_000)).toEqual({
      code: 'engagement.notification.read_before_sent',
      sentAtMs: 2_000,
      readAtMs: 1_000,
    });
    expect(
      EngagementError.program(
        EngagementErrorCode.CourseApplyUrlInvalid,
        'not a url',
      ),
    ).toEqual({
      code: 'engagement.course.invalid_apply_url',
      rawValue: 'not a url',
    });
    expect(
      EngagementError.program(EngagementErrorCode.PositionSortOrderInvalid, -1),
    ).toEqual({ code: 'engagement.position.invalid_sort_order', rawValue: -1 });
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

  it('is() narrows by code', () => {
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
