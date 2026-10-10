import type { DayKey } from '../components/day-key.data';
import {
  Metric,
  type MetricRef,
  type MetricWindow,
  type SeasonWindow,
} from '../components/gamification.data';
import { Weekday } from '../components/weekday.data';
import type { BarberId } from '../entities/barber.entity';
import type { LocationId } from '../entities/location.entity';
import type { ServiceId } from '../entities/service.entity';
import { ZonedTimeSystem } from './zoned-time.system';

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
 * - an early bird began by 10:00, a weekend visit on a Saturday or a
 *   Sunday, a punctual one was marked arrived by its start, a visit with
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
  /** When the person's own first worked seat began. */
  readonly startMs: number;
  /** That start on the shop's wall clock: minutes of its day, and its ISO weekday. */
  readonly startMinuteOfDay: number;
  readonly startWeekday: Weekday;
  /** When the arrival was marked; `null` = never. */
  readonly arrivedAtMs: number | null;
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
   * narrowing first (service, barber, shop), then the metric's own test.
   * Neither a season's window nor the metric's own (`lastDays`) is read
   * here — `insideWindows` is.
   */
  countsToward(metric: MetricRef | null, visit: CountedVisit): boolean {
    if (metric === null) return false;
    const where = metric.where;
    if (where !== null) {
      if (
        where.serviceId !== null &&
        !includes(visit.serviceIds, where.serviceId)
      ) {
        return false;
      }
      if (
        where.barberId !== null &&
        !includes(visit.barberIds, where.barberId)
      ) {
        return false;
      }
      if (where.locationId !== null && visit.locationId !== where.locationId) {
        return false;
      }
    }
    switch (metric.metric) {
      case Metric.VisitsCompleted:
        return true;
      case Metric.VisitsEarlyBird:
        return visit.startMinuteOfDay <= EARLY_BIRD_LAST_MINUTE;
      case Metric.VisitsWeekend:
        return Weekday.isWeekend(visit.startWeekday);
      case Metric.VisitsOnTime:
        return visit.arrivedAtMs !== null && visit.arrivedAtMs <= visit.startMs;
      case Metric.VisitsParty:
        return visit.withCompany;
      default:
        return false;
    }
  },

  /**
   * A counted visit (on the shop `day`) falls inside the family's windows:
   * its season's — a season's families count inside the season only (a
   * season the catalogue lacks counts nothing) — and its metric's own («Цяла
   * година» counts the last 365 days, today included).
   */
  insideWindows(
    seasonWindow: SeasonWindow | null,
    inSeason: boolean,
    window: MetricWindow | null,
    day: DayKey,
    today: DayKey,
  ): boolean {
    if (inSeason) {
      if (
        seasonWindow === null ||
        day < seasonWindow.from ||
        day > seasonWindow.until
      ) {
        return false;
      }
    }
    return (
      window === null ||
      ZonedTimeSystem.daysBetween(day, today) < window.lastDays
    );
  },
} as const;
