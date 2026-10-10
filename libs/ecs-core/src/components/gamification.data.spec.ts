import { describe, expect, it } from 'vitest';
import { BarberId } from '../entities/barber.entity';
import { LocationId } from '../entities/location.entity';
import { ServiceId } from '../entities/service.entity';
import {
  AwardKind,
  AwardSummary,
  BadgeSubject,
  BADGE_CATEGORY_KINDS,
  BADGE_EMBLEMS,
  BadgeSubjectKind,
  Gamification,
  METRICS,
  Metric,
  PER_VISIT_METRICS,
  PERK_IDS,
  SeasonKind,
  SeasonPhase,
  PerkId,
  type MetricRef,
} from './gamification.data';

describe('the loyalty catalogue vocabularies', () => {
  it('keep the stored strings of the legacy tuples, in their order', () => {
    expect(BADGE_CATEGORY_KINDS).toEqual([
      'milestones',
      'mastery',
      'barbers',
      'rhythm',
      'special',
      'records',
    ]);
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
      'points',
      'coupon',
      'freeze',
      'perk',
    ]);
    expect(Object.values(BadgeSubjectKind)).toEqual([
      'service',
      'barber',
      'location',
    ]);
    expect(Object.values(SeasonKind)).toEqual(['season', 'event']);
    expect(Object.values(SeasonPhase)).toEqual(['announced', 'open', 'ended']);
  });
});

describe('Gamification guards', () => {
  it('check untrusted text against the very dictionaries', () => {
    expect(Gamification.isBadgeCategoryKind('rhythm')).toBe(true);
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
    const tenure: MetricRef = {
      metric: Metric.TenureDays,
      window: null,
      where: null,
    };
    const visits: MetricRef = {
      metric: Metric.VisitsCompleted,
      window: { lastDays: 365 },
      where: {
        serviceId: null,
        barberId: null,
        locationId: 'loc-center' as LocationId,
      },
    };
    expect(Gamification.isCalendarDriven(tenure)).toBe(true);
    expect(Gamification.isCalendarDriven(visits)).toBe(false);
    expect(Gamification.isCalendarDriven(null)).toBe(false);
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

describe('AwardSummary / BadgeSubject — each variant built from its tag', () => {
  it('stamps the award kind from the dictionary', () => {
    expect(AwardSummary.points(50)).toEqual({
      kind: AwardKind.Points,
      points: 50,
    });
    expect(AwardSummary.freeze(2)).toEqual({
      kind: AwardKind.Freeze,
      count: 2,
    });
    expect(AwardSummary.perk(PerkId.PriorityWaitlist, null)).toEqual({
      kind: AwardKind.Perk,
      perkId: PerkId.PriorityWaitlist,
      forDays: null,
    });
    expect(AwardSummary.coupon({ bg: 'Купон', en: 'Coupon' })).toEqual({
      kind: AwardKind.Coupon,
      title: { bg: 'Купон', en: 'Coupon' },
    });
  });

  it('stamps the subject kind from the dictionary', () => {
    expect(BadgeSubject.service(ServiceId.of('svc-cut'))).toEqual({
      kind: BadgeSubjectKind.Service,
      serviceId: 'svc-cut',
    });
    expect(BadgeSubject.barber(BarberId.of('ivan'))).toEqual({
      kind: BadgeSubjectKind.Barber,
      barberId: 'ivan',
    });
    expect(BadgeSubject.location(LocationId.of('loc-1'))).toEqual({
      kind: BadgeSubjectKind.Location,
      locationId: 'loc-1',
    });
  });
});
