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
  EndMinute,
  LocalDate,
  LocationId,
  MinuteCount,
  MinuteOfDay,
  type TimeZone,
  UtcEpochMs,
  type Weekday,
  defect,
} from '@core/primitives';
import {
  type CapacityEntry,
  DayHours,
  type ExceptionEffectRule,
  type MinuteRange,
  type ScheduleVersion,
  ShiftSegment,
} from '@core/components';
import {
  type CapacityBusyDay,
  type CapacityShopWeek,
  CapacitySystem,
  type DayException,
  ScheduleExceptionSystem,
  ZonedTimeSystem,
} from '@core/systems';

/**
 * The PURE half of the capacity rebuild: geometry in, write plan out.
 *
 * Phase 2 shim: the math is `CapacitySystem` in `@core/systems`
 * (`planBarberCapacity`, `byMonth`, `localDatesBetween`, `horizonSpanEnd`);
 * this file keeps the legacy inputs and the month-grouped plan the I/O shell
 * in `rebuild-capacity.ts` applies, and converts at the edge — the stored
 * busy instants to wall-clock minutes of their shop day in the input's
 * `zone` (Law 7.3: the system is zone-blind). The shell's own hazard
 * (Firestore's merge-vs-replace semantics) stays covered by the emulator
 * suite.
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
  // A zone the engine cannot read places no busy span and no window — every
  // day of the scope deletes, as the legacy empty day table did.
  const zone = ZonedTimeSystem.checkZone(input.zone);
  const plan = CapacitySystem.planBarberCapacity({
    barberId: BarberId.of(input.barberId),
    localDates: localDatesOf(input.dayKeys),
    schedule:
      input.schedule === null || !zone.ok
        ? null
        : {
            versions: versionsOf(input.schedule.history),
            turnaroundMinutes: sure(
              MinuteCount.of(input.schedule.turnaroundMinutes),
              'a turnaround',
            ),
          },
    shops: shopWeeksOf(input.hoursByLocation),
    busy: zone.ok ? busyDaysOf(input.busyByDay, zone.value) : [],
    exceptions: dayExceptionsOf(input.exceptionByDay),
  });
  return CapacitySystem.byMonth(plan).map((month) => ({
    month: month.month,
    entries: contributionsOf(month.localDates, month.entries),
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
  const from = LocalDate.parse(fromKey);
  const to = LocalDate.parse(toKey);
  if (!from.ok || !to.ok) return { keys: [], truncated: false };
  return CapacitySystem.localDatesBetween(from.value, to.value);
}

/** `2026-10-31` → `2026-11-30`: last day of the following month. */
export function horizonSpanEndKey(horizonEndKey: string): string {
  const horizonEnd = LocalDate.parse(horizonEndKey);
  // A key that is no date is no horizon to extend.
  return horizonEnd.ok
    ? CapacitySystem.horizonSpanEnd(horizonEnd.value)
    : horizonEndKey;
}

/* ── Converters between the legacy inputs and the ecs-core structs ──────── */

/** A brand the legacy value already satisfies — its own rules are the brand's. */
function sure<T, E>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: E },
  what: string,
): T {
  // Unreachable: a legacy roster, `CalendarDay` or stored figure already
  // holds every rule the brand checks.
  if (!result.ok) defect(`unreachable: ${what}`);
  return result.value;
}

/** The scope's days; a key that is no date has no shop day to plan. */
function localDatesOf(dayKeys: readonly string[]): readonly LocalDate[] {
  const days: LocalDate[] = [];
  for (const dayKey of dayKeys) {
    const localDate = LocalDate.parse(dayKey);
    if (localDate.ok) days.push(localDate.value);
  }
  return days;
}

