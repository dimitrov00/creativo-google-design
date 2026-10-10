import { type LocationDayHours } from '@creativo/domain/catalog';
import {
  type ScheduleException,
  StaffScheduleHistory,
  WEEKDAYS,
  toEcsDetail,
} from '@creativo/domain/scheduling';
import {
  type CapacityContribution,
  type PersistedSlot,
  busyIntervalsOf,
} from '@creativo/application/booking';
import {
  BarberId,
  type CapacityBusyDay,
  type CapacityEntry,
  type CapacityShopWeek,
  CapacitySystem,
  type DayException,
  DayHours,
  DayKey,
  type ExceptionEffect,
  LocationId,
  ScheduleExceptionSystem,
  type ScheduleVersion,
  ShiftSegment,
  type Weekday,
  ZonedTimeSystem,
} from '@creativo/ecs-core';

/**
 * The PURE half of the capacity rebuild: geometry in, write plan out.
 *
 * Phase 2 shim: the math is `CapacitySystem` in `@creativo/ecs-core`
 * (`planBarberCapacity`, `byMonth`, `dayKeysBetween`, `horizonSpanEndKey`);
 * this file keeps the legacy inputs and the month-grouped plan the I/O shell
 * in `rebuild-capacity.ts` applies, and converts at the edge. The shell's
 * own hazard (Firestore's merge-vs-replace semantics) stays covered by the
 * emulator suite.
 */
export interface CapacityPlanInput {
  readonly barberId: string;
  readonly dayKeys: readonly string[];
  readonly zone: string;
  /** Parsed roster, or `null` when the barber has none — every day deletes. */
  readonly schedule: {
    readonly history: StaffScheduleHistory;
    readonly turnaroundMinutes: number;
  } | null;
  /** ACTIVE locations only — an archived shop must not sell hours. */
  readonly hoursByLocation: ReadonlyMap<string, readonly LocationDayHours[]>;
  readonly busyByDay: ReadonlyMap<string, readonly PersistedSlot[]>;
  readonly exceptionByDay: ReadonlyMap<string, ScheduleException | null>;
}

/** `contribution: null` means "delete this barber's entry for the day". */
export interface PlannedEntry {
  readonly dayKey: string;
  readonly contribution: CapacityContribution | null;
}

export interface CapacityMonthPlan {
  readonly month: string;
  readonly entries: readonly PlannedEntry[];
}

export function planBarberCapacity(
  input: CapacityPlanInput,
): readonly CapacityMonthPlan[] {
  const plan = CapacitySystem.planBarberCapacity(
    {
      barberId: BarberId.of(input.barberId),
      dayKeys: input.dayKeys.map(DayKey.of),
      schedule: input.schedule && {
        versions: versionsOf(input.schedule.history),
        turnaroundMinutes: input.schedule.turnaroundMinutes,
      },
      shops: shopWeeksOf(input.hoursByLocation),
      busy: busyDaysOf(input.busyByDay, input.zone),
      exceptions: dayExceptionsOf(input.exceptionByDay),
    },
    dayTableOf(input.zone, input.dayKeys),
  );
  return CapacitySystem.byMonth(plan).map((month) => ({
    month: month.month,
    entries: contributionsOf(month.dayKeys, month.entries),
  }));
}

/**
 * Inclusive `YYYY-MM-DD` walk, capped at 500 days — `truncated` (instead of
 * logging here) keeps the module pure; the shell owns the warning.
 */
export function dayKeysBetween(
  fromKey: string,
  toKey: string,
): { readonly keys: readonly string[]; readonly truncated: boolean } {
  if (!DayKey.isValid(fromKey) || !DayKey.isValid(toKey)) {
    return { keys: [], truncated: false };
  }
  return CapacitySystem.dayKeysBetween(DayKey.of(fromKey), DayKey.of(toKey));
}

/** `2026-10-31` → `2026-11-30`: last day of the following month. */
export function horizonSpanEndKey(horizonEndKey: string): string {
  return CapacitySystem.horizonSpanEndKey(DayKey.of(horizonEndKey));
}

/* ── Converters between the legacy inputs and the ecs-core structs ──────── */

