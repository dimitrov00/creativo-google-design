import type { DayKey } from '../components/day-key.data';
import { DayOffset } from '../components/day-offset.data';
import { ExceptionEffectKind } from '../components/exception-effect.data';
import type { MinuteRange } from '../components/minute-range.data';
import { type DayHours, DayHoursKind } from '../components/opening-hours.data';
import { RosterWindow, ShopDayHours } from '../components/roster-window.data';
import {
  ScheduleVersion,
  ShiftSegment,
} from '../components/schedule-version.data';
import { TimeInterval } from '../components/time-interval.data';
import type { Weekday } from '../components/weekday.data';
import type { BarberId } from '../entities/barber.entity';
import type { LocationId } from '../entities/location.entity';
import type { ScheduleExceptionEntity } from '../entities/schedule-exception.entity';
import { IntervalSetSystem } from './interval-set.system';
import { ZonedTimeSystem } from './zoned-time.system';

/**
 * An exception as the roster reads it: its day and its PUBLIC effect — the
 * two components of a `ScheduleExceptionEntity` this system needs, so the
 * stored entity passes straight in (no mapping) and a test can hand a bare
 * pair. Whose exception it is (a barber's own, or a shop closure fanned out
 * to every barber) is the loader's question; the roster applies every one it
 * is given that falls on its day.
 */
export type DayException = Pick<ScheduleExceptionEntity, 'dayKey' | 'effect'>;

/**
 * One shop's published hours for the day (`roster-window.ts:39`). The two
 * "no hours" cases are DIFFERENT and the distinction is carried by `null`
 * versus empty, never collapsed:
 *
 * - `hours: null` — the shop publishes no hours at all: it imposes no bound
 *   and the barber's roster stands as written (so does a shop with no entry);
 * - `hours: []` — the shop publishes hours and today it is closed:
 *   intersecting with the empty set yields nothing, which is right — the
 *   door is locked, so nothing is publicly bookable.
 *
 * Collapsing the two would make a shop's closed Sunday quietly offer whatever
 * that barber's weekly pattern happens to say. `hours` is
 * {@link RosterSystem.shopDayHours}'s answer for the shop.
 */
export type ShopHours = {
  readonly locationId: LocationId;
  readonly hours: readonly ShopDayHours[] | null;
};

/**
 * Everything one barber-day of windows is computed from
 * (`roster-window.ts:80-96`), every field present: the barber, the day, the
 * stored roster history, the exceptions (other days' are ignored) and the
 * hours PER SHOP — a list rather than one value because a barber's day can
 * span two shops, and each segment must be clipped to the hours of the shop
 * it is worked at (clipping a Mladost afternoon against Center's hours is how
 * a client gets offered a time at a locked door). `[]` means no shop bounds
 * anything.
 */
export type BuildDayWindowsInput = {
  readonly barberId: BarberId;
  readonly dayKey: DayKey;
  readonly versions: readonly ScheduleVersion[];
  readonly exceptions: readonly DayException[];
  readonly shopHours: readonly ShopHours[];
};

/**
 * Does `wallMinutes` name exactly one instant on this day? `false` inside the
 * segment a spring-forward ERASED (`[at, at + Δ)`) and inside the segment a
 * fall-back REPEATS (`[at + Δ, at)`, Δ negative) — read straight off the
 * row's transition fields, no zone math. The legacy `LocalTimeOfDay.onDay`
 * refused both (the kernel's `atTime` with its `reject` default), and a roster
 * boundary nobody can place on a single instant is dropped rather than
 * guessed at.
 */
function isUnambiguous(day: DayOffset, wallMinutes: number): boolean {
  const at = day.transitionAtMinutes;
  if (at === null) return true;
  const delta = day.transitionDeltaMinutes;
  return delta >= 0
    ? wallMinutes < at || wallMinutes >= at + delta
    : wallMinutes < at + delta || wallMinutes >= at;
}

