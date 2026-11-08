import {
  BarberId,
  Currency,
  HourOfDay,
  LocalDate,
  MinuteCount,
  PriceCents,
  ServiceId,
  StoredFields,
  UtcEpochMs,
} from '@core/primitives';
import { ANALYTICS_DEFINITION_VERSION } from './analytics-report.data';

/*
 * ONE PAST BARBER-DAY'S FIGURES (`docs/designs/staff-analytics-v2.md`, «The
 * day document»): the per-day family of the staff analytics catalogue,
 * composed by intersection (Law 6). `DayRow` is the row the report's answer
 * carries — the identity, every chair-time part and the money;
 * `DayFigures = DayRow & DayCounts & DayServices & DayHourBuckets & DayStamp` is
 * the stored body of `analyticsDays/{busyKey}` (`BarberAnalyticsDay`), the
 * same flat layout in Firestore, on the wire and in this struct (Law 5).
 * Every figure is a `day`-prefixed integer: minutes on the shop's wall
 * clock, euro cents, counts — what `DayFiguresSystem` folds and sums.
 */

/**
 * The identity, the chair-time partition and the money of one barber-day —
 * what a `TIME` drill-down row prints, and the head of a stored day.
 * `dayRosteredMinutes` is the sum of the ten parts that follow it
 * (`ChairDay`'s invariant); a stored PAST day carries
 * `dayBookedAheadMinutes: 0` and `dayOpenMinutes: 0`, so every document
 * shares one hidden class. The money is euro cents after
 * `ClientStatsSystem.inEuroCents`, so `currency` is always `EUR`.
 */
export type DayRow = {
  readonly barberId: BarberId;
  /** The shop day; on a per-month row (a span over 93 days) the month's first day. */
  readonly localDate: LocalDate;
  readonly dayRosteredMinutes: MinuteCount;
  readonly dayWorkedMinutes: MinuteCount;
  readonly dayNoShowMinutes: MinuteCount;
  readonly dayUnmarkedMinutes: MinuteCount;
  readonly dayBookedAheadMinutes: MinuteCount;
  readonly dayHeldMinutes: MinuteCount;
  readonly dayBlockedMinutes: MinuteCount;
  readonly dayBreakMinutes: MinuteCount;
  readonly dayShortGapMinutes: MinuteCount;
  readonly dayUnsoldMinutes: MinuteCount;
  readonly dayOpenMinutes: MinuteCount;
  /** What the roster would have given a `CLOSED` day; not a `ChairDay` part. */
  readonly dayClosedDayMinutes: MinuteCount;
  readonly dayTakingsCents: PriceCents;
  readonly dayTipsCents: PriceCents;
  readonly currency: Currency;
};

/**
 * The day's counts. A worked seat on a day with no rostered stretch lands in
 * the outside-hours pair through the visit's busy key. The rebooking pair
 * counts only on a PAST day (Terms, «Past day»: the window — the visit's
 * shop day and the next — has closed), so a stored day's rebooking is final.
 * A visit counts in `dayExcludedVisitCount` and in the three origin counts
 * once per barber with a worked seat on it — a day document knows no other
 * barber's seats.
 */
export type DayCounts = {
  readonly dayOutsideHoursMinutes: MinuteCount;
  readonly dayOutsideHoursSeatCount: number;
  /** Visits with a worked seat of the barber whose bill could not be evaluated. */
  readonly dayExcludedVisitCount: number;
  readonly dayWorkedSeatCount: number;
  readonly dayNoShowCount: number;
  /** Worked + no-show seats. */
  readonly dayNoShowBase: number;
  readonly dayRebookedBase: number;
  readonly dayRebookedCount: number;
  readonly dayLateCancellationCount: number;
  readonly dayOnlineVisitCount: number;
  readonly dayStaffVisitCount: number;
  readonly dayUnknownOriginVisitCount: number;
};

/** The day's worked seats by service — the one 1-to-N list; the takings per hour are derived, never stored. */
export type DayServices = {
  readonly dayServices: readonly DayFigures.ServiceRow[];
};

/**
 * The hour buckets (Terms, «Hour buckets»): 24 entries each, the minutes of
 * worked and of rostered time overlapping `[h:00, h+1:00)` on the wall clock
 * (`AnalyticsHourSystem.bucketsOf`). A DST day is 24 buckets too.
 */