/** The roster history → its versions, the `'HH:mm'` weekday map flattened to segments. */
function versionsOf(history: StaffScheduleHistory): readonly ScheduleVersion[] {
  return history.all().map((version) => ({
    seq: version.seq,
    effectiveFromDayKey: DayKey.of(version.effectiveFrom.key()),
    effectiveToDayKey:
      version.effectiveTo === null
        ? null
        : DayKey.of(version.effectiveTo.key()),
    segments: WEEKDAYS.flatMap((weekday, index) =>
      version.pattern
        .segmentsOn(weekday)
        .map((segment) =>
          ShiftSegment.of(
            (index + 1) as Weekday,
            LocationId.of(segment.locationId.value),
            segment.start.minutesFromMidnight(),
            segment.end.minutesFromMidnight(),
          ),
        ),
    ),
  }));
}

/**
 * `'HH:mm'` weeks → minutes. A week holding a clock that does not parse
 * (refused by the `Location` aggregate, so never stored) publishes nothing.
 */
function shopWeeksOf(
  hoursByLocation: ReadonlyMap<string, readonly LocationDayHours[]>,
): readonly CapacityShopWeek[] {
  return [...hoursByLocation].map(([locationId, weekly]) => ({
    locationId: LocationId.of(locationId),
    week: weekOf(weekly),
  }));
}

function weekOf(weekly: readonly LocationDayHours[]): readonly DayHours[] {
  const week: DayHours[] = [];
  for (const entry of weekly) {
    if (entry.kind === 'closed') {
      week.push(DayHours.closed());
      continue;
    }
    const opens = DayHours.parseClock(entry.opens);
    const closes = DayHours.parseClock(entry.closes);
    if (!opens.ok || !closes.ok) return [];
    week.push(DayHours.open(opens.value, closes.value));
  }
  return week;
}

function busyDaysOf(
  busyByDay: ReadonlyMap<string, readonly PersistedSlot[]>,
  zone: string,
): readonly CapacityBusyDay[] {
  return [...busyByDay].map(([dayKey, slots]) => ({
    dayKey: DayKey.of(dayKey),
    spans: busyIntervalsOf(slots, zone),
  }));
}

/** A published exception → its public effect (the reasoned detail collapses). */
function dayExceptionsOf(
  exceptionByDay: ReadonlyMap<string, ScheduleException | null>,
): readonly DayException[] {
  const out: DayException[] = [];
  for (const exception of exceptionByDay.values()) {
    if (exception === null) continue;
    const effect = effectOf(exception);
    if (effect !== null) {
      out.push({ dayKey: DayKey.of(exception.day.key()), effect });
    }
  }
  return out;
}

function effectOf(exception: ScheduleException): ExceptionEffect | null {
  const effect = ScheduleExceptionSystem.publicEffect(
    toEcsDetail(exception.detail),
  );
  return effect.ok ? effect.value : null;
}

/** The zone table over the plan's valid days. */
function dayTableOf(zone: string, dayKeys: readonly string[]) {
  const valid = dayKeys.filter((dayKey) => DayKey.isValid(dayKey)).sort();
  const first = valid[0];
  const last = valid[valid.length - 1];
  if (first === undefined || last === undefined) return [];
  return ZonedTimeSystem.dayTable(zone, DayKey.of(first), DayKey.of(last));
}

/**
 * A month's days → the legacy per-shop map of each; `null` for a day with
 * none. Both lists are sorted by day (`CapacitySystem.byMonth`), so one
 * pointer walks the entries beside the days — one linear pass.
 */
function contributionsOf(
  dayKeys: readonly string[],
  entries: readonly CapacityEntry[],
): readonly PlannedEntry[] {
  const planned: PlannedEntry[] = [];
  let e = 0;
  for (const dayKey of dayKeys) {
    let entry = entries.at(e);
    while (entry !== undefined && entry.dayKey < dayKey)
      entry = entries.at(++e);
    const pairs: [string, number][] = [];
    while (entry !== undefined && entry.dayKey === dayKey) {
      pairs.push([entry.locationId, entry.freeMinutes]);
      entry = entries.at(++e);
    }
    planned.push({
      dayKey,
      contribution: pairs.length === 0 ? null : Object.fromEntries(pairs),
    });
  }
  return planned;
}
