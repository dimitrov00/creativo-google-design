import { LocationDayHours, LocationId } from '@creativo/domain/catalog';
import {
  BarberId as EcsBarberId,
  type DayException,
  DayHours,
  DayKey,
  type DayOffset,
  type ExceptionEffect,
  IntervalSetSystem,
  LocationId as EcsLocationId,
  type RosterWindow as EcsRosterWindow,
  RosterSystem,
  ScheduleExceptionSystem,
  type ScheduleVersion,
  type ShopHours,
  ShiftSegment as EcsShiftSegment,
  type Weekday,
  ZonedTimeSystem,
} from '@creativo/ecs-core';
import { CalendarDay } from './calendar-day';
import { Interval } from './interval';
import { ScheduleException, toEcsDetail } from './schedule-exception';
import { StaffScheduleHistory } from './staff-schedule';
import { WEEKDAYS } from './weekday';

/**
 * A materialised stretch of a barber's rostered day, as real instants.
 *
 * `locationId` rides on the WINDOW rather than on the day document, because a
 * barber may work two shops in one day and the utilisation of each shop has to
 * be attributable. Keying the document on the barber alone (not the barber and
 * a location) is what makes "is Ivan free at 14:00" one lookup regardless of
 * where he is.
 */
export interface RosterWindow {
  readonly interval: Interval;
  readonly locationId: LocationId;
}

/**
 * The shop's own opening hours for a day, already materialised.
 *
 * The two "no hours" cases are DIFFERENT and the distinction is carried by
 * presence, not by emptiness:
 *
 * - `null` — the shop publishes no hours at all, so it imposes no bound and
 *   the barber's roster stands as written.
 * - `{intervals: []}` — the shop publishes hours and today's entry is
 *   `closed`. Intersecting with the empty set yields nothing, which is the
 *   correct answer: the door is locked, so nothing is publicly bookable.
 *
 * Collapsing the two would make a shop's closed Sunday quietly offer whatever
 * that barber's weekly pattern happens to say.
 */
export interface ShopDayHours {
  readonly locationId: LocationId;
  readonly intervals: readonly Interval[];
}

/**
 * `Location.hours` → this day's `ShopDayHours`.
 *
 * Lives here rather than in an adapter because the browser's grid and the
 * server's commit-time re-check must clamp to the same envelope; two
 * implementations of "what does Monday mean in a Mon-first array" is exactly
 * the kind of drift that shows up as a booking the shop cannot honour.
 */
export function shopDayHours(
  day: CalendarDay,
  locationId: LocationId,
  weeklyHours: readonly LocationDayHours[],
): ShopDayHours | null {
  const row = dayRowOf(day);
  if (row === null) return null;
  // The day's own entry decides; one whose clock does not parse imposes no
  // bound (the legacy reading), whatever the other six say.
  const entry = weeklyHours.at(row.weekday - 1);
  if (weeklyHours.length === 7 && entry !== undefined && !parses(entry)) {
    return null;
  }
  const hours = RosterSystem.shopDayHours(weekOf(weeklyHours), row);
  if (hours === null) return null;
  return {
    locationId,
    intervals: hours.map((open) =>
      Interval.of(
        ZonedTimeSystem.instantOf(row, open.openMinutes),
        ZonedTimeSystem.instantOf(row, open.closeMinutes),
      ),
    ),
  };
}

export interface BuildDayWindowsInput {
  readonly day: CalendarDay;
  readonly schedule: StaffScheduleHistory;
  /** Exceptions for this day only — location-wide and this barber's. */
  readonly exceptions: readonly ScheduleException[];
  /**
   * Published hours PER SHOP, keyed by `LocationId.value`.
   *
   * A map rather than one value because a barber's day can span two shops, and
   * each segment must be clipped to the hours of the shop it is worked at —
   * clipping a Mladost afternoon against Center's hours is how a client gets
   * offered a time at a locked door. A key that is absent means that shop
   * publishes no hours and imposes no bound; a key mapped to `{intervals: []}`
   * means it is closed that day. See {@link ShopDayHours}.
   */
  readonly shopHours?: ReadonlyMap<string, ShopDayHours | null> | null;
}

