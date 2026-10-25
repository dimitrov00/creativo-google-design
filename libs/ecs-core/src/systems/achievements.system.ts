import {
  BadgeEmblem,
  BadgeSubject,
  type EarnedLevel,
  Metric,
  type MetricRef,
  type Seat,
  SeasonPhase,
  type SeasonWindow,
  type SeriesStanding,
} from '@core/components';
import type { Appointment, BadgeSeries } from '@core/entities';
import {
  AttendanceState,
  Weekday,
  type AppointmentId,
  type BarberId,
  type CustomerId,
  type LocationId,
  type ServiceId,
  LocalDate,
  type MinuteOfDay,
  UtcEpochMs,
} from '@core/primitives';
import { BadgeSystem } from './badge.system';
import { ClientStatsSystem } from './client-stats.system';
import { type VisitEditView, WalletSystem } from './wallet.system';

/*
 * DID THIS VISIT COUNT TOWARDS THE FAMILY? (client-card revision 3 §2.4,
 * `medal-detail.presenter.ts:243` `countsToward`, `:296` `insideWindows`) —
 * the projection's own reading of a visit (`tools/seed/loyalty.mjs`
 * `workedVisitsOf`, `metricValue`), so the visits a medal page lists under
 * «Броени посещения» and the figure over them can never tell two stories:
 *
 * - only the person's own WORKED seats count (the caller hands those over:
 *   an hour still to come, a cancelled one, a no-show and a companion's
 *   seat say nothing about the person);
 * - a count narrowed to a service, a barber or a shop asks for it among
 *   those seats — the service ITSELF, never a bundle holding it;
 * - an early bird began by 10:00 and a weekend visit fell on a Saturday or
 *   a Sunday — on the shop's wall clock (`startMinutes`, `weekday`, T1); a
 *   punctual one was marked arrived by its start — two lifecycle stamps
 *   compared (`arrivedAtUtcMs` against `startUtcMs`, T2); a visit with
 *   company has someone else's seat on it.
 *
 * A family that counts no single visit answers `false` for every visit: a
 * single act and the rhythm (`metric: null`), bookings, referrals, money,
 * points and tenure, and the DISTINCT counts (which visit first brought a
 * new service cannot be told from one visit, nor from a history in pages).
 */

/** The last minute a visit may start and still count as an early bird (10:00). */
const EARLY_BIRD_LAST_MINUTE = 10 * 60;

/**
 * What `countsToward` reads of a visit — a WORKED one ({@link CountedVisit})
 * or the draft on screen ({@link CountedDraft}). A fact the visit does not
 * hold yet is `null`, and a `null` never counts: no shop is in no shop, no
 * start is neither early nor on a weekend nor punctual.
 */
export type CountableVisit = {
  readonly serviceIds: readonly ServiceId[];
  readonly barberIds: readonly BarberId[];
  readonly locationId: LocationId | null;
  readonly startMinutes: MinuteOfDay | null;
  readonly weekday: Weekday | null;
  readonly startUtcMs: UtcEpochMs | null;
  readonly arrivedAtUtcMs: UtcEpochMs | null;
  readonly withCompany: boolean;
};

/** One appointment as the person's WORKED visit — what `countsToward` reads. */
export type CountedVisit = {
  /** The services of the person's own worked seats. */
  readonly serviceIds: readonly ServiceId[];
  /** The barbers of the person's own worked seats. */
  readonly barberIds: readonly BarberId[];
  readonly locationId: LocationId;
  /** The shop day the person's own first worked seat began on. */
  readonly localDate: LocalDate;
  /** That start on the shop's wall clock. */
  readonly startMinutes: MinuteOfDay;
  /** The ISO weekday of `localDate`. */
  readonly weekday: Weekday;
  /** That start as an instant — what a punctual arrival is compared with (T2). */
  readonly startUtcMs: UtcEpochMs;
  /** When the arrival was marked; `null` = never. */
  readonly arrivedAtUtcMs: UtcEpochMs | null;
  /** Someone else holds a seat on the visit. */
  readonly withCompany: boolean;
};

/**
 * One appointment as the person's WORKED visit, zone-free — what
 * `workedVisitOf` reads off the appointment. The edge adds the start's
 * instant (`startUtcMs`, through `ZonedTimeSystem.toUtc` on the shop's zone)
 * and so builds the {@link CountedVisit}: a system never converts zones.
 */
export type WorkedVisitFacts = Omit<CountedVisit, 'startUtcMs'>;

/**
 * The visit on screen as «с това посещение» reads it
 * (`achievements.presenter.ts` `completesWithThisVisit`): its legs'
 * services and barbers, the draft's shop, the minute of the shop's day its
 * first leg starts on (`null` = no start yet, the edge reads it on the
 * shop's clock) and whether it is the client's birthday visit.
 */
