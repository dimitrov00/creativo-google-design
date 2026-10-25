import type { BarberId, LocationId, ServiceId } from '@core/primitives';

/**
 * The metric registry: adding a metric is code, composing families is data
 * — the field `metric` of {@link MetricRef}. Stable catalogue identifiers
 * that keep their stored strings (flatten-spec §0.4).
 */
export const Metric = {
  /** Visits whose subject is the client: a visit's worked seats count once. */
  VisitsCompleted: 'client.visits.completed',
  BookingsSelfService: 'client.bookings.selfService',
  SpendMajor: 'client.spend.major',
  ReferralsCompleted: 'client.referrals.completed',
  WaitlistBooked: 'client.waitlist.booked',
  /** Rule, migration and system points only — manual points never count. */
  PointsLifetime: 'client.points.lifetime',
  ShopBookingsCreated: 'shop.bookings.created',
  ServicesDistinct: 'client.services.distinct',
  BarbersDistinct: 'client.barbers.distinct',
  LocationsDistinct: 'client.locations.distinct',
  /** Shop-calendar months with a worked visit. */
  MonthsDistinct: 'client.months.distinct',
  /** Worked visits starting by 10:00. */
  VisitsEarlyBird: 'client.visits.earlyBird',
  /** Worked visits on the shop's weekend day. */
  VisitsWeekend: 'client.visits.weekend',
  /** Worked visits the client arrived for by the start. */
  VisitsOnTime: 'client.visits.onTime',
  /** Worked visits booked with company. */
  VisitsParty: 'client.visits.party',
  /** Days since the first worked visit: calendar-driven, no visit moves it. */
  TenureDays: 'client.tenure.days',
} as const;
export type Metric = (typeof Metric)[keyof typeof Metric];

/**
 * The counts ONE worked visit moves by exactly one — the families a single
 * visit can complete together (the diversity rule's step 3, §4.2).
 */
const PER_VISIT_METRICS: readonly Metric[] = [
  Metric.VisitsCompleted,
  Metric.VisitsEarlyBird,
  Metric.VisitsOnTime,
];

/**
 * The counts made of VISITS — a kind of visit, or the distinct services,
 * barbers, shops and months the visits brought: a medal's «Как се печели»
 * ends on the exclusion (what never counts as a visit) for these only
 * (`medal-detail.presenter.ts` `countsVisits`).
 */
const VISIT_COUNTING_METRICS: readonly Metric[] = [
  Metric.VisitsCompleted,
  Metric.VisitsEarlyBird,
  Metric.VisitsWeekend,
  Metric.VisitsOnTime,
  Metric.VisitsParty,
  Metric.ServicesDistinct,
  Metric.BarbersDistinct,
  Metric.LocationsDistinct,
  Metric.MonthsDistinct,
];

/**
 * The counts of a KIND of visit — each worked visit of the kind is one:
 * a level's threshold is a number of visits («25 посещения»,
 * `medal-detail.presenter.ts` `countedInVisits`).
 */
const VISIT_KIND_METRICS: readonly Metric[] = [
  Metric.VisitsCompleted,
  Metric.VisitsEarlyBird,
  Metric.VisitsWeekend,
  Metric.VisitsOnTime,
  Metric.VisitsParty,
];

/**
 * What a family counts — a FLAT slice at the root of a family (and, as
 * `qualify*`, of a tier): the metric, its rolling window in whole days back
 * from today, and the scope narrowing a visit count to one service, barber
 * or location (a `null` part narrows nothing).
 *
 * Invariant (stated here, kept by every writer): `metric: null` — a one-off
 * act, or the rhythm family — holds every other field `null` too. A
 * season's families count inside the season's window, so they carry no
 * `metricWindowDays` of their own (`null`); three `null` scope fields count
 * everywhere (today's `where: null`, which the scope test reads the same way:
 * "every non-null part matches").
 */
export type MetricRef = {
  readonly metric: Metric | null;
  readonly metricWindowDays: number | null;
  readonly metricScopeServiceId: ServiceId | null;
  readonly metricScopeBarberId: BarberId | null;
  readonly metricScopeLocationId: LocationId | null;
};

/**
 * The slice's factories and the metric predicates the catalogue's rules
 * read, over the very lists the types are made of (pass D: the
 * `Gamification` predicates, homed on the component they judge).
 */
export const MetricRef = {
  /** {@link PER_VISIT_METRICS}: one worked visit moves each by exactly one. */
  PER_VISIT_METRICS,
  /** {@link VISIT_COUNTING_METRICS}: the counts made of visits. */
  VISIT_COUNTING_METRICS,
  /** {@link VISIT_KIND_METRICS}: the counts of a kind of visit. */
  VISIT_KIND_METRICS,

  /** A family that counts nothing (a one-off act, the rhythm). */
  none(): MetricRef {
    return {
      metric: null,
      metricWindowDays: null,
      metricScopeServiceId: null,
      metricScopeBarberId: null,
      metricScopeLocationId: null,
    };
  },

  /** A count of `metric`, everywhere, over the whole history. */
  of(metric: Metric): MetricRef {
    return {
      metric,
      metricWindowDays: null,
      metricScopeServiceId: null,
      metricScopeBarberId: null,
      metricScopeLocationId: null,
    };
  },

  /** One worked visit moves this count by exactly one. */
  isPerVisitMetric(metric: Metric): boolean {
    return PER_VISIT_METRICS.includes(metric);
  },

  /** A count made of visits ({@link VISIT_COUNTING_METRICS}); counting nothing (`null`) is none. */
  countsVisits(metric: Metric | null): boolean {
    return metric !== null && VISIT_COUNTING_METRICS.includes(metric);
  },

  /** A count of a kind of visit ({@link VISIT_KIND_METRICS}); counting nothing (`null`) is none. */
  isVisitKind(metric: Metric | null): boolean {
    return metric !== null && VISIT_KIND_METRICS.includes(metric);
  },

  /** Tenure: nothing a visit does moves it, so it never sits in «Скоро». */
  isCalendarDriven(ref: Pick<MetricRef, 'metric'>): boolean {
    return ref.metric === Metric.TenureDays;
  },
} as const;