/**
 * Materialise a barber's rostered windows for one calendar day.
 *
 * ### The bookable-window / valid-placement split (owner ruling, 2026-07-29)
 * What this returns is the **bookable window**: what a client may be offered
 * on the public `/book` surface. It is deliberately the INTERSECTION of the
 * barber's roster with the shop's published hours, so a client can never be
 * offered a time the shop is shut.
 *
 * It is NOT a bound on what can exist. Staff may place an appointment
 * anywhere, including outside these windows — a barber taking a regular at
 * 08:00 before the shop opens is a real thing, and it is tracked, occupies
 * that barber's time, and counts in their statistics. It simply never becomes
 * publicly bookable, and it never changes the shop's hours. Enforcing that
 * split here rather than at the write path is what keeps a permissive staff
 * action from quietly widening the public surface.
 *
 * ### Order of application
 * 1. The pattern in force that day, segment by segment — each carrying the
 *    shop it is worked at. An `hours` exception replaces the day's times but
 *    keeps the location of the segment it replaces.
 * 2. Intersect each segment with ITS OWN shop's published hours.
 * 3. Subtract every whole-day absence and every carved-out range.
 *
 * A whole-day absence yields no windows at all — the day leaves the capacity
 * denominator entirely, which is why a barber is never penalised in
 * utilisation for a holiday.
 *
 * Windows come back sorted by start and tagged with their location, so a
 * caller booking at one shop filters to the windows worked there while a
 * caller computing utilisation attributes each to the right shop.
 */
export function buildDayWindows(
  input: BuildDayWindowsInput,
): readonly RosterWindow[] {
  const row = dayRowOf(input.day);
  if (row === null) return [];
  return toLegacyWindows(
    RosterSystem.buildDayWindows(toEcsInput(input, row), [row]),
    row,
  );
}

/**
 * The carved-out stretches of a worked day — what `buildDayWindows` REMOVES,
 * returned as things in their own right.
 *
 * ### Why this exists
 * A break is modelled as an absence: `buildDayWindows` subtracts it and hands
 * back the survivors, so by the time any UI sees the day, "Ivan is on lunch",
 * "Ivan is not rostered" and "the shop is shut" are the same fact — no
 * window. That is correct for capacity and wrong for everything else. A staff
 * calendar has to draw a block as a block: it is a thing someone created, it
 * has a start and an end, and it is the only kind of non-visit time a person
 * can be expected to move or remove.
 *
 * ### A separate function, not a wider return type
 * `buildDayWindows` has six production callers across the browser grid, the
 * commit re-check and the capacity rebuild, and every one of them is doing
 * arithmetic that must not change. This asks the second question without
 * touching the answer to the first.
 *
 * ### Clipped to the day that would otherwise be worked
 * A block is only drawable where there was something to block. An exception
 * carving 13:00–14:00 out of a barber who is not rostered until 14:00 has
 * removed nothing, and drawing it would put a solid rectangle over hours the
 * shop was already shut — inventing an event out of a no-op.
 */
export function buildDayCarveOuts(
  input: BuildDayWindowsInput,
): readonly RosterWindow[] {
  const row = dayRowOf(input.day);
  if (row === null) return [];
  return toLegacyWindows(
    RosterSystem.buildDayCarveOuts(toEcsInput(input, row), [row]),
    row,
  );
}

/** Only the windows worked at one shop — what a booking at that shop may use. */
export function windowsAt(
  windows: readonly RosterWindow[],
  locationId: LocationId,
): readonly RosterWindow[] {
  return windows.filter((window) => window.locationId.equals(locationId));
}