/** A wall-clock span of the row's day → instants (`ZonedTimeSystem.instantOf`). */
function spanOf(
  day: DayOffset,
  startMinutes: number,
  endMinutes: number,
): TimeInterval {
  return TimeInterval.of(
    ZonedTimeSystem.instantOf(day, startMinutes),
    ZonedTimeSystem.instantOf(day, endMinutes),
  );
}

/** The exceptions that fall on `dayKey`, in their given order. */
function exceptionsOn(
  exceptions: readonly DayException[],
  dayKey: DayKey,
): readonly DayException[] {
  const relevant: DayException[] = [];
  for (let i = 0; i < exceptions.length; i++) {
    const exception = exceptions[i] as DayException;
    if (exception.dayKey === dayKey) relevant.push(exception);
  }
  return relevant;
}

/** Any whole-day absence (every reason collapses to `closed`) ends the day. */
function hasWholeDayAbsence(relevant: readonly DayException[]): boolean {
  for (let i = 0; i < relevant.length; i++) {
    if (
      (relevant[i] as DayException).effect.kind === ExceptionEffectKind.Closed
    )
      return true;
  }
  return false;
}

/** The first `hours` exception's ranges — the day's replacement times — or `null`. */
function hoursOverride(
  relevant: readonly DayException[],
): readonly MinuteRange[] | null {
  for (let i = 0; i < relevant.length; i++) {
    const effect = (relevant[i] as DayException).effect;
    if (effect.kind === ExceptionEffectKind.Hours) return effect.ranges;
  }
  return null;
}

/**
 * The carve-outs the day's `blocked` exceptions ask for, as one normalized
 * instant set — breaks and admin blocks alike (both are `blocked` in the
 * public effect). A range a DST transition made unplaceable is dropped.
 *
 * Extracted so that "what does a break subtract" ({@link
 * RosterSystem.buildDayWindows}) and "what does a break LOOK like" ({@link
 * RosterSystem.buildDayCarveOuts}) can never disagree.
 */
function carveOutsOn(
  relevant: readonly DayException[],
  day: DayOffset,
): readonly TimeInterval[] {
  const spans: TimeInterval[] = [];
  for (let i = 0; i < relevant.length; i++) {
    const effect = (relevant[i] as DayException).effect;
    if (effect.kind !== ExceptionEffectKind.Blocked) continue;
    for (let k = 0; k < effect.ranges.length; k++) {
      const range = effect.ranges[k] as MinuteRange;
      if (
        isUnambiguous(day, range.startMinutes) &&
        isUnambiguous(day, range.endMinutes)
      ) {
        spans.push(spanOf(day, range.startMinutes, range.endMinutes));
      }
    }
  }
  return IntervalSetSystem.normalize(spans);
}

/** The weekday's segments of the version, in time order (a sorted copy). */
function segmentsOn(
  segments: readonly ShiftSegment[],
  weekday: Weekday,
): readonly ShiftSegment[] {
  const own: ShiftSegment[] = [];
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i] as ShiftSegment;
    if (segment.weekday === weekday) own.push(segment);
  }
  return own.sort(ShiftSegment.compare);
}

/** The first matching shop's hours; `null` (no bound) when it has no entry. */
function hoursAt(
  shopHours: readonly ShopHours[],
  locationId: LocationId,
): readonly ShopDayHours[] | null {
  for (let i = 0; i < shopHours.length; i++) {
    const entry = shopHours[i] as ShopHours;
    if (entry.locationId === locationId) return entry.hours;
  }
  return null;
}

/** `ShopDayHours` spans as minute ranges (the two shapes name one thing). */
function hoursAsRanges(hours: readonly ShopDayHours[]): readonly MinuteRange[] {
  const ranges: MinuteRange[] = [];
  for (let i = 0; i < hours.length; i++) {
    const entry = hours[i] as ShopDayHours;
    ranges.push({
      startMinutes: entry.openMinutes,
      endMinutes: entry.closeMinutes,
    });
  }
  return ranges;
}

