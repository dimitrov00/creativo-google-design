import { describe, expect, it } from 'vitest';
import { BarberId, LocationId, ServiceId, AwardKind } from '@core/primitives';
import {
  AwardSummary,
  BadgeCategoryKind,
  BadgeEmblem,
  BadgeSubject,
  BadgeSubjectSlot,
  Gamification,
  Metric,
  MetricRef,
  PER_VISIT_METRICS,
  SeasonKind,
  SeasonPhase,
  PerkId,
  VISIT_COUNTING_METRICS,
  VISIT_KIND_METRICS,
} from './gamification.data';

const METRICS = Object.values(Metric);

describe('the loyalty catalogue vocabularies', () => {
  it('declare the tags SCREAMING and keep the catalogue ids, in their order', () => {
    expect(Object.values(BadgeCategoryKind)).toEqual([
      'MILESTONES',
      'MASTERY',
      'BARBERS',
      'RHYTHM',
      'SPECIAL',
      'RECORDS',
    ]);
    // Art asset names and catalogue ids are external keys (flatten-spec §0.4).
    const emblems = Object.values(BadgeEmblem);
    expect(emblems).toHaveLength(31);
    expect(emblems.slice(0, 3)).toEqual(['visits', 'streak', 'referral']);
    expect(emblems.at(-1)).toBe('spa');
    expect(new Set(emblems).size).toBe(emblems.length);
    expect(emblems).not.toContain('season'); // retired, wave D r6
    expect(METRICS).toHaveLength(16);
    expect(METRICS[0]).toBe('client.visits.completed');
    expect(METRICS.at(-1)).toBe('client.tenure.days');
    expect(Object.values(PerkId)).toEqual([
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

describe('Gamification predicates', () => {
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

  /*
   * The two metric sets of a medal's detail page (`medal-detail.presenter.ts`
   * `countsVisits` — «Как се печели» ends on the exclusion — and
   * `countedInVisits` — a level's threshold is «25 посещения»), each case
   * of the presenter's spec as a metric: «says the exclusion once, and only
   * where visits are counted» and «says a threshold in the fewest words
   * where visits are counted».
   */
  it('knows the counts made of visits: a kind of visit, or the distinct things visits brought', () => {
    expect(VISIT_COUNTING_METRICS).toEqual([
      'client.visits.completed',
      'client.visits.earlyBird',
      'client.visits.weekend',
      'client.visits.onTime',
      'client.visits.party',
      'client.services.distinct',
      'client.barbers.distinct',
      'client.locations.distinct',
      'client.months.distinct',
    ]);
    for (const metric of VISIT_COUNTING_METRICS) {
      expect([metric, Gamification.countsVisits(metric)]).toEqual([
        metric,
        true,
      ]);
    }
    for (const metric of [
      Metric.BookingsSelfService,
      Metric.SpendMajor,
      Metric.ReferralsCompleted,
      Metric.WaitlistBooked,
      Metric.PointsLifetime,
      Metric.ShopBookingsCreated,
      Metric.TenureDays,
    ]) {
      expect([metric, Gamification.countsVisits(metric)]).toEqual([
        metric,
        false,
      ]);
    }
    // A single act and the rhythm count nothing: no exclusion to say.
    expect(Gamification.countsVisits(null)).toBe(false);
  });

  it('knows the counts of a kind of visit, whose thresholds are a number of visits', () => {
    expect(VISIT_KIND_METRICS).toEqual([
      'client.visits.completed',
      'client.visits.earlyBird',
      'client.visits.weekend',
      'client.visits.onTime',
      'client.visits.party',
    ]);
    for (const metric of METRICS) {
      expect([metric, Gamification.isVisitKind(metric)]).toEqual([
        metric,
        VISIT_KIND_METRICS.includes(metric),
      ]);
    }
    // The distinct counts are made of visits, yet their threshold is not.
    expect(Gamification.isVisitKind(Metric.ServicesDistinct)).toBe(false);
    expect(Gamification.countsVisits(Metric.ServicesDistinct)).toBe(true);
    expect(Gamification.isVisitKind(null)).toBe(false);
    // Every kind of visit is a count made of visits.
    for (const metric of VISIT_KIND_METRICS) {
      expect(VISIT_COUNTING_METRICS).toContain(metric);
    }
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