export type DayHourBuckets = {
  readonly dayHourWorked: readonly MinuteCount[];
  readonly dayHourRostered: readonly MinuteCount[];
};

/**
 * The computation's stamp — the ONE home of the meta pair: the catalogue
 * version the figures were computed under (an older one makes the day
 * eligible for the recompute) and the writer's `sourceReadUtcMs`, which
 * orders two writers racing (Law 7 T2: the later computation stays).
 */
export type DayStamp = {
  readonly dayDefinitionVersion: number;
  readonly dayComputedAtUtcMs: UtcEpochMs;
};

/** The stored body of one past barber-day — `analyticsDays/{busyKey}` minus `id`. */
export type DayFigures = DayRow &
  DayCounts &
  DayServices &
  DayHourBuckets &
  DayStamp;

/** Is `raw` a list of exactly 24 minute counts — one hour-bucket array. */
function isHourBuckets(raw: unknown): raw is readonly MinuteCount[] {
  return (
    Array.isArray(raw) &&
    raw.length === HourOfDay.PER_DAY &&
    StoredFields.isArrayOf(raw, MinuteCount.is)
  );
}

/** Is `raw` one service row — every field read in place, nothing copied. */
function isServiceRow(raw: unknown): raw is DayFigures.ServiceRow {
  return (
    StoredFields.isRecord(raw) &&
    ServiceId.is(raw['serviceId']) &&
    StoredFields.isCount(raw['workedSeatCount']) &&
    PriceCents.is(raw['takingsCents']) &&
    MinuteCount.is(raw['serviceMinutes'])
  );
}

/** The fields of a day that are minute counts — checked and summed alike. */
const MINUTE_FIELDS = [
  'dayRosteredMinutes',
  'dayWorkedMinutes',
  'dayNoShowMinutes',
  'dayUnmarkedMinutes',
  'dayBookedAheadMinutes',
  'dayHeldMinutes',
  'dayBlockedMinutes',
  'dayBreakMinutes',
  'dayShortGapMinutes',
  'dayUnsoldMinutes',
  'dayOpenMinutes',
  'dayClosedDayMinutes',
  'dayOutsideHoursMinutes',
] as const;

/** The fields of a day that are counts. */
const COUNT_FIELDS = [
  'dayOutsideHoursSeatCount',
  'dayExcludedVisitCount',
  'dayWorkedSeatCount',
  'dayNoShowCount',
  'dayNoShowBase',
  'dayRebookedBase',
  'dayRebookedCount',
  'dayLateCancellationCount',
  'dayOnlineVisitCount',
  'dayStaffVisitCount',
  'dayUnknownOriginVisitCount',
] as const;

function zeroBuckets(): readonly MinuteCount[] {
  const out: MinuteCount[] = [];
  for (let h = 0; h < HourOfDay.PER_DAY; h++) out.push(MinuteCount.ZERO);
  return out;
}