/** The roster history → its versions, the `'HH:mm'` weekday map flattened to segments. */
function versionsOf(history: StaffScheduleHistory): readonly ScheduleVersion[] {
  return history.all().map((version) => ({
    seq: version.seq,
    effectiveFromLocalDate: sure(
      LocalDate.parse(version.effectiveFrom.key()),
      'a version start',
    ),
    effectiveToLocalDate:
      version.effectiveTo === null
        ? null
        : sure(LocalDate.parse(version.effectiveTo.key()), 'a version end'),
    segments: WEEKDAYS.flatMap((weekday, index) =>
      version.pattern
        .segmentsOn(weekday)
        .map((segment) =>
          ShiftSegment.of(
            (index + 1) as Weekday,
            LocationId.of(segment.locationId.value),
            sure(
              MinuteOfDay.of(segment.start.minutesFromMidnight()),
              'a segment start',
            ),
            sure(
              EndMinute.of(segment.end.minutesFromMidnight()),
              'a segment end',
            ),
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

/** A closing `00:00` opens nothing (an inverted day, as the figures read it): closed. */
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
    const end = EndMinute.of(closes.value);
    week.push(
      end.ok ? DayHours.open(opens.value, end.value) : DayHours.closed(),
    );
  }
  return week;
}

/**
 * An instant → its wall-clock minute on `localDate`'s axis in `timeZone`:
 * the minute of the day, counted past `1440` for a later day and below `0`
 * for an earlier one.
 */
function minuteOn(
  localDate: LocalDate,
  timeZone: TimeZone,
  instantMs: number,
): number {
  const wall = ZonedTimeSystem.toLocal(
    sure(UtcEpochMs.of(instantMs), 'an instant'),
    timeZone,
  );
  return LocalDate.daysBetween(localDate, wall.localDate) * 1440 + wall.minute;
}

/**
 * A busy document's stored instants → the minute ranges of its shop day,
 * clipped to it (the window math never leaves the day; a span running past
 * midnight holds only this day's part of it).
 */
function busyDaysOf(
  busyByDay: ReadonlyMap<string, readonly PersistedSlot[]>,
  timeZone: TimeZone,
): readonly CapacityBusyDay[] {
  const days: CapacityBusyDay[] = [];
  for (const [dayKey, slots] of busyByDay) {
    const localDate = LocalDate.parse(dayKey);
    if (!localDate.ok) continue;
    const spans: MinuteRange[] = [];
    for (const span of busyIntervalsOf(slots, timeZone)) {
      const start = Math.max(
        minuteOn(localDate.value, timeZone, span.startMs),
        0,
      );
      const end = Math.min(
        minuteOn(localDate.value, timeZone, span.endMs),
        1440,
      );
      const from = MinuteOfDay.of(start);
      const to = EndMinute.of(end);
      if (start < end && from.ok && to.ok) {
        spans.push({ startMinutes: from.value, endMinutes: to.value });
      }
    }
    days.push({ localDate: localDate.value, spans });
  }
  return days;
}

/** A published exception → its public effect (the reasoned detail collapses). */
function dayExceptionsOf(
  exceptionByDay: ReadonlyMap<string, ScheduleException | null>,
): readonly DayException[] {
  const out: DayException[] = [];
  for (const exception of exceptionByDay.values()) {
    if (exception === null) continue;
    const effect = effectOf(exception);
    const localDate = LocalDate.parse(exception.day.key());
    if (effect !== null && localDate.ok) {
      out.push({ localDate: localDate.value, ...effect });
    }
  }
  return out;
}

function effectOf(exception: ScheduleException): ExceptionEffectRule | null {
  const effect = ScheduleExceptionSystem.publicEffect(
    toEcsDetail(exception.detail),
  );
  return effect.ok ? effect.value : null;
}

/**
 * A month's days → the legacy per-shop map of each; `null` for a day with
 * none. Both lists are sorted by day (`CapacitySystem.byMonth`), so one
 * pointer walks the entries beside the days — one linear pass.
 */
function contributionsOf(
  localDates: readonly LocalDate[],
  entries: readonly CapacityEntry[],
): readonly PlannedEntry[] {
  const planned: PlannedEntry[] = [];
  let e = 0;
  for (const localDate of localDates) {
    let entry = entries.at(e);
    while (entry !== undefined && entry.localDate < localDate)
      entry = entries.at(++e);
    const pairs: [string, number][] = [];
    while (entry !== undefined && entry.localDate === localDate) {
      pairs.push([entry.locationId, entry.freeMinutes]);
      entry = entries.at(++e);
    }
    planned.push({
      dayKey: localDate,
      contribution: pairs.length === 0 ? null : Object.fromEntries(pairs),
    });
  }
  return planned;
}
