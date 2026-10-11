import { Metric, type MetricRef, type SeasonWindow } from '@core/components';
import {
  Weekday,
  type BarberId,
  type LocationId,
  type ServiceId,
  LocalDate,
  type MinuteOfDay,
  UtcEpochMs,
} from '@core/primitives';

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

function includes<T extends string>(ids: readonly T[], id: T): boolean {
  for (let i = 0; i < ids.length; i++) if (ids[i] === id) return true;
  return false;
}

export const AchievementsSystem = {
  EARLY_BIRD_LAST_MINUTE,

  /**
   * Did this worked visit count towards a family counting `metric`? The
   * narrowing first (service, barber, shop — every non-null scope field),
   * then the metric's own test. Neither a season's window nor the metric's
   * own (`metricWindowDays`) is read here — `insideWindows` is.
   */
  countsToward(metric: MetricRef, visit: CountedVisit): boolean {
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
        return visit.startMinutes <= EARLY_BIRD_LAST_MINUTE;
      case Metric.VisitsWeekend:
        return Weekday.isWeekend(visit.weekday);
      case Metric.VisitsOnTime:
        return (
          visit.arrivedAtUtcMs !== null &&
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
} as const;
