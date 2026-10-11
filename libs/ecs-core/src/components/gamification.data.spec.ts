import { describe, expect, it } from 'vitest';
import { BarberId, LocationId, ServiceId } from '../primitives/ids.primitive';
import {
  AwardKind,
  AwardSummary,
  BadgeSubject,
  BadgeSubjectSlot,
  BADGE_CATEGORY_KINDS,
  BADGE_EMBLEMS,
  Gamification,
  METRICS,
  Metric,
  MetricRef,
  PER_VISIT_METRICS,
  PERK_IDS,
  SeasonKind,
  SeasonPhase,
  PerkId,
} from './gamification.data';

describe('the loyalty catalogue vocabularies', () => {
  it('declare the tags SCREAMING and keep the catalogue ids, in their order', () => {
    expect(BADGE_CATEGORY_KINDS).toEqual([
      'MILESTONES',
      'MASTERY',
      'BARBERS',
      'RHYTHM',
      'SPECIAL',
      'RECORDS',
    ]);
    // Art asset names and catalogue ids are external keys (flatten-spec §0.4).
    expect(BADGE_EMBLEMS).toHaveLength(31);
    expect(BADGE_EMBLEMS.slice(0, 3)).toEqual(['visits', 'streak', 'referral']);
    expect(BADGE_EMBLEMS.at(-1)).toBe('spa');
    expect(new Set(BADGE_EMBLEMS).size).toBe(BADGE_EMBLEMS.length);
    expect(METRICS).toHaveLength(16);
    expect(METRICS[0]).toBe('client.visits.completed');
    expect(METRICS.at(-1)).toBe('client.tenure.days');
    expect(PERK_IDS).toEqual([
      'perk.priorityWaitlist',
      'perk.bookFurtherAhead',
      'perk.freeReschedule',
    ]);
    expect(PER_VISIT_METRICS).toEqual([
      'client.visits.completed',
      'client.visits.earlyBird',
      'client.visits.onTime',
    ]);
    expect(Object.values(AwardKind)).toEqual([
      'POINTS',
      'COUPON',
      'FREEZE',
      'PERK',
    ]);
    expect(Object.values(BadgeSubject)).toEqual([
      'SERVICE',
      'BARBER',
      'LOCATION',
    ]);
    expect(Object.values(SeasonKind)).toEqual(['SEASON', 'EVENT']);
    expect(Object.values(SeasonPhase)).toEqual(['ANNOUNCED', 'OPEN', 'ENDED']);
  });
});

describe('Gamification guards', () => {
  it('check untrusted text against the very dictionaries', () => {
    expect(Gamification.isBadgeCategoryKind('RHYTHM')).toBe(true);
    expect(Gamification.isBadgeCategoryKind('Rhythm')).toBe(false);
    expect(Gamification.isBadgeEmblem('beardOil')).toBe(true);
    expect(Gamification.isBadgeEmblem('season')).toBe(false); // retired, wave D r6
    expect(Gamification.isMetric('client.months.distinct')).toBe(true);
    expect(Gamification.isMetric('client.months')).toBe(false);
    expect(Gamification.isPerkId('perk.freeReschedule')).toBe(true);
    expect(Gamification.isPerkId(42)).toBe(false);
  });

  it('knows the per-visit metrics and the one driven by the calendar', () => {
    expect(Gamification.isPerVisitMetric(Metric.VisitsOnTime)).toBe(true);
    expect(Gamification.isPerVisitMetric(Metric.VisitsWeekend)).toBe(false);
    const tenure: MetricRef = MetricRef.of(Metric.TenureDays);
    const visits: MetricRef = {
      metric: Metric.VisitsCompleted,
      metricWindowDays: 365,
      metricScopeServiceId: null,
      metricScopeBarberId: null,
      metricScopeLocationId: LocationId.of('loc-center'),
    };
    expect(Gamification.isCalendarDriven(tenure)).toBe(true);
    expect(Gamification.isCalendarDriven(visits)).toBe(false);
    // A family that counts nothing (today's `metric: null`): all-null slice.
    expect(Gamification.isCalendarDriven(MetricRef.none())).toBe(false);
  });

  it('flattens what a family counts: a bare metric, or nothing at all', () => {
    expect(MetricRef.of(Metric.VisitsCompleted)).toEqual({
      metric: 'client.visits.completed',
      metricWindowDays: null,
      metricScopeServiceId: null,
      metricScopeBarberId: null,
      metricScopeLocationId: null,
    });
    expect(MetricRef.none()).toEqual({
      metric: null,
      metricWindowDays: null,
      metricScopeServiceId: null,
      metricScopeBarberId: null,
      metricScopeLocationId: null,
    });
  });

  it('announces a season thirty days ahead', () => {
    expect(Gamification.SEASON_NOTICE_DAYS).toBe(30);
  });

  it.each<[AwardSummary, boolean]>([
    [AwardSummary.points(50), true],
    [AwardSummary.points(0), false],
    [AwardSummary.points(2.5), false],
    [AwardSummary.freeze(1), true],
    [AwardSummary.freeze(-1), false],
    [AwardSummary.perk(PerkId.FreeReschedule, null), true],
    [AwardSummary.perk(PerkId.FreeReschedule, 30), true],
    [AwardSummary.perk(PerkId.FreeReschedule, 0), false],
    [AwardSummary.coupon({ bg: 'Купон', en: 'Coupon' }), true],
  ])('judges %j positive: %s', (award, positive) => {
    expect(Gamification.isAwardPositive(award)).toBe(positive);
  });
});

describe('AwardSummary / BadgeSubjectSlot — each flat variant built from its tag', () => {
  it('stamps the award kind from the dictionary, every figure prefixed `award`', () => {
    expect(AwardSummary.points(50)).toEqual({
      awardKind: AwardKind.Points,
      awardPoints: 50,
    });
    expect(AwardSummary.freeze(2)).toEqual({
      awardKind: AwardKind.Freeze,
      awardFreezeCount: 2,
    });
    expect(AwardSummary.perk(PerkId.PriorityWaitlist, null)).toEqual({
      awardKind: AwardKind.Perk,
      awardPerkId: PerkId.PriorityWaitlist,
      awardPerkForDays: null,
    });
    expect(AwardSummary.coupon({ bg: 'Купон', en: 'Coupon' })).toEqual({
      awardKind: AwardKind.Coupon,
      awardCouponTitle: { bg: 'Купон', en: 'Coupon' },
    });
  });

  it('stamps the subject from the dictionary, each variant declaring only its own id', () => {
    expect(BadgeSubjectSlot.service(ServiceId.of('svc-cut'))).toEqual({
      badgeSubject: BadgeSubject.Service,
      subjectServiceId: 'svc-cut',
    });
    expect(BadgeSubjectSlot.barber(BarberId.of('ivan'))).toEqual({
      badgeSubject: BadgeSubject.Barber,
      subjectBarberId: 'ivan',
    });
    expect(BadgeSubjectSlot.location(LocationId.of('loc-1'))).toEqual({
      badgeSubject: BadgeSubject.Location,
      subjectLocationId: 'loc-1',
    });
    // Today's `subject: null` is the slice's own variant.
    expect(BadgeSubjectSlot.none()).toEqual({ badgeSubject: null });
  });
});