export type DraftVisit = {
  readonly serviceIds: readonly ServiceId[];
  readonly barberIds: readonly BarberId[];
  readonly locationId: LocationId | null;
  readonly startMinutes: MinuteOfDay | null;
  readonly birthdayToday: boolean;
};

/**
 * The visit on screen as a draft the counting rule can judge
 * (`countedDraft`): when its first service starts — the shop day, the
 * minute and the instant, `null` = no start yet (the edge reads them on
 * the shop's zone) — its legs' services and barbers, and its shop
 * (`null` = none yet).
 */
export type CountedDraftInput = {
  readonly start: {
    readonly localDate: LocalDate;
    readonly minute: MinuteOfDay;
    readonly utcMs: UtcEpochMs;
  } | null;
  readonly serviceIds: readonly ServiceId[];
  readonly barberIds: readonly BarberId[];
  readonly locationId: LocationId | null;
};

/**
 * The visit on screen as the counting rule judges it (`countedDraft`): its
 * legs' services and barbers, its shop, and when its first service starts
 * — the shop day, the minute, its weekday and the instant — each `null`
 * while the draft holds none (no shop yet, no start yet). A draft has no
 * arrival and no company: what only the day itself decides is not
 * promised.
 */
export type CountedDraft = {
  readonly serviceIds: readonly ServiceId[];
  readonly barberIds: readonly BarberId[];
  readonly locationId: LocationId | null;
  readonly localDate: LocalDate | null;
  readonly startMinutes: MinuteOfDay | null;
  readonly weekday: Weekday | null;
  readonly startUtcMs: UtcEpochMs | null;
  readonly arrivedAtUtcMs: null;
  readonly withCompany: false;
};

/** The appointment fields «Броени посещения» orders and windows by. */
export type CountedAppointment = {
  readonly id: AppointmentId;
  readonly localDate: LocalDate;
  readonly utcEpochMs: UtcEpochMs;
};

/**
 * One loaded visit beside its reading as the person's worked visit — the
 * edge builds the pair (`workedVisitOf` + the zone); `counted: null` = not
 * the person's worked visit.
 */
export type CountedVisitPair<A extends CountedAppointment> = {
  readonly appointment: A;
  readonly counted: CountedVisit | null;
};

function includes<T extends string>(ids: readonly T[], id: T): boolean {
  for (let i = 0; i < ids.length; i++) if (ids[i] === id) return true;
  return false;
}

