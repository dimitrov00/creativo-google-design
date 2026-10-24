import {
  type BarberId,
  type LocationId,
  type ServiceId,
  type LocalDate,
  AwardKind,
} from '@core/primitives';
import type { LocalizedText } from './localized-text.data';

/**
 * THE LOYALTY CATALOGUE'S CLOSED VOCABULARIES (client-card-redesign §4.1) —
 * `badge-vocabulary.ts` re-shaped from the tuple arrays `BADGE_CATEGORY_KINDS`,
 * `BADGE_EMBLEMS`, `METRICS`, `PERK_IDS` into object dictionaries (blueprint
 * §2.3). Code-level on purpose: a new value is a release, never data —
 * composing families out of these is data. A list survives only where code
 * iterates it, derived with `Object.values`. The tag dictionaries are
 * SCREAMING (Law 6); `BadgeEmblem`, `Metric` and `PerkId` are stable
 * catalogue identifiers and keep their stored strings (flatten-spec §0.4).
 *
 * Beside them, the flat slices a family is composed of — what it counts
 * (`MetricRef`), what a level paid (`AwardSummary`), what it is about
 * (`BadgeSubjectSlot`) — and the season vocabularies a window is drawn by.
 */

/**
 * A shelf of «Постижения» — the category's field `badgeCategoryKind`.
 * `RECORDS` holds no families: it is the personal-records rail.
 */
export const BadgeCategoryKind = {
  Milestones: 'MILESTONES',
  Mastery: 'MASTERY',
  Barbers: 'BARBERS',
  Rhythm: 'RHYTHM',
  Special: 'SPECIAL',
  Records: 'RECORDS',
} as const;
export type BadgeCategoryKind =
  (typeof BadgeCategoryKind)[keyof typeof BadgeCategoryKind];

/**
 * What a family or a season is drawn with when no art wins over it — a
 * domain id the feature maps to an icon key (`loyalty.badge.<emblem>`); no
 * icon key is ever stored. Two art-less families of one shelf or one
 * season never share one; a season's or an event's family never wears a
 * perennial family's face (§3.3, wave D r6).
 */
export const BadgeEmblem = {
  Visits: 'visits',
  Streak: 'streak',
  Referral: 'referral',
  SelfService: 'selfService',
  Birthday: 'birthday',
  Welcome: 'welcome',
  Service: 'service',
  Barber: 'barber',
  Shop: 'shop',
  Anniversary: 'anniversary',
  EarlyBird: 'earlyBird',
  Weekend: 'weekend',
  OnTime: 'onTime',
  Waitlist: 'waitlist',
  Profile: 'profile',
  Party: 'party',
  Explorer: 'explorer',
  /** A visit in each month of a rolling year («Цяла година»). */
  YearRound: 'yearRound',
  /** Back in rhythm after a break («Завръщане»). */
  Comeback: 'comeback',
  /** An event — «Седмица на брадата» in the archive. */
  Event: 'event',
  Summer: 'summer',
  Autumn: 'autumn',
  /** Visits close together before the holidays («Преди отпуска»). */
  Vacation: 'vacation',
  /** «Всеки летен месец» — a visit in every month of the summer. */
  Sailing: 'sailing',
  /** «Лятна събота» — a summer Saturday in the chair. */
  Icecream: 'icecream',
  /** «Всеки есенен месец» — a visit in every month of the autumn. */
  Umbrella: 'umbrella',
  /** «Есенно утро» — an early visit on an autumn morning. */
  Fog: 'fog',
  /** «Приятел наесен» — a friend brought in this season. */
  Handshake: 'handshake',
  /** «Есенна брада» — a beard kept through the season. */
  Grooming: 'grooming',
  /** «Брада на седмицата» — the beard of an event. */
  BeardOil: 'beardOil',
  /** «Пълна грижа на седмицата» — the whole treatment, in an event. */
  Spa: 'spa',
} as const;
export type BadgeEmblem = (typeof BadgeEmblem)[keyof typeof BadgeEmblem];

