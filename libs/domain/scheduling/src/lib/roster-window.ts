import { LocationDayHours, LocationId } from '@creativo/domain/catalog';
import { CalendarDay } from './calendar-day';
import { Interval } from './interval';
import { LocalTimeOfDay } from './local-time-of-day';
import { ScheduleException } from './schedule-exception';
import { ShiftSegment } from './shift-segment';
import { StaffScheduleHistory } from './staff-schedule';
import { weekdayOf } from './weekday';

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
  if (weeklyHours.length !== 7) return null;
  // `Location.hours` is Mon-first; `CalendarDay.weekday()` is ISO 1..7.
  const entry = weeklyHours.at(day.weekday() - 1);
  if (entry === undefined) return null;
  if (entry.kind === 'closed') return { locationId, intervals: [] };

  const opens = LocalTimeOfDay.create(entry.opens);
  const closes = LocalTimeOfDay.create(entry.closes);
  if (opens.isFailure() || closes.isFailure()) return null;

  const start = opens.value.onDay(day);
  const end = closes.value.onDay(day);
  // A DST-erased opening time is dropped rather than guessed at — same rule
  // as a roster range, for the same reason.
  if (start.isFailure() || end.isFailure())
    return { locationId, intervals: [] };

  return {
    locationId,
    intervals: [Interval.of(start.value.toMillis(), end.value.toMillis())],
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
  const { day, schedule, exceptions, shopHours } = input;

  const relevant = exceptions.filter((exception) => exception.day.equals(day));

  // A location-wide closure, or any whole-day absence, ends it immediately.
  if (relevant.some((exception) => exception.isWholeDay())) {
    return [];
  }

  const version = schedule.versionFor(day);
  if (version === null) return [];

  const rostered = version.pattern.segmentsOn(weekdayOf(day));
  if (rostered.length === 0) return [];

  // An `hours` exception replaces the day's TIMES but not its places: the
  // barber is still covering the shop they were rostered at, just for
  // different hours. With a multi-shop day the override lands on the first
  // segment's location — an override that needs to move a barber between shops
  // is a roster amendment, not a one-day tweak.
  const override = relevant.find((exception) => exception.replacesRoster());
  const segments: readonly ShiftSegment[] =
    override && override.detail.kind === 'hours'
      ? override.detail.ranges.map((range) =>
          ShiftSegment.of(range, (rostered[0] as ShiftSegment).locationId),
        )
      : rostered;

  // Carve-outs: breaks and admin blocks sit inside a day that is still
  // worked. They are subtracted from the WINDOWS (not merely marked busy) so
  // that unpaid time never enters the capacity denominator in the first place.
  const carveOuts = Interval.normalize(
    relevant.flatMap((exception) => {
      const detail = exception.detail;
      if (detail.kind !== 'break' && detail.kind !== 'admin') return [];
      return detail.ranges.flatMap((range) => {
        const start = range.start.onDay(day);
        const end = range.end.onDay(day);
        if (start.isFailure() || end.isFailure()) return [];
        return [Interval.of(start.value.toMillis(), end.value.toMillis())];
      });
    }),
  );

  const windows: RosterWindow[] = [];
  for (const segment of segments) {
    const start = segment.start.onDay(day);
    const end = segment.end.onDay(day);
    // A segment the day's DST transition erased is DROPPED rather than
    // guessed at. It cannot be silently relocated: a roster claiming an hour
    // that does not exist is an authoring problem, and inventing a different
    // hour would book a client at a time nobody rostered.
    if (start.isFailure() || end.isFailure()) continue;

    const worked = Interval.of(start.value.toMillis(), end.value.toMillis());

    // This shop's hours are a hard bound on the PUBLIC surface. A shop that
    // publishes none imposes none; one that publishes `closed` for today
    // bounds the segment to nothing. See `ShopDayHours`.
    const hours = shopHours?.get(segment.locationId.value) ?? null;
    const bounded = hours
      ? Interval.intersect([worked], hours.intervals)
      : [worked];

    for (const interval of Interval.subtract(bounded, carveOuts)) {
      windows.push({ interval, locationId: segment.locationId });
    }
  }

  return windows.sort(
    (a, b) =>
      a.interval.startMs - b.interval.startMs ||
      a.locationId.value.localeCompare(b.locationId.value),
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
  return Interval.totalMinutes(windows.map((window) => window.interval));
}