export const AchievementsSystem = {
  EARLY_BIRD_LAST_MINUTE,

  /**
   * Did this worked visit count towards a family counting `metric`? The
   * narrowing first (service, barber, shop — every non-null scope field),
   * then the metric's own test; a fact the visit does not hold yet
   * (`null`, the draft on screen) never counts. Neither a season's window
   * nor the metric's own (`metricWindowDays`) is read here —
   * `insideWindows` is.
   */
  countsToward(metric: MetricRef, visit: CountableVisit): boolean {
    if (metric.metric === null) return false;
    if (
      metric.metricScopeServiceId !== null &&
      !includes(visit.serviceIds, metric.metricScopeServiceId)
    ) {
      return false;
    }
    if (
      metric.metricScopeBarberId !== null &&
      !includes(visit.barberIds, metric.metricScopeBarberId)
    ) {
      return false;
    }
    if (
      metric.metricScopeLocationId !== null &&
      visit.locationId !== metric.metricScopeLocationId
    ) {
      return false;
    }
    switch (metric.metric) {
      case Metric.VisitsCompleted:
        return true;
      case Metric.VisitsEarlyBird:
        return (
          visit.startMinutes !== null &&
          visit.startMinutes <= EARLY_BIRD_LAST_MINUTE
        );
      case Metric.VisitsWeekend:
        return visit.weekday !== null && Weekday.isWeekend(visit.weekday);
      case Metric.VisitsOnTime:
        return (
          visit.arrivedAtUtcMs !== null &&
          visit.startUtcMs !== null &&
          UtcEpochMs.compare(visit.arrivedAtUtcMs, visit.startUtcMs) <= 0
        );
      case Metric.VisitsParty:
        return visit.withCompany;
      default:
        return false;
    }
  },

  /**
   * A counted visit (on the shop day `localDate`) falls inside the family's
   * windows: its season's — a season's families count inside the season
   * only (a season the catalogue lacks counts nothing) — and its metric's
   * own (`metricWindowDays`: «Цяла година» counts the last 365 days, today
   * included). Shop-day arithmetic only (T8).
   */
  insideWindows(
    seasonWindow: SeasonWindow | null,
    inSeason: boolean,
    metricWindowDays: number | null,
    localDate: LocalDate,
    today: LocalDate,
  ): boolean {
    if (inSeason) {
      if (
        seasonWindow === null ||
        localDate < seasonWindow.windowFrom ||
        localDate > seasonWindow.windowUntil
      ) {
        return false;
      }
    }
    return (
      metricWindowDays === null ||
      LocalDate.daysBetween(localDate, today) < metricWindowDays
    );
  },

  /**
   * «с това посещение» (§3.3.3): the visit on screen would complete the
   * family's next level — the EXACT port of the cue's own rule
   * (`achievements.presenter.ts` `completesWithThisVisit`), which is NOT
   * {@link countsToward} (§7 R-1, §8 OQ-2): a narrowed visit count reads the
   * FIRST non-null scope only (service › barber › shop), an early bird
   * ignores every scope and reads the earliest leg's MINUTE on the shop's
   * clock, and weekend, on-time and party visits never complete here.
   *
   * First match wins: a retired or calendar-driven family never; a
   * season's family only while its season is OPEN (`seasonPhase` — the
   * phase of the series' season, `null` when the catalogue lacks it:
   * anything but OPEN, `null` included, is no); the yearly birthday act on
   * the client's birthday visit while it was last earned in an earlier year
   * (`lastEarned`'s stored shop day, T5); else one short of the next level
   * on a count this visit moves.
   */
  completesWithVisit(
    series: BadgeSeries,
    standing: Pick<SeriesStanding, 'next' | 'target' | 'value'>,
    lastEarned: EarnedLevel | null,
    draft: DraftVisit,
    seasonPhase: SeasonPhase | null,
    today: LocalDate,
  ): boolean {
    if (BadgeSystem.isRetired(series) || BadgeSystem.isCalendarDriven(series)) {
      return false;
    }
    if (series.seasonId !== null && seasonPhase !== SeasonPhase.Open) {
      return false;
    }
    if (series.repeatable && series.emblem === BadgeEmblem.Birthday) {
      return (
        draft.birthdayToday &&
        (lastEarned === null ||
          LocalDate.parts(lastEarned.earnedLocalDate).year <
            LocalDate.parts(today).year)
      );
    }
    if (standing.next === null || standing.target === null) return false;
    if (standing.target - standing.value > 1) return false;
    switch (series.metric) {
      case Metric.VisitsCompleted: {
        const serviceId = series.metricScopeServiceId;
        if (serviceId !== null) return includes(draft.serviceIds, serviceId);
        const barberId = series.metricScopeBarberId;
        if (barberId !== null) return includes(draft.barberIds, barberId);
        if (series.metricScopeLocationId !== null) {
          return draft.locationId === series.metricScopeLocationId;
        }
        return true;
      }
      case Metric.VisitsEarlyBird:
        return (
          draft.startMinutes !== null &&
          draft.startMinutes <= EARLY_BIRD_LAST_MINUTE
        );
      default:
        return false;
    }
  },

  /**
   * One appointment as the client RECORD's WORKED visit (D29: whom the shop
   * served) — `null` when the record holds no worked seat on it: its own
   * worked seats' services and barbers, the shop, the shop day, the minute
   * the FIRST of those seats began (the earliest), its weekday, the arrival
   * stamp, and whether someone else holds a seat on it. Zone-free: the edge
   * adds the start's instant (`ZonedTimeSystem.toUtc(localDate,
   * startMinutes, zone)`, the visit's own instant where the minute names
   * none) and so builds the {@link CountedVisit}.
   */
  workedVisitOf(
    appointment: Appointment,
    subject: CustomerId,
  ): WorkedVisitFacts | null {
    const own = ClientStatsSystem.subjectVisitOf(subject, appointment);
    if (own === null) return null;
    const serviceIds: ServiceId[] = [];
    const barberIds: BarberId[] = [];
    let startMinutes: MinuteOfDay | null = null;
    for (let i = 0; i < appointment.seats.length; i++) {
      const seat = appointment.seats[i] as Seat;
      if (
        seat.attendanceState !== AttendanceState.Worked ||
        !own.seats.includes(seat)
      ) {
        continue;
      }
      serviceIds.push(seat.serviceId);
      barberIds.push(seat.barberId);
      if (startMinutes === null || seat.startMinutes < startMinutes) {
        startMinutes = seat.startMinutes;
      }
    }
    if (startMinutes === null) return null;
    return {
      serviceIds,
      barberIds,
      locationId: appointment.locationId,
      localDate: appointment.localDate,
      startMinutes,
      weekday: LocalDate.weekday(appointment.localDate),
      arrivedAtUtcMs: appointment.arrivedAtUtcMs,
      withCompany: own.seats.length < appointment.seats.length,
    };
  },

  /**
   * The visit on screen as a visit the counting rule can judge. What the
   * day itself decides is not promised — a draft has no arrival and no
   * company. A draft with no start yet holds no day, minute, weekday or
   * instant (`null`: neither early nor on a weekend), and one with no shop
   * yet holds none (`null`: no shop's family names it) — never a value
   * made up to stand for one.
   */
  countedDraft(draft: CountedDraftInput): CountedDraft {
    const start = draft.start;
    return {
      serviceIds: draft.serviceIds,
      barberIds: draft.barberIds,
      locationId: draft.locationId,
      localDate: start === null ? null : start.localDate,
      startMinutes: start === null ? null : start.minute,
      weekday: start === null ? null : LocalDate.weekday(start.localDate),
      startUtcMs: start === null ? null : start.utcMs,
      arrivedAtUtcMs: null,
      withCompany: false,
    };
  },

  /**
   * The visit on screen, still open, will count towards the family once it
   * is over (a detail page's «С това посещение: 24 от 25»): there is a
   * draft (`draft`, from {@link countedDraft}), the family counts single
   * visits towards a threshold and can still move (`ended`: its season has
   * not ended), a season's family only while its season is OPEN — the same
   * seasonal rule as {@link completesWithVisit}, a `null` phase included —
   * and the draft holds what the family counts ({@link countsToward}).
   */
  draftCountsToward(
    series: BadgeSeries,
    standing: Pick<SeriesStanding, 'next' | 'target'>,
    draft: CountedDraft | null,
    seasonPhase: SeasonPhase | null,
    ended: boolean,
  ): boolean {
    if (
      draft === null ||
      series.metric === null ||
      standing.target === null ||
      !BadgeSystem.canStillMove(series, standing, ended)
    ) {
      return false;
    }
    if (series.seasonId !== null && seasonPhase !== SeasonPhase.Open) {
      return false;
    }
    return AchievementsSystem.countsToward(series, draft);
  },

  /**
   * The service a detail page's verb adds to the visit on screen («Добави
   * фейд»): the visit can be edited now (`gate` —
   * `WalletSystem.visitEditable`: online, not gone, the client not paused),
   * the family is awarded and about a SERVICE, can still move (`canMove`),
   * and the draft's services (`draftServiceIds`) lack it. `null` otherwise.
   * Whether the shop still names the service is the edge's.
   */
  serviceToAdd(
    series: BadgeSeries,
    draftServiceIds: readonly ServiceId[],
    canMove: boolean,
    gate: VisitEditView,
  ): ServiceId | null {
    if (!WalletSystem.visitEditable(gate)) return null;
    if (BadgeSystem.isRetired(series)) return null;
    if (series.badgeSubject !== BadgeSubject.Service) return null;
    if (!canMove) return null;
    return includes(draftServiceIds, series.subjectServiceId)
      ? null
      : series.subjectServiceId;
  },

  /**
   * «Броени посещения»: the loaded visits that counted towards the family,
   * newest first (equal instants keep their order). The visit on screen
   * (`currentId`) is kept whatever it holds while its draft counts
   * (`current` — the counted draft when {@link draftCountsToward} said so,
   * else `null`); every other visit counts when it is the person's worked
   * visit (`counted`), it counts towards the family ({@link countsToward})
   * and it falls inside the family's windows (`window` — the series'
   * season's, {@link insideWindows}). A visit listed twice is listed twice:
   * the rows that word them keep each once.
   */
  countedVisits<A extends CountedAppointment>(
    series: MetricRef & {
      readonly seasonId: BadgeSeries['seasonId'];
    },
    window: SeasonWindow | null,
    visits: readonly CountedVisitPair<A>[],
    today: LocalDate,
    current: CountableVisit | null,
    currentId: AppointmentId | null,
  ): readonly A[] {
    const lead = current !== null ? currentId : null;
    const inSeason = series.seasonId !== null;
    const out: A[] = [];
    for (let i = 0; i < visits.length; i++) {
      const pair = visits[i] as CountedVisitPair<A>;
      const visit = pair.appointment;
      if (
        (lead !== null && visit.id === lead) ||
        (pair.counted !== null &&
          AchievementsSystem.countsToward(series, pair.counted) &&
          AchievementsSystem.insideWindows(
            window,
            inSeason,
            series.metricWindowDays,
            visit.localDate,
            today,
          ))
      ) {
        out.push(visit);
      }
    }
    return out.sort((a, b) => UtcEpochMs.compare(b.utcEpochMs, a.utcEpochMs));
  },
} as const;
