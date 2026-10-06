import type {
  BarberId,
  LocalizedText,
  LocationId,
  ServiceId,
} from '@creativo/domain/catalog';

/**
 * The loyalty catalogue's closed vocabularies (client-card-redesign §4.1).
 * Code-level on purpose: a new value is a release, never data — composing
 * FAMILIES out of these is data. Each is a readonly list first, so a reader
 * can check untrusted text against the very list the type is made from.
 */

/** Is `raw` one of `values`? The one guard every vocabulary shares. */
export function isOneOf<const T extends string>(
  values: readonly T[],
  raw: unknown,
): raw is T {
  return typeof raw === 'string' && (values as readonly string[]).includes(raw);
}

/** A shelf of «Постижения». `records` holds no families: it is the personal-records rail. */
export const BADGE_CATEGORY_KINDS = [
  'milestones',
  'mastery',
  'barbers',
  'rhythm',
  'special',
  'records',
] as const;
export type BadgeCategoryKind = (typeof BADGE_CATEGORY_KINDS)[number];

/**
 * What a family or a season is drawn with, when no art wins over it. A
 * domain id, mapped to an icon key in the feature (`loyalty.badge.<emblem>`);
 * no icon key is ever stored.
 *
 * A family is drawn with its OWN emblem: two art-less families of one
 * shelf or one season never share one, or the shelf becomes a row of
 * identical discs told apart only by their titles (§3.3). So the rhythm
 * shelf's three families each name what they count — `streak`,
 * `yearRound`, `comeback` — never three calendars. Nor does a season's or
 * an event's family ever wear a perennial family's face, and a season
 * wears its season of the year (§3.3.3, wave D r6). Every value is drawn
 * by the catalogue this build ships: none is dead vocabulary (§8.2).
 */
export const BADGE_EMBLEMS = [
  'visits',
  'streak',
  'referral',
  'selfService',
  'birthday',
  'welcome',
  'service',
  'barber',
  'shop',
  'anniversary',
  'earlyBird',
  'weekend',
  'onTime',
  'waitlist',
  'profile',
  'party',
  'explorer',
  /** A visit in each month of a rolling year («Цяла година»). */
  'yearRound',
  /** Back in rhythm after a break («Завръщане»). */
  'comeback',
  /** An event — «Седмица на брадата» in the archive. */
  'event',
  /*
   * SEASONS AND EVENTS WEAR FACES OF THEIR OWN (wave D r6). A season is
   * drawn with its season of the year — the season, its track and its
   * archive row — so a year of seasons is four faces, never a grid of one
   * rosette (`season` retired; `spring` and `winter` join with the first
   * season the catalogue opens in them). And a season's or an event's
   * family never borrows a perennial family's face (the sunrise, the sofa,
   * the service's cover): it is a limited edition, drawn with an emblem of
   * its own, so «Есенно утро» is not «Ранобудник», «Есенна брада» not
   * «Оформяне на брада», and «Всеки есенен месец» not «Всеки летен месец»
   * (`seasonMonthly` retired).
   */
  'summer',
  'autumn',
  /** Visits close together before the holidays («Преди отпуска»). */
  'vacation',
  /** «Всеки летен месец» — a visit in every month of the summer. */
  'sailing',
  /** «Лятна събота» — a summer Saturday in the chair. */
  'icecream',
  /** «Всеки есенен месец» — a visit in every month of the autumn, rain or shine. */
  'umbrella',
  /** «Есенно утро» — an early visit on an autumn morning. */
  'fog',
  /** «Приятел наесен» — a friend brought in this season. */
  'handshake',
  /** «Есенна брада» — a beard kept through the season. */
  'grooming',
  /** «Брада на седмицата» — the beard of an event. */
  'beardOil',
  /** «Пълна грижа на седмицата» — the whole treatment, in an event. */
  'spa',
] as const;
export type BadgeEmblem = (typeof BADGE_EMBLEMS)[number];

/** The metric registry: adding a metric is code, composing families is data. */
export const METRICS = [
  /** Visits whose subject is the client: a visit's worked seats count once. */
  'client.visits.completed',
  'client.bookings.selfService',
  'client.spend.major',
  'client.referrals.completed',
  'client.waitlist.booked',
  /** Rule, migration and system points only — manual points never count. */
  'client.points.lifetime',
  'shop.bookings.created',
  'client.services.distinct',
  'client.barbers.distinct',
  'client.locations.distinct',
  /** Europe/Sofia calendar months with a worked visit. */
  'client.months.distinct',
  /** Worked visits starting by 10:00. */
  'client.visits.earlyBird',
  /** Worked visits on the shop's weekend day. */
  'client.visits.weekend',
  /** Worked visits the client arrived for by the start. */
  'client.visits.onTime',
  /** Worked visits booked with company. */
  'client.visits.party',
  /** Days since the first worked visit: calendar-driven, no visit moves it. */
  'client.tenure.days',
] as const;
export type Metric = (typeof METRICS)[number];

/**
 * The counts ONE worked visit moves by exactly one — the families a single
 * visit can complete together (the diversity rule's step 3, §4.2).
 */
export const PER_VISIT_METRICS: readonly Metric[] = [
  'client.visits.completed',
  'client.visits.earlyBird',
  'client.visits.onTime',
];

/** What a family counts. A season's families count inside the season's window, so they carry no window of their own. */
export interface MetricRef {
  readonly metric: Metric;
  readonly window?: { readonly lastDays: number };
  /** Narrows a visit count to one service, barber or location. */
  readonly where?: {
    readonly serviceId?: ServiceId;
    readonly barberId?: BarberId;
    readonly locationId?: LocationId;
  };
}

export const PERK_IDS = [
  'perk.priorityWaitlist',
  'perk.bookFurtherAhead',
  'perk.freeReschedule',
] as const;
export type PerkId = (typeof PERK_IDS)[number];

/**
 * What a level paid, for «донесе …»: a summary of its rule's awards, so
 * the card never reads a rule.
 */
export type AwardSummary =
  | { readonly kind: 'points'; readonly points: number }
  | { readonly kind: 'coupon'; readonly title: LocalizedText }
  | { readonly kind: 'freeze'; readonly count: number }
  | {
      readonly kind: 'perk';
      readonly perkId: PerkId;
      readonly forDays: number | null;
    };

/** The catalogue thing a family is about; its art — the barber's face, the service's or shop's cover — comes from it. */
export type BadgeSubject =
  | { readonly kind: 'service'; readonly serviceId: ServiceId }
  | { readonly kind: 'barber'; readonly barberId: BarberId }
  | { readonly kind: 'location'; readonly locationId: LocationId };
