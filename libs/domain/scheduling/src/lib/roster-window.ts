import { LocationDayHours, LocationId } from '@creativo/domain/catalog';
import {
  BarberId as EcsBarberId,
  EndMinute,
  ExceptionEffect,
  LocalDate,
  LocationId as EcsLocationId,
  MinuteOfDay,
  type TimeZone,
  UtcEpochMs,
  type Weekday,
  defect,
} from '@core/primitives';
import {
  DayHours,
  type ExceptionEffectRule,
  type MinuteRange,
  type RosterWindow as EcsRosterWindow,
  type ScheduleVersion,
  ShiftSegment as EcsShiftSegment,
  ShopDayHours as EcsShopDayHours,
} from '@core/components';
import {
  type BuildDayWindowsInput as EcsBuildDayWindowsInput,
  type DayException,
  RosterSystem,
  ScheduleExceptionSystem,
  type ShopHours,
  ZonedTimeSystem,
} from '@core/systems';
import { CalendarDay } from './calendar-day';
import { Interval } from './interval';
import { ScheduleException, toEcsDetail } from './schedule-exception';
import { StaffScheduleHistory } from './staff-schedule';
import { isUnambiguousMinute } from './unambiguous-minute';
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
  const at = shopDayOf(day);
  if (at === null) return null;
  // The day's own entry decides; one whose clock does not parse imposes no
  // bound (the legacy reading), whatever the other six say.
  const entry = weeklyHours.at(LocalDate.weekday(at.localDate) - 1);
  if (weeklyHours.length === 7 && entry !== undefined && !parses(entry)) {
    return null;
  }
  const hours = RosterSystem.shopDayHours(weekOf(weeklyHours), at.localDate);
  if (hours === null) return null;
  // An opening or closing minute the day's DST transition erased or repeats
  // names no instant: the shop is closed that day rather than opened at a
  // time nobody published (the legacy drop rule).
  for (const open of hours) {
    if (
      !unambiguous(at, open.openMinutes) ||
      !unambiguous(at, open.closeMinutes)
    ) {
      return { locationId, intervals: [] };
    }
  }
  return {
    locationId,
    intervals: hours.map((open) =>
      Interval.of(
        instantOf(at, open.openMinutes),
        instantOf(at, open.closeMinutes),
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
  const at = shopDayOf(input.day);
  if (at === null) return [];
  return toLegacyWindows(
    RosterSystem.buildDayWindows(toEcsInput(input, at)),
    at,
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
  const at = shopDayOf(input.day);
  if (at === null) return [];
  return toLegacyWindows(
    RosterSystem.buildDayCarveOuts(toEcsInput(input, at)),
    at,
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

/* ── Phase 2 shim converters: legacy shapes ↔ ecs-core structs ──────────── */

/**
 * The legacy day as the systems read it: its shop day (`localDate`) and the
 * zone its instants are read in — the zone the `CalendarDay` already holds,
 * the shim's one boundary (Law 7.3: the roster itself is zone-blind).
 */
type ShopDay = { readonly localDate: LocalDate; readonly timeZone: TimeZone };

/** `null` for a key or a zone the engine cannot read (the legacy empty table). */
function shopDayOf(day: CalendarDay): ShopDay | null {
  const localDate = LocalDate.parse(day.key());
  const timeZone = ZonedTimeSystem.checkZone(day.zone);
  return localDate.ok && timeZone.ok
    ? { localDate: localDate.value, timeZone: timeZone.value }
    : null;
}

/**
 * A wall-clock minute of the day → the instant, as the legacy day table read
 * it: a minute the spring-forward erased resolves FORWARD to the first
 * minute that exists (the transition instant), so a window spanning the
 * switch keeps its real length; a repeated minute is its first occurrence
 * (`toUtc`'s earlier offset); `1440` is the next day's first instant.
 */
function instantOf(at: ShopDay, wall: number): number {
  for (let minute = wall; minute < 1440; minute++) {
    const parsed = MinuteOfDay.of(minute);
    if (!parsed.ok) break;
    const instant = ZonedTimeSystem.toUtc(
      at.localDate,
      parsed.value,
      at.timeZone,
    );
    if (instant.ok) return instant.value;
  }
  return ZonedTimeSystem.startOfLocalDay(
    LocalDate.addDays(at.localDate, 1),
    at.timeZone,
  );
}

/** Does a declared minute of the day name exactly one instant (the legacy drop rule)? */
function unambiguous(at: ShopDay, minutes: number): boolean {
  return isUnambiguousMinute(at.localDate, minutes, at.timeZone);
}

/** A declared range of the day survives only when both its ends are unambiguous. */
function declaredRanges(
  at: ShopDay,
  ranges: readonly MinuteRange[],
): readonly MinuteRange[] {
  return ranges.filter(
    (range) =>
      unambiguous(at, range.startMinutes) && unambiguous(at, range.endMinutes),
  );
}

/**
 * An instant → the wall-clock minute of the day it falls in (the inverse of
 * {@link instantOf}), counted past `1440` for an instant on a later day — the
 * legacy linear axis.
 */
function minuteOf(at: ShopDay, instantMs: number): number {
  const wall = ZonedTimeSystem.toLocal(
    sure(UtcEpochMs.of(instantMs), 'an instant'),
    at.timeZone,
  );
  return (
    LocalDate.daysBetween(at.localDate, wall.localDate) * 1440 + wall.minute
  );
}

function parses(entry: LocationDayHours): boolean {
  return (
    entry.kind === 'closed' ||
    (DayHours.parseClock(entry.opens).ok &&
      DayHours.parseClock(entry.closes).ok)
  );
}

/**
 * `'HH:mm'` → minutes; an entry that does not parse reads as closed here (see
 * `shopDayHours`). A closing `00:00` opens nothing (an inverted day, as the
 * legacy figures read it): closed.
 */
function weekOf(weekly: readonly LocationDayHours[]): readonly DayHours[] {
  return weekly.map((entry) => {
    if (entry.kind === 'closed') return DayHours.closed();
    const opens = DayHours.parseClock(entry.opens);
    const closes = DayHours.parseClock(entry.closes);
    const end = closes.ok ? EndMinute.of(closes.value) : null;
    return opens.ok && end !== null && end.ok
      ? DayHours.open(opens.value, end.value)
      : DayHours.closed();
  });
}

/** A legacy wall-clock figure → its brand; only valid figures reach here. */
function sure<T, E>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: E },
  what: string,
): T {
  // Unreachable: a legacy `TimeOfDay` / `CalendarDay` already holds every
  // rule the brand checks.
  if (!result.ok) defect(`unreachable: ${what}`);
  return result.value;
}

/** The roster history → its versions, the weekday map flattened to segments. */
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
          EcsShiftSegment.of(
            (index + 1) as Weekday,
            EcsLocationId.of(segment.locationId.value),
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

/** A published exception → its public effect (the reasoned detail collapses). */
function effectOf(exception: ScheduleException): ExceptionEffectRule | null {
  const effect = ScheduleExceptionSystem.publicEffect(
    toEcsDetail(exception.detail),
  );
  return effect.ok ? effect.value : null;
}

/**
 * Shop hours (instants) → minutes of the day, clipped to it: a part outside
 * the day bounds no segment (every segment is inside the day), so it is
 * dropped — `[]` stays "closed", `null` stays "no bound".
 */
function hoursOf(
  at: ShopDay,
  intervals: readonly Interval[],
): readonly EcsShopDayHours[] {
  const hours: EcsShopDayHours[] = [];
  for (const interval of intervals) {
    const open = Math.max(minuteOf(at, interval.startMs), 0);
    const close = Math.min(minuteOf(at, interval.endMs), 1440);
    const start = MinuteOfDay.of(open);
    const end = EndMinute.of(close);
    // An hours span whose edge the transition erased or repeats is dropped:
    // that shop is shut for it, whatever loaded the hours (the legacy rule).
    if (start.ok && end.ok && unambiguous(at, open) && unambiguous(at, close))
      hours.push(EcsShopDayHours.of(start.value, end.value));
  }
  return hours;
}

/**
 * The day's published effects with the legacy drop rule applied to every
 * declared range: a carve-out (`BLOCKED`) or replacement hours (`HOURS`)
 * whose edge the day's DST transition erased or repeats is dropped, never
 * placed on an instant nobody said.
 */
function declaredEffectOf(
  at: ShopDay,
  effect: ExceptionEffectRule,
): ExceptionEffectRule {
  return effect.exceptionEffect === ExceptionEffect.Closed
    ? effect
    : {
        ...effect,
        exceptionRanges: declaredRanges(at, effect.exceptionRanges),
      };
}

/**
 * The roster's versions for this day, its weekday's segments held to the
 * drop rule — unless an `HOURS` exception replaces them, when the roster
 * lends only its first shop and the replacement ranges are what is judged
 * (as the legacy roster judged them).
 */
function declaredVersionsOf(
  at: ShopDay,
  versions: readonly ScheduleVersion[],
  replaced: boolean,
): readonly ScheduleVersion[] {
  if (replaced) return versions;
  const weekday = LocalDate.weekday(at.localDate);
  return versions.map((version) => ({
    ...version,
    segments: version.segments.filter(
      (segment) =>
        segment.weekday !== weekday ||
        (unambiguous(at, segment.startMinutes) &&
          unambiguous(at, segment.endMinutes)),
    ),
  }));
}

/**
 * The legacy input → the system's: only the exceptions ON this day (key and
 * zone, as `CalendarDay.equals` reads them), each shop's hours as minutes of
 * the day (`null`: no bound, `[]`: closed). The barber is not part of the
 * legacy input; the windows' barber is not read back.
 */
function toEcsInput(
  input: BuildDayWindowsInput,
  at: ShopDay,
): EcsBuildDayWindowsInput {
  const exceptions: DayException[] = [];
  for (const exception of input.exceptions) {
    if (!exception.day.equals(input.day)) continue;
    const effect = effectOf(exception);
    if (effect !== null)
      exceptions.push({
        localDate: at.localDate,
        ...declaredEffectOf(at, effect),
      });
  }
  const replaced = exceptions.some(
    (exception) => exception.exceptionEffect === ExceptionEffect.Hours,
  );
  const shopHours: ShopHours[] = [...(input.shopHours ?? [])].map(
    ([locationId, hours]) => ({
      locationId: EcsLocationId.of(locationId),
      hours: hours === null ? null : hoursOf(at, hours.intervals),
    }),
  );
  return {
    barberId: EcsBarberId.of(''),
    localDate: at.localDate,
    versions: declaredVersionsOf(at, versionsOf(input.schedule), replaced),
    exceptions,
    shopHours,
  };
}

/** The system's minute windows → the legacy instant windows of the day. */
function toLegacyWindows(
  windows: readonly EcsRosterWindow[],
  at: ShopDay,
): readonly RosterWindow[] {
  const out: RosterWindow[] = [];
  for (const window of windows) {
    const locationId = LocationId.create(window.locationId);
    if (locationId.isFailure()) continue;
    const startMs = instantOf(at, window.startMinutes);
    const endMs = instantOf(at, window.endMinutes);
    // Never a window that holds no time.
    if (startMs >= endMs) continue;
    out.push({
      interval: Interval.of(startMs, endMs),
      locationId: locationId.value,
    });
  }
  return out;
}