/** The metric registry: adding a metric is code, composing families is data. */
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
export const PER_VISIT_METRICS: readonly Metric[] = [
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
export const VISIT_COUNTING_METRICS: readonly Metric[] = [
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
export const VISIT_KIND_METRICS: readonly Metric[] = [
  Metric.VisitsCompleted,
  Metric.VisitsEarlyBird,
  Metric.VisitsWeekend,
  Metric.VisitsOnTime,
  Metric.VisitsParty,
];

export const PerkId = {
  PriorityWaitlist: 'perk.priorityWaitlist',
  BookFurtherAhead: 'perk.bookFurtherAhead',
  FreeReschedule: 'perk.freeReschedule',
} as const;
export type PerkId = (typeof PerkId)[keyof typeof PerkId];

/** What a family is about — the family's field `badgeSubject` (`null` = about nothing). */
export const BadgeSubject = {
  Service: 'SERVICE',
  Barber: 'BARBER',
  Location: 'LOCATION',
} as const;
export type BadgeSubject = (typeof BadgeSubject)[keyof typeof BadgeSubject];

/** A season has a track (the family its gauge draws); an event is a short window without one — the field `seasonKind`. */
export const SeasonKind = {
  Season: 'SEASON',
  Event: 'EVENT',
} as const;
export type SeasonKind = (typeof SeasonKind)[keyof typeof SeasonKind];

/** A window on a day: announced — shown «от 1.11», no progress yet; open; ended — archived. */
export const SeasonPhase = {
  Announced: 'ANNOUNCED',
  Open: 'OPEN',
  Ended: 'ENDED',
} as const;
export type SeasonPhase = (typeof SeasonPhase)[keyof typeof SeasonPhase];

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

export const MetricRef = {
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
} as const;

/**
 * What a level paid, for «донесе …» — an element of a level's `awards`
 * array, a union of FLAT variants on `awardKind`: a summary of its rule's
 * awards, so the card never reads a rule. Every figure is a positive whole
 * number; a perk's `awardPerkForDays: null` is for good.
 */
export type AwardSummary =
  | AwardSummary.Points
  | AwardSummary.Coupon
  | AwardSummary.Freeze
  | AwardSummary.Perk;

export const AwardSummary = {
  points(awardPoints: number): AwardSummary.Points {
    return { awardKind: AwardKind.Points, awardPoints };
  },
  coupon(awardCouponTitle: LocalizedText): AwardSummary.Coupon {
    return { awardKind: AwardKind.Coupon, awardCouponTitle };
  },
  freeze(awardFreezeCount: number): AwardSummary.Freeze {
    return { awardKind: AwardKind.Freeze, awardFreezeCount };
  },
  /** `awardPerkForDays: null` is for good. */
  perk(
    awardPerkId: PerkId,
    awardPerkForDays: number | null,
  ): AwardSummary.Perk {
    return { awardKind: AwardKind.Perk, awardPerkId, awardPerkForDays };
  },
} as const;

/**
 * The catalogue thing a family is about — a variant SLICE at the root of
 * the family (F-26), discriminated by `badgeSubject` (`null` = about
 * nothing). Each variant declares only its own id, so no system can read a
 * `subjectServiceId` off a BARBER family. Its art — the barber's face, the
 * service's or shop's cover — comes from it.
 */
export type BadgeSubjectSlot =
  | BadgeSubjectSlot.None
  | BadgeSubjectSlot.Service
  | BadgeSubjectSlot.Barber
  | BadgeSubjectSlot.Location;

export const BadgeSubjectSlot = {
  none(): BadgeSubjectSlot.None {
    return { badgeSubject: null };
  },
  service(subjectServiceId: ServiceId): BadgeSubjectSlot.Service {
    return { badgeSubject: BadgeSubject.Service, subjectServiceId };
  },
  barber(subjectBarberId: BarberId): BadgeSubjectSlot.Barber {
    return { badgeSubject: BadgeSubject.Barber, subjectBarberId };
  },
  location(subjectLocationId: LocationId): BadgeSubjectSlot.Location {
    return { badgeSubject: BadgeSubject.Location, subjectLocationId };
  },
} as const;

/**
 * A season's dated window in the shop's calendar, both ends inclusive — a
 * flat slice at the root of the season (`windowFrom`, `windowUntil`).
 */
export type SeasonWindow = {
  readonly windowFrom: LocalDate;
  readonly windowUntil: LocalDate;
};

/** Is `raw` one of `values`? The one scan every metric list shares. */
function oneOf<T extends string>(values: readonly T[], raw: unknown): raw is T {
  for (let i = 0; i < values.length; i++) {
    if (values[i] === raw) return true;
  }
  return false;
}

/**
 * The catalogue's constants and the metric predicates its rules read, over
 * the very dictionaries the types are made of.
 */
export const Gamification = {
  /**
   * How far ahead a season is announced: the loyalty policy's rule-change
   * notice (R29). A season changes what earns, so the client hears of it
   * before it counts.
   */
  SEASON_NOTICE_DAYS: 30,

  /** One worked visit moves this count by exactly one. */
  isPerVisitMetric(metric: Metric): boolean {
    return oneOf(PER_VISIT_METRICS, metric);
  },
  /** A count made of visits ({@link VISIT_COUNTING_METRICS}); counting nothing (`null`) is none. */
  countsVisits(metric: Metric | null): boolean {
    return metric !== null && oneOf(VISIT_COUNTING_METRICS, metric);
  },
  /** A count of a kind of visit ({@link VISIT_KIND_METRICS}); counting nothing (`null`) is none. */
  isVisitKind(metric: Metric | null): boolean {
    return metric !== null && oneOf(VISIT_KIND_METRICS, metric);
  },
  /** Tenure: nothing a visit does moves it, so it never sits in «Скоро». */
  isCalendarDriven(ref: Pick<MetricRef, 'metric'>): boolean {
    return ref.metric === Metric.TenureDays;
  },
  /**
   * A paid award is a positive whole number of what it pays — a perk for
   * good (`awardPerkForDays: null`) or for a positive number of days; a
   * coupon's title is judged by its own text guard. The `awardOf` check of
   * `badge-series.ts`.
   */
  isAwardPositive(award: AwardSummary): boolean {
    switch (award.awardKind) {
      case AwardKind.Points:
        return positiveWhole(award.awardPoints);
      case AwardKind.Freeze:
        return positiveWhole(award.awardFreezeCount);
      case AwardKind.Perk:
        return (
          award.awardPerkForDays === null ||
          positiveWhole(award.awardPerkForDays)
        );
      default:
        return true;
    }
  },
} as const;

function positiveWhole(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}

export namespace AwardSummary {
  export type Points = {
    readonly awardKind: typeof AwardKind.Points;
    readonly awardPoints: number;
  };
  export type Coupon = {
    readonly awardKind: typeof AwardKind.Coupon;
    readonly awardCouponTitle: LocalizedText;
  };
  export type Freeze = {
    readonly awardKind: typeof AwardKind.Freeze;
    readonly awardFreezeCount: number;
  };
  export type Perk = {
    readonly awardKind: typeof AwardKind.Perk;
    readonly awardPerkId: PerkId;
    /** `null` = for good. */
    readonly awardPerkForDays: number | null;
  };
}

export namespace BadgeSubjectSlot {
  /** About nothing in particular (today's `subject: null`). */
  export type None = { readonly badgeSubject: null };
  export type Service = {
    readonly badgeSubject: typeof BadgeSubject.Service;
    readonly subjectServiceId: ServiceId;
  };
  export type Barber = {
    readonly badgeSubject: typeof BadgeSubject.Barber;
    readonly subjectBarberId: BarberId;
  };
  export type Location = {
    readonly badgeSubject: typeof BadgeSubject.Location;
    readonly subjectLocationId: LocationId;
  };
}