/** Total rostered minutes — the raw figure `scheduledMinutes` starts from. */
export function rosteredMinutes(windows: readonly RosterWindow[]): number {
  return IntervalSetSystem.totalMinutes(
    windows.map((window) => window.interval),
  );
}

/* ── Phase 2 shim converters: legacy shapes ↔ ecs-core structs ──────────── */

/** The day's row of its zone's table — the one place its offsets are read. */
function dayRowOf(day: CalendarDay): DayOffset | null {
  const key = DayKey.of(day.key());
  return ZonedTimeSystem.dayTable(day.zone, key, key)[0] ?? null;
}

function parses(entry: LocationDayHours): boolean {
  return (
    entry.kind === 'closed' ||
    (DayHours.parseClock(entry.opens).ok &&
      DayHours.parseClock(entry.closes).ok)
  );
}

/** `'HH:mm'` → minutes; an entry that does not parse reads as closed here (see `shopDayHours`). */
function weekOf(weekly: readonly LocationDayHours[]): readonly DayHours[] {
  return weekly.map((entry) => {
    if (entry.kind === 'closed') return DayHours.closed();
    const opens = DayHours.parseClock(entry.opens);
    const closes = DayHours.parseClock(entry.closes);
    return opens.ok && closes.ok
      ? DayHours.open(opens.value, closes.value)
      : DayHours.closed();
  });
}

/** The roster history → its versions, the weekday map flattened to segments. */
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
          EcsShiftSegment.of(
            (index + 1) as Weekday,
            EcsLocationId.of(segment.locationId.value),
            segment.start.minutesFromMidnight(),
            segment.end.minutesFromMidnight(),
          ),
        ),
    ),
  }));
}

/** A published exception → its public effect (the reasoned detail collapses). */
function effectOf(exception: ScheduleException): ExceptionEffect | null {
  const effect = ScheduleExceptionSystem.publicEffect(
    toEcsDetail(exception.detail),
  );
  return effect.ok ? effect.value : null;
}

/**
 * The legacy input → the system's: only the exceptions ON this day (key and
 * zone, as `CalendarDay.equals` reads them), each shop's hours as minutes of
 * the day (`null`: no bound, `[]`: closed). The barber is not part of the
 * legacy input; the windows' barber is not read back.
 */
function toEcsInput(input: BuildDayWindowsInput, row: DayOffset) {
  const exceptions: DayException[] = [];
  for (const exception of input.exceptions) {
    if (!exception.day.equals(input.day)) continue;
    const effect = effectOf(exception);
    if (effect !== null) exceptions.push({ dayKey: row.dayKey, effect });
  }
  const shopHours: ShopHours[] = [...(input.shopHours ?? [])].map(
    ([locationId, hours]) => ({
      locationId: EcsLocationId.of(locationId),
      hours:
        hours === null
          ? null
          : hours.intervals.map((interval) => ({
              openMinutes: ZonedTimeSystem.minuteOfDay(interval.startMs, row),
              closeMinutes: ZonedTimeSystem.minuteOfDay(interval.endMs, row),
            })),
    }),
  );
  return {
    barberId: EcsBarberId.of(''),
    dayKey: row.dayKey,
    versions: versionsOf(input.schedule),
    exceptions,
    shopHours,
  };
}

/** The system's minute windows → the legacy instant windows of the day. */
function toLegacyWindows(
  windows: readonly EcsRosterWindow[],
  row: DayOffset,
): readonly RosterWindow[] {
  const out: RosterWindow[] = [];
  for (const window of windows) {
    const locationId = LocationId.create(window.locationId);
    if (locationId.isFailure()) continue;
    out.push({
      interval: Interval.of(
        ZonedTimeSystem.instantOf(row, window.startMinutes),
        ZonedTimeSystem.instantOf(row, window.endMinutes),
      ),
      locationId: locationId.value,
    });
  }
  return out;
}
