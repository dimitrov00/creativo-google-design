import type { BarberId } from '@core/primitives';
import { type AnalyticsReport, RadarBase } from '@core/components';

/**
 * THE ADMIN'S RADAR (`docs/designs/staff-analytics-v2.md`, CUJ 5 and
 * `AnalyticsRadarSystem`): one polygon per barber of the shop, four axes
 * normalised 0–100 against the best barber meeting that axis's sample
 * floor. Every axis is the barber's own doing — a client's no-show is not,
 * so the no-show rate stays in the report and off the radar (owner,
 * 2026-11-10: the average ticket took its axis). Runs on the server only — the best value
 * never leaves it; the report carries the normalised axes and the base
 * (`reportRadarBase`) the screen words.
 */

/** The best of each normalised axis among the shop's barbers meeting its floor; `null` when none does. */
export type RadarBest = {
  readonly takingsPerHour: number | null;
  readonly fill: number | null;
  readonly rebooking: number | null;
  readonly tipsRate: number | null;
  readonly averageTicket: number | null;
};

/**
 * One barber's five axis values — raw with their floors applied
 * (`axisValuesOf`), or normalised (`axes`): `null` under the base, or when
 * the best is `null` or 0.
 */
export type RadarAxes = RadarBest;

/** The worked seats a barber needs before € per hour of service is drawn. */
const TAKINGS_SEAT_BASE = 20;

/** The rostered days a barber needs before their fill is drawn. */
const FILL_DAY_BASE = 7;

/** The worked seats a barber needs before their tips rate is drawn. */
const TIPS_SEAT_BASE = 20;

/** The worked seats a barber needs before their average ticket is drawn. */
const TICKET_SEAT_BASE = 20;

/**
 * The base a count rate needs before it is shown as a rate (design G6) —
 * the rebooking and no-show rates' floor, v1's; declared here, below
 * `staff-analytics.system.ts`, which imports it (the two files would cycle
 * the other way round).
 */
const RATE_BASE = 20;

/** Minutes in an hour — what € per minute of service is scaled by. */
const MINUTES_PER_HOUR = 60;

/** `value ÷ best × 100`; `null` under the base, or with no best, or a best of 0. */
function normalised(value: number | null, best: number | null): number | null {
  if (value === null || best === null || best === 0) return null;
  return (value / best) * 100;
}

/** The larger of a running best and a candidate; `null` stays `null` only while no candidate met the floor. */
function better(best: number | null, candidate: number | null): number | null {
  if (candidate === null) return best;
  return best === null || candidate > best ? candidate : best;
}

/** Every axis `null` — a barber with no comparison figures. */
const NO_AXES: RadarAxes = {
  takingsPerHour: null,
  fill: null,
  rebooking: null,
  tipsRate: null,
  averageTicket: null,
};