/** Code-unit order — runtime-locale independent, so browser and server agree. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byStartThenLocation(a: RosterWindow, b: RosterWindow): number {
  return (
    a.startMinutes - b.startMinutes || compareIds(a.locationId, b.locationId)
  );
}

function byStart(a: RosterWindow, b: RosterWindow): number {
  return a.startMinutes - b.startMinutes;
}

/**
 * RosterSystem — a barber's rostered day, as wall-clock windows
 * (`roster-window.ts:52-294`, `staff-schedule.ts:144`).
 *
 * No `Intl`, no date library: the weekday that indexes the roster's segments
 * and the shop's seven `DayHours` is the table row's `DayOffset.weekday`, and
 * minutes ↔ instants is `ZonedTimeSystem.instantOf` / `minuteOfDay` — the
 * two-branch subtraction over the row. The set arithmetic itself runs on
 * instants through `IntervalSetSystem`, exactly as the legacy class did, so a
 * shift spanning a transition keeps its REAL length; windows come back in
 * minutes of the day, which round-trip exactly because every boundary that
 * reaches them is unambiguous.
 */
export const RosterSystem = {
  /**
   * The version in force on `dayKey`, or `null` before the first version
   * began (or in a gap the history leaves). Linear: a roster has a handful.
   */
  versionFor(
    versions: readonly ScheduleVersion[],
    dayKey: DayKey,
  ): ScheduleVersion | null {
    for (let i = 0; i < versions.length; i++) {
      const version = versions[i] as ScheduleVersion;
      if (ScheduleVersion.coversDay(version, dayKey)) return version;
    }
    return null;
  },

  /**
   * A shop's seven `DayHours` → this day's hours (`roster-window.ts:52-78`),
   * indexed by the row's ISO `weekday` (Mon-first, index `weekday − 1`).
   *
   * - `null` — no usable week (not exactly seven entries): the shop imposes
   *   no bound;
   * - `[]` — closed today, OR an opening/closing minute the day's DST
   *   transition erased or repeated: dropped rather than guessed at, the same
   *   rule as a roster range;
   * - one `ShopDayHours` otherwise.
   *
   * Lives here, not in an adapter, because the browser's grid and the
   * server's commit-time re-check must clamp to the same envelope.
   */
  shopDayHours(
    week: readonly DayHours[],
    day: DayOffset,
  ): readonly ShopDayHours[] | null {
    if (week.length !== 7) return null;
    const entry = week[day.weekday - 1];
    if (entry === undefined) return null;
    if (entry.kind === DayHoursKind.Closed) return [];
    if (
      !isUnambiguous(day, entry.openMinutes) ||
      !isUnambiguous(day, entry.closeMinutes)
    ) {
      return [];
    }
    return [ShopDayHours.of(entry.openMinutes, entry.closeMinutes)];
  },

  /**
   * A barber's rostered windows for one day — the BOOKABLE window
   * (`roster-window.ts:98-196`): what a client may be offered on `/book`.
   *
   * It is deliberately the roster INTERSECTED with each shop's published
   * hours, so a client is never offered a time the shop is shut — and it is
   * NOT a bound on what can exist: staff may place a visit anywhere
   * (`PlacementPolicy.allowOutsideWindow`); that visit occupies real time and
   * counts in the statistics, it is simply never publicly bookable.
   *
   * Order of application:
   * 1. a whole-day absence on the day (`closed`) yields nothing at all — the
   *    day leaves the capacity denominator, so nobody is penalised in
   *    utilisation for a holiday;
   * 2. the version in force that day, the row weekday's segments — each
   *    carrying the shop it is worked at. An `hours` exception replaces the
   *    TIMES but keeps the place: its ranges land on the first segment's
   *    shop (moving a barber between shops is a roster amendment, not a
   *    one-day tweak), and it cannot open a weekday the roster does not work;
   * 3. a segment whose start or end the day's DST transition erased (or
   *    repeated) is DROPPED — a roster claiming an hour that does not exist
   *    is an authoring problem, and inventing another hour would book a
   *    client at a time nobody rostered;
   * 4. each segment intersected with ITS OWN shop's hours (no entry or
   *    `null`: no bound; `[]`: closed). An hours span whose opening or
   *    closing minute the day's DST transition erased or repeated is dropped,
   *    exactly as {@link shopDayHours} drops it — so hours mapped straight
   *    from a stored week close the shop that day instead of snapping;
   * 5. every `blocked` range subtracted — from the windows, not merely
   *    marked busy, so unpaid time never enters the capacity denominator.
   *
   * Sorted by start, then shop (code-unit order). A day the table does not
   * cover yields nothing: fail closed.
   */
  buildDayWindows(
    input: BuildDayWindowsInput,
    days: readonly DayOffset[],
  ): readonly RosterWindow[] {
    const day = DayOffset.find(input.dayKey, days);
    if (day === null) return [];

    const relevant = exceptionsOn(input.exceptions, input.dayKey);
    if (hasWholeDayAbsence(relevant)) return [];

    const version = RosterSystem.versionFor(input.versions, input.dayKey);
    if (version === null) return [];

    const rostered = segmentsOn(version.segments, day.weekday);
    const first = rostered[0];
    if (first === undefined) return [];

    const override = hoursOverride(relevant);
    let segments = rostered;
    if (override !== null) {
      const replaced: ShiftSegment[] = [];
      for (let i = 0; i < override.length; i++) {
        const range = override[i] as MinuteRange;
        replaced.push(
          ShiftSegment.of(
            day.weekday,
            first.locationId,
            range.startMinutes,
            range.endMinutes,
          ),
        );
      }
      segments = replaced;
    }

    const carveOuts = carveOutsOn(relevant, day);

    const windows: RosterWindow[] = [];
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i] as ShiftSegment;
      if (
        !isUnambiguous(day, segment.startMinutes) ||
        !isUnambiguous(day, segment.endMinutes)
      ) {
        continue;
      }
      const worked = spanOf(day, segment.startMinutes, segment.endMinutes);
      const hours = hoursAt(input.shopHours, segment.locationId);
      // Resolved, not total: an opening or closing minute the transition
      // erased or repeated drops its span, so the shop is closed that day —
      // the `shopDayHours` rule, enforced here too, whatever loaded the hours.
      const bounded =
        hours === null
          ? [worked]
          : IntervalSetSystem.intersect(
              [worked],
              RosterSystem.resolvedIntervalsOf(hoursAsRanges(hours), day),
            );
      const kept = IntervalSetSystem.subtract(bounded, carveOuts);
      for (let k = 0; k < kept.length; k++) {
        const interval = kept[k] as TimeInterval;
        windows.push(
          RosterWindow.of(
            input.barberId,
            segment.locationId,
            ZonedTimeSystem.minuteOfDay(interval.startMs, day),
            ZonedTimeSystem.minuteOfDay(interval.endMs, day),
          ),
        );
      }
    }
    return windows.sort(byStartThenLocation);
  },

  /**
   * The carved-out stretches of a worked day — what {@link buildDayWindows}
   * REMOVES, returned as things in their own right (`roster-window.ts:223-283`).
   * A staff calendar has to draw "Ivan is on lunch" as a block someone made,
   * not as the same absence as "not rostered" or "the shop is shut".
   *
   * Clipped to the time that would otherwise be worked: the day is re-run
   * WITHOUT its carve-outs (one implementation of the order of application,
   * never a second copy) and intersected with them, so a block over hours
   * nobody works, or outside the shop's hours, draws nothing. A whole-day
   * absence leaves no worked time for a block to sit in. Sorted by start.
   */
  buildDayCarveOuts(
    input: BuildDayWindowsInput,
    days: readonly DayOffset[],
  ): readonly RosterWindow[] {
    const day = DayOffset.find(input.dayKey, days);
    if (day === null) return [];

    const relevant = exceptionsOn(input.exceptions, input.dayKey);
    if (hasWholeDayAbsence(relevant)) return [];

    const carveOuts = carveOutsOn(relevant, day);
    if (carveOuts.length === 0) return [];

    const unblocked: DayException[] = [];
    for (let i = 0; i < relevant.length; i++) {
      const exception = relevant[i] as DayException;
      if (exception.effect.kind !== ExceptionEffectKind.Blocked)
        unblocked.push(exception);
    }
    const worked = RosterSystem.buildDayWindows(
      { ...input, exceptions: unblocked },
      days,
    );

    const blocks: RosterWindow[] = [];
    for (let i = 0; i < worked.length; i++) {
      const window = worked[i] as RosterWindow;
      const covered = IntervalSetSystem.intersect(
        [spanOf(day, window.startMinutes, window.endMinutes)],
        carveOuts,
      );
      for (let k = 0; k < covered.length; k++) {
        const interval = covered[k] as TimeInterval;
        blocks.push(
          RosterWindow.of(
            window.barberId,
            window.locationId,
            ZonedTimeSystem.minuteOfDay(interval.startMs, day),
            ZonedTimeSystem.minuteOfDay(interval.endMs, day),
          ),
        );
      }
    }
    return blocks.sort(byStart);
  },

  /** Only the windows worked at one shop — what a booking at that shop may use. */
  windowsAt(
    windows: readonly RosterWindow[],
    locationId: LocationId,
  ): readonly RosterWindow[] {
    const at: RosterWindow[] = [];
    for (let i = 0; i < windows.length; i++) {
      const window = windows[i] as RosterWindow;
      if (window.locationId === locationId) at.push(window);
    }
    return at;
  },

  /**
   * Total rostered REAL minutes — the raw figure `scheduledMinutes` starts
   * from. Measured on instants, so 02:00–06:00 is three hours on the
   * spring-forward day and five on the fall-back day; overlaps never count
   * twice.
   */
  rosteredMinutes(windows: readonly RosterWindow[], day: DayOffset): number {
    return IntervalSetSystem.totalMinutes(
      RosterSystem.intervalsOf(windows, day),
    );
  },

  /**
   * Wall-clock spans of the row's day → instants, one for one and total
   * (a minute inside an erased segment resolves forward, a repeated one to
   * its first occurrence — `ZonedTimeSystem.instantOf`). How a roster
   * window becomes the `windows` an availability search takes. A
   * `RosterWindow` is a `MinuteRange` structurally, so both pass.
   */
  intervalsOf(
    ranges: readonly MinuteRange[],
    day: DayOffset,
  ): readonly TimeInterval[] {
    const out: TimeInterval[] = [];
    for (let i = 0; i < ranges.length; i++) {
      const range = ranges[i] as MinuteRange;
      out.push(spanOf(day, range.startMinutes, range.endMinutes));
    }
    return out;
  },

  /**
   * Like {@link intervalsOf}, but a span whose start or end the day's DST
   * transition erased or repeated is DROPPED rather than placed — the rule
   * for a span somebody DECLARED (a client's window, an exception range):
   * losing one span beats inventing an instant nobody said.
   */
  resolvedIntervalsOf(
    ranges: readonly MinuteRange[],
    day: DayOffset,
  ): readonly TimeInterval[] {
    const out: TimeInterval[] = [];
    for (let i = 0; i < ranges.length; i++) {
      const range = ranges[i] as MinuteRange;
      if (
        isUnambiguous(day, range.startMinutes) &&
        isUnambiguous(day, range.endMinutes)
      ) {
        out.push(spanOf(day, range.startMinutes, range.endMinutes));
      }
    }
    return out;
  },
} as const;
