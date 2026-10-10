import type { BarberId } from '../entities/barber.entity';
import type { LocationId } from '../entities/location.entity';
import type { ServiceId } from '../entities/service.entity';
import type { DayKey } from './day-key.data';
import type { LocalizedText } from './localized-text.data';

/**
 * THE LOYALTY CATALOGUE'S CLOSED VOCABULARIES (client-card-redesign §4.1) —
 * `badge-vocabulary.ts` re-shaped from the tuple arrays `BADGE_CATEGORY_KINDS`,
 * `BADGE_EMBLEMS`, `METRICS`, `PERK_IDS` into object dictionaries, the stored
 * strings unchanged (blueprint §2.3). Code-level on purpose: a new value is
 * a release, never data — composing families out of these is data. A list
 * survives only where code iterates it, derived with `Object.values`.
 *
 * Beside them, the structs a family is composed of — what it counts
 * (`MetricRef`), what a level paid (`AwardSummary`), what it is about
 * (`BadgeSubject`) — and the season vocabularies a window is drawn by.
 */

/** A shelf of «Постижения». `records` holds no families: it is the personal-records rail. */
export const BadgeCategoryKind = {
  Milestones: 'milestones',
  Mastery: 'mastery',
  Barbers: 'barbers',
  Rhythm: 'rhythm',
  Special: 'special',
  Records: 'records',
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

export const PerkId = {
  PriorityWaitlist: 'perk.priorityWaitlist',
  BookFurtherAhead: 'perk.bookFurtherAhead',
  FreeReschedule: 'perk.freeReschedule',
} as const;
export type PerkId = (typeof PerkId)[keyof typeof PerkId];

/** What a level paid, by kind. */
export const AwardKind = {
  Points: 'points',
  Coupon: 'coupon',
  Freeze: 'freeze',
  Perk: 'perk',
} as const;
export type AwardKind = (typeof AwardKind)[keyof typeof AwardKind];

/** What a family is about, by kind. */
export const BadgeSubjectKind = {
  Service: 'service',
  Barber: 'barber',
  Location: 'location',
} as const;
export type BadgeSubjectKind =
  (typeof BadgeSubjectKind)[keyof typeof BadgeSubjectKind];

/** A season has a track (the family its gauge draws); an event is a short window without one. */
export const SeasonKind = {
  Season: 'season',
  Event: 'event',
} as const;
export type SeasonKind = (typeof SeasonKind)[keyof typeof SeasonKind];

/** A window on a day: announced — shown «от 1.11», no progress yet; open; ended — archived. */
export const SeasonPhase = {
  Announced: 'announced',
  Open: 'open',
  Ended: 'ended',
} as const;
export type SeasonPhase = (typeof SeasonPhase)[keyof typeof SeasonPhase];

/** Every value of each vocabulary, dictionary order — derived, never a second source. */
export const BADGE_CATEGORY_KINDS: readonly BadgeCategoryKind[] =
  Object.values(BadgeCategoryKind);
export const BADGE_EMBLEMS: readonly BadgeEmblem[] = Object.values(BadgeEmblem);
export const METRICS: readonly Metric[] = Object.values(Metric);
export const PERK_IDS: readonly PerkId[] = Object.values(PerkId);

/** A rolling window, in whole days back from today. */
export type MetricWindow = { readonly lastDays: number };

/**
 * Narrows a visit count to one service, barber or location; a `null` part
 * narrows nothing. Every part is present (absent is `null`), so every scope
 * shares one hidden class — today's `where` holds only the parts it uses.
 */
export type MetricScope = {
  readonly serviceId: ServiceId | null;
  readonly barberId: BarberId | null;
  readonly locationId: LocationId | null;
};

/**
 * What a family counts. A season's families count inside the season's
 * window, so they carry no `window` of their own (`null`); `where: null`
 * counts everywhere. Today both are ABSENT when unused — they are an
 * explicit `null` now (absent is `null`, §2.6).
 */
export type MetricRef = {
  readonly metric: Metric;
  readonly window: MetricWindow | null;
  readonly where: MetricScope | null;
};

/**
 * What a level paid, for «донесе …»: a summary of its rule's awards, so the
 * card never reads a rule. Every figure is a positive whole number; a perk's
 * `forDays: null` is for good.
 */
export type AwardSummary =
  | AwardSummary.Points
  | AwardSummary.Coupon
  | AwardSummary.Freeze
  | AwardSummary.Perk;

export const AwardSummary = {
  points(points: number): AwardSummary.Points {
    return { kind: AwardKind.Points, points };
  },
  coupon(title: LocalizedText): AwardSummary.Coupon {
    return { kind: AwardKind.Coupon, title };
  },
  freeze(count: number): AwardSummary.Freeze {
    return { kind: AwardKind.Freeze, count };
  },
  /** `forDays: null` is for good. */
  perk(perkId: PerkId, forDays: number | null): AwardSummary.Perk {
    return { kind: AwardKind.Perk, perkId, forDays };
  },
} as const;

/** The catalogue thing a family is about; its art — the barber's face, the service's or shop's cover — comes from it. */
export type BadgeSubject =
  BadgeSubject.Service | BadgeSubject.Barber | BadgeSubject.Location;

export const BadgeSubject = {
  service(serviceId: ServiceId): BadgeSubject.Service {
    return { kind: BadgeSubjectKind.Service, serviceId };
  },
  barber(barberId: BarberId): BadgeSubject.Barber {
    return { kind: BadgeSubjectKind.Barber, barberId };
  },
  location(locationId: LocationId): BadgeSubject.Location {
    return { kind: BadgeSubjectKind.Location, locationId };
  },
} as const;

/** `{ from, until }`: a season's dated window in the shop's calendar, both ends inclusive. */
export type SeasonWindow = {
  readonly from: DayKey;
  readonly until: DayKey;
};

/** Is `raw` one of `values`? The one guard every vocabulary shares. */
function oneOf<T extends string>(values: readonly T[], raw: unknown): raw is T {
  for (let i = 0; i < values.length; i++) {
    if (values[i] === raw) return true;
  }
  return false;
}

/**
 * The vocabularies' edge guards and the catalogue's constants — what a
 * reader checks untrusted text against, from the very dictionaries the
 * types are made of.
 */
export const Gamification = {
  /**
   * How far ahead a season is announced: the loyalty policy's rule-change
   * notice (R29). A season changes what earns, so the client hears of it
   * before it counts.
   */
  SEASON_NOTICE_DAYS: 30,

  isBadgeCategoryKind(raw: unknown): raw is BadgeCategoryKind {
    return oneOf(BADGE_CATEGORY_KINDS, raw);
  },
  isBadgeEmblem(raw: unknown): raw is BadgeEmblem {
    return oneOf(BADGE_EMBLEMS, raw);
  },
  isMetric(raw: unknown): raw is Metric {
    return oneOf(METRICS, raw);
  },
  isPerkId(raw: unknown): raw is PerkId {
    return oneOf(PERK_IDS, raw);
  },
  /** One worked visit moves this count by exactly one. */
  isPerVisitMetric(metric: Metric): boolean {
    return oneOf(PER_VISIT_METRICS, metric);
  },
  /** Tenure: nothing a visit does moves it, so it never sits in «Скоро». */
  isCalendarDriven(ref: MetricRef | null): boolean {
    return ref !== null && ref.metric === Metric.TenureDays;
  },
  /**
   * A paid award is a positive whole number of what it pays — a perk for
   * good (`forDays: null`) or for a positive number of days; a coupon's
   * title is judged by its own text guard. The `awardOf` check of
   * `badge-series.ts`.
   */
  isAwardPositive(award: AwardSummary): boolean {
    switch (award.kind) {
      case AwardKind.Points:
        return positiveWhole(award.points);
      case AwardKind.Freeze:
        return positiveWhole(award.count);
      case AwardKind.Perk:
        return award.forDays === null || positiveWhole(award.forDays);
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
    readonly kind: typeof AwardKind.Points;
    readonly points: number;
  };
  export type Coupon = {
    readonly kind: typeof AwardKind.Coupon;
    readonly title: LocalizedText;
  };
  export type Freeze = {
    readonly kind: typeof AwardKind.Freeze;
    readonly count: number;
  };
  export type Perk = {
    readonly kind: typeof AwardKind.Perk;
    readonly perkId: PerkId;
    /** `null` = for good. */
    readonly forDays: number | null;
  };
}

export namespace BadgeSubject {
  export type Service = {
    readonly kind: typeof BadgeSubjectKind.Service;
    readonly serviceId: ServiceId;
  };
  export type Barber = {
    readonly kind: typeof BadgeSubjectKind.Barber;
    readonly barberId: BarberId;
  };
  export type Location = {
    readonly kind: typeof BadgeSubjectKind.Location;
    readonly locationId: LocationId;
  };
}