export const DayFigures = {
  /** The names of the thirteen minute fields, in the table's order — what `is` checks and `sum` adds. */
  MINUTE_FIELDS,
  /** The names of the eleven count fields, in the table's order. */
  COUNT_FIELDS,

  /**
   * A barber-day with nothing on it — zeros throughout, 24 empty buckets,
   * no service row, euro — stamped with this definition and
   * `computedAtUtcMs`: what a day with no roster and no visit stores.
   */
  empty(
    barberId: BarberId,
    localDate: LocalDate,
    computedAtUtcMs: UtcEpochMs,
  ): DayFigures {
    return {
      barberId,
      localDate,
      dayRosteredMinutes: MinuteCount.ZERO,
      dayWorkedMinutes: MinuteCount.ZERO,
      dayNoShowMinutes: MinuteCount.ZERO,
      dayUnmarkedMinutes: MinuteCount.ZERO,
      dayBookedAheadMinutes: MinuteCount.ZERO,
      dayHeldMinutes: MinuteCount.ZERO,
      dayBlockedMinutes: MinuteCount.ZERO,
      dayBreakMinutes: MinuteCount.ZERO,
      dayShortGapMinutes: MinuteCount.ZERO,
      dayUnsoldMinutes: MinuteCount.ZERO,
      dayOpenMinutes: MinuteCount.ZERO,
      dayClosedDayMinutes: MinuteCount.ZERO,
      dayTakingsCents: PriceCents.ZERO,
      dayTipsCents: PriceCents.ZERO,
      currency: Currency.EUR,
      dayOutsideHoursMinutes: MinuteCount.ZERO,
      dayOutsideHoursSeatCount: 0,
      dayExcludedVisitCount: 0,
      dayWorkedSeatCount: 0,
      dayNoShowCount: 0,
      dayNoShowBase: 0,
      dayRebookedBase: 0,
      dayRebookedCount: 0,
      dayLateCancellationCount: 0,
      dayOnlineVisitCount: 0,
      dayStaffVisitCount: 0,
      dayUnknownOriginVisitCount: 0,
      dayServices: [],
      dayHourWorked: zeroBuckets(),
      dayHourRostered: zeroBuckets(),
      dayDefinitionVersion: ANALYTICS_DEFINITION_VERSION,
      dayComputedAtUtcMs: computedAtUtcMs,
    };
  },

  /**
   * The read-time door (edge hardening D-1) of a stored day's body: every
   * field present and of its shape — the ids, the civil date, thirteen
   * minute counts, two amounts and a currency, eleven counts, the service
   * rows, two 24-bucket arrays and the stamp. Read in place: no copy, no
   * `Result`. A `false` is a malformed document, which a reader drops and
   * logs, never a figure.
   */
  is(raw: unknown): raw is DayFigures {
    if (!StoredFields.isRecord(raw)) return false;
    if (!BarberId.is(raw['barberId']) || !LocalDate.is(raw['localDate'])) {
      return false;
    }
    for (let i = 0; i < MINUTE_FIELDS.length; i++) {
      if (!MinuteCount.is(raw[MINUTE_FIELDS[i] as string])) return false;
    }
    for (let i = 0; i < COUNT_FIELDS.length; i++) {
      if (!StoredFields.isCount(raw[COUNT_FIELDS[i] as string])) return false;
    }
    return (
      PriceCents.is(raw['dayTakingsCents']) &&
      PriceCents.is(raw['dayTipsCents']) &&
      Currency.is(raw['currency']) &&
      StoredFields.isArrayOf(raw['dayServices'], isServiceRow) &&
      isHourBuckets(raw['dayHourWorked']) &&
      isHourBuckets(raw['dayHourRostered']) &&
      StoredFields.isCount(raw['dayDefinitionVersion']) &&
      UtcEpochMs.is(raw['dayComputedAtUtcMs'])
    );
  },

  /**
   * The row the report carries, cut from a day's figures: the identity, the
   * eleven minute parts, the closed-day minutes and the money — it keeps
   * exactly `DayRow`'s seventeen fields and drops the counts, the service
   * rows, the hour buckets and the stamp. A declared projection (the wider
   * value stated in the signature), not a mapper: nothing is renamed.
   */
  rowOf<T extends DayRow>(figures: T): DayRow {
    return {
      barberId: figures.barberId,
      localDate: figures.localDate,
      dayRosteredMinutes: figures.dayRosteredMinutes,
      dayWorkedMinutes: figures.dayWorkedMinutes,
      dayNoShowMinutes: figures.dayNoShowMinutes,
      dayUnmarkedMinutes: figures.dayUnmarkedMinutes,
      dayBookedAheadMinutes: figures.dayBookedAheadMinutes,
      dayHeldMinutes: figures.dayHeldMinutes,
      dayBlockedMinutes: figures.dayBlockedMinutes,
      dayBreakMinutes: figures.dayBreakMinutes,
      dayShortGapMinutes: figures.dayShortGapMinutes,
      dayUnsoldMinutes: figures.dayUnsoldMinutes,
      dayOpenMinutes: figures.dayOpenMinutes,
      dayClosedDayMinutes: figures.dayClosedDayMinutes,
      dayTakingsCents: figures.dayTakingsCents,
      dayTipsCents: figures.dayTipsCents,
      currency: figures.currency,
    };
  },
} as const;

export namespace DayFigures {
  /** One service's worked seats on the day; the takings per hour of service are derived by the reader. */
  export type ServiceRow = {
    readonly serviceId: ServiceId;
    readonly workedSeatCount: number;
    readonly takingsCents: PriceCents;
    /** Σ the seats' `durationMinutes`. */
    readonly serviceMinutes: MinuteCount;
  };
}