export const AnalyticsRadarSystem = {
  TAKINGS_SEAT_BASE,
  FILL_DAY_BASE,
  TIPS_SEAT_BASE,
  TICKET_SEAT_BASE,
  RATE_BASE,

  /**
   * One barber's raw axis values with their floors applied: € per hour of
   * service (`takingsCents ÷ serviceMinutes × 60`, base
   * {@link TAKINGS_SEAT_BASE} worked seats, `null` with no service minutes),
   * fill (`workedMinutes ÷ rosteredMinutes`, base {@link FILL_DAY_BASE}
   * rostered days, `null` with no rostered minutes), rebooking (the figures'
   * `rebookedRate`, v1's base of {@link RATE_BASE}), tips rate
   * (`tipsCents ÷ takingsCents`, base {@link TIPS_SEAT_BASE} worked seats,
   * `null` with no takings) and the average ticket (`takingsCents ÷
   * workedSeatCount`, the takings per client served, base
   * {@link TICKET_SEAT_BASE} worked seats).
   */
  axisValuesOf(figures: AnalyticsReport.BarberFigures): RadarAxes {
    const enoughSeats = figures.workedSeatCount >= TAKINGS_SEAT_BASE;
    return {
      takingsPerHour:
        enoughSeats && figures.serviceMinutes > 0
          ? (figures.takingsCents / figures.serviceMinutes) * MINUTES_PER_HOUR
          : null,
      fill:
        figures.rosteredDayCount >= FILL_DAY_BASE && figures.rosteredMinutes > 0
          ? figures.workedMinutes / figures.rosteredMinutes
          : null,
      rebooking: figures.rebookedRate,
      tipsRate:
        figures.workedSeatCount >= TIPS_SEAT_BASE && figures.takingsCents > 0
          ? figures.tipsCents / figures.takingsCents
          : null,
      averageTicket:
        figures.workedSeatCount >= TICKET_SEAT_BASE
          ? figures.takingsCents / figures.workedSeatCount
          : null,
    };
  },

  /** The maximum of each normalised axis among `barbers` meeting its floor; `null` where none does. */
  bestOf(barbers: readonly AnalyticsReport.BarberFigures[]): RadarBest {
    let takingsPerHour: number | null = null;
    let fill: number | null = null;
    let rebooking: number | null = null;
    let tipsRate: number | null = null;
    let averageTicket: number | null = null;
    for (let i = 0; i < barbers.length; i++) {
      const values = AnalyticsRadarSystem.axisValuesOf(
        barbers[i] as AnalyticsReport.BarberFigures,
      );
      takingsPerHour = better(takingsPerHour, values.takingsPerHour);
      fill = better(fill, values.fill);
      rebooking = better(rebooking, values.rebooking);
      tipsRate = better(tipsRate, values.tipsRate);
      averageTicket = better(averageTicket, values.averageTicket);
    }
    return { takingsPerHour, fill, rebooking, tipsRate, averageTicket };
  },

  /**
   * One barber's axes against `best`: each `value ÷ best × 100` — `null`
   * under the base, or when the best is `null` or 0. The comparison period's figures
   * are passed with THIS period's best, so the two polygons share a base;
   * a comparison value may then exceed 100.
   */
  axes(figures: AnalyticsReport.BarberFigures, best: RadarBest): RadarAxes {
    const values = AnalyticsRadarSystem.axisValuesOf(figures);
    return {
      takingsPerHour: normalised(values.takingsPerHour, best.takingsPerHour),
      fill: normalised(values.fill, best.fill),
      rebooking: normalised(values.rebooking, best.rebooking),
      tipsRate: normalised(values.tipsRate, best.tipsRate),
      averageTicket: normalised(values.averageTicket, best.averageTicket),
    };
  },

  /**
   * The report's radars: one row per barber of `barbers`, in their order,
   * each normalised against the best of `barbers` and carrying the
   * comparison period's axes — `comparisonBarbers`' row with the same
   * `barberId`, on the same best; every comparison axis `null` where the
   * barber has none. With fewer than two barbers there is nothing to
   * compare against: no rows, and the base `TOO_FEW_BARBERS`.
   */
  radarsOf(
    barbers: readonly AnalyticsReport.BarberFigures[],
    comparisonBarbers: readonly AnalyticsReport.BarberFigures[],
  ): {
    readonly reportRadars: readonly AnalyticsReport.RadarRow[];
    readonly reportRadarBase: RadarBase;
  } {
    if (barbers.length < 2) {
      return { reportRadars: [], reportRadarBase: RadarBase.TooFewBarbers };
    }
    const best = AnalyticsRadarSystem.bestOf(barbers);
    const comparisonOf = new Map<BarberId, AnalyticsReport.BarberFigures>();
    for (let i = 0; i < comparisonBarbers.length; i++) {
      const figures = comparisonBarbers[i] as AnalyticsReport.BarberFigures;
      comparisonOf.set(figures.barberId, figures);
    }
    const rows: AnalyticsReport.RadarRow[] = [];
    for (let i = 0; i < barbers.length; i++) {
      const figures = barbers[i] as AnalyticsReport.BarberFigures;
      const current = AnalyticsRadarSystem.axes(figures, best);
      const previous = comparisonOf.get(figures.barberId);
      const comparison =
        previous === undefined
          ? NO_AXES
          : AnalyticsRadarSystem.axes(previous, best);
      rows.push({
        barberId: figures.barberId,
        takingsPerHour: current.takingsPerHour,
        fill: current.fill,
        rebooking: current.rebooking,
        tipsRate: current.tipsRate,
        averageTicket: current.averageTicket,
        comparisonTakingsPerHour: comparison.takingsPerHour,
        comparisonFill: comparison.fill,
        comparisonRebooking: comparison.rebooking,
        comparisonTipsRate: comparison.tipsRate,
        comparisonAverageTicket: comparison.averageTicket,
      });
    }
    return { reportRadars: rows, reportRadarBase: RadarBase.BestOfShop };
  },
} as const;
