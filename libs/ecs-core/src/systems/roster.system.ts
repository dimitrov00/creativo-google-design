import {
  ExceptionEffect,
  type Weekday,
  type BarberId,
  type LocationId,
  LocalDate,
  EndMinute,
  MinuteCount,
  MinuteOfDay,
} from '@core/primitives';
import {
  type ExceptionEffectRule,
  MinuteRange,
  DayHours,
  OpeningState,
  RosterWindow,
  ShopDayHours,
  ShopOpening,
  ScheduleVersion,
  ShiftSegment,
} from '@core/components';
import type { ScheduleException, ShopLocation } from '@core/entities';
import { IntervalSetSystem } from './interval-set.system';

/**
 * An exception as the roster reads it: its shop day and its PUBLIC effect —
 * the slices of a `ScheduleException` this system needs, so the stored
 * entity passes straight in (no mapping) and a test can hand a bare pair.
 * Whose exception it is (a barber's own, or a shop closure fanned out to
 * every barber) is the loader's question; the roster applies every one it is
 * given that falls on its day.
 */
export type DayException = Pick<ScheduleException, 'localDate'> &
  ExceptionEffectRule;

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
 * Everything one barber's shop day of windows is computed from
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
  readonly localDate: LocalDate;
  readonly versions: readonly ScheduleVersion[];
  readonly exceptions: readonly DayException[];
  readonly shopHours: readonly ShopHours[];
};

/**
 * Where a shop stands against its week at one wall-clock minute
 * ({@link RosterSystem.shopOpeningAt}): the tag, the minute it names — the
 * closing minute while open, the opening minute otherwise, `null` when the
 * week opens on no day at all — and the shop day that minute falls on (today,
 * or the later day an `OPENS_ON` names).
 */
export type ShopOpeningAt = {
  readonly shopOpening: ShopOpening;
  readonly atMinutes: MinuteOfDay | EndMinute | null;
  readonly localDate: LocalDate;
};

/** The forward scan's reach: the same weekday next week included. */
const DAYS_IN_WEEK = 7;

/** The exceptions that fall on `localDate`, in their given order. */
function exceptionsOn(
  exceptions: readonly DayException[],
  localDate: LocalDate,
): readonly DayException[] {
  const relevant: DayException[] = [];
  for (let i = 0; i < exceptions.length; i++) {
    const exception = exceptions[i] as DayException;
    if (exception.localDate === localDate) relevant.push(exception);
  }
  return relevant;
}

/** Any whole-day absence (every reason collapses to `CLOSED`) ends the day. */
function hasWholeDayAbsence(relevant: readonly DayException[]): boolean {
  for (let i = 0; i < relevant.length; i++) {
    if (
      (relevant[i] as DayException).exceptionEffect === ExceptionEffect.Closed
    ) {
      return true;
    }
  }
  return false;
}

/** The first `HOURS` exception's ranges — the day's replacement times — or `null`. */
function hoursOverride(
  relevant: readonly DayException[],
): readonly MinuteRange[] | null {
  for (let i = 0; i < relevant.length; i++) {
    const exception = relevant[i] as DayException;
    if (exception.exceptionEffect === ExceptionEffect.Hours) {
      return exception.exceptionRanges;
    }
  }
  return null;
}

/**
 * The carve-outs the day's `BLOCKED` exceptions ask for, as one normalized
 * range set — breaks and admin blocks alike (both are `BLOCKED` in the
 * public effect).
 *
 * Extracted so that "what does a break subtract" ({@link
 * RosterSystem.buildDayWindows}) and "what does a break LOOK like" ({@link
 * RosterSystem.buildDayCarveOuts}) can never disagree.
 */
function carveOutsOn(
  relevant: readonly DayException[],
): readonly MinuteRange[] {
  const spans: MinuteRange[] = [];
  for (let i = 0; i < relevant.length; i++) {
    const exception = relevant[i] as DayException;
    if (exception.exceptionEffect !== ExceptionEffect.Blocked) continue;
    for (let k = 0; k < exception.exceptionRanges.length; k++) {
      spans.push(exception.exceptionRanges[k] as MinuteRange);
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

/** Is `locationId` one of the offered shops — an entry of `shopHours`? */
function offersShop(
  shopHours: readonly ShopHours[],
  locationId: LocationId,
): boolean {
  for (let i = 0; i < shopHours.length; i++) {
    if ((shopHours[i] as ShopHours).locationId === locationId) return true;
  }
  return false;
}

/** Only the windows at a shop `shopHours` names — {@link offersShop}. */
function atOfferedShops(
  windows: readonly RosterWindow[],
  shopHours: readonly ShopHours[],
): readonly RosterWindow[] {
  const kept: RosterWindow[] = [];
  for (let i = 0; i < windows.length; i++) {
    const window = windows[i] as RosterWindow;
    if (offersShop(shopHours, window.locationId)) kept.push(window);
  }
  return kept;
}

/** `ShopDayHours` spans as minute ranges (the two shapes name one thing). */
function hoursAsRanges(hours: readonly ShopDayHours[]): readonly MinuteRange[] {
  const ranges: MinuteRange[] = [];
  for (let i = 0; i < hours.length; i++) {
    const entry = hours[i] as ShopDayHours;
    ranges.push(MinuteRange.of(entry.openMinutes, entry.closeMinutes));
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
 * RosterSystem — a barber's rostered shop day, as wall-clock windows
 * (`roster-window.ts:52-294`, `staff-schedule.ts:144`).
 *
 * Time-zone-blind (Law 7.3, flatten-spec T1): the weekday that indexes the
 * roster's segments and the shop's seven `DayHours` is
 * `LocalDate.weekday(localDate)`, and all set arithmetic runs on the day's
 * `MinuteOfDay`/`EndMinute` coordinates through `IntervalSetSystem` — a
 * roster says "09:00–18:00" on the shop's clock, and that stays true across
 * a DST transition precisely because it has no zone. A wall-clock time a
 * transition erased is the ingestion boundary's business
 * (`ZonedTimeSystem.toUtc` → `DST_GAP_INVALID_TIME`), never the roster's.
 */
export const RosterSystem = {
  /**
   * The version in force on `localDate`, or `null` before the first version
   * began (or in a gap the history leaves). Linear: a roster has a handful.
   */
  versionFor(
    versions: readonly ScheduleVersion[],
    localDate: LocalDate,
  ): ScheduleVersion | null {
    for (let i = 0; i < versions.length; i++) {
      const version = versions[i] as ScheduleVersion;
      if (ScheduleVersion.coversDay(version, localDate)) return version;
    }
    return null;
  },

  /**
   * A shop's seven `DayHours` → this day's hours (`roster-window.ts:52-78`),
   * indexed by the day's ISO weekday (Mon-first, index `weekday − 1`).
   *
   * - `null` — no usable week (not exactly seven entries): the shop imposes
   *   no bound;
   * - `[]` — closed today;
   * - one `ShopDayHours` otherwise.
   *
   * Lives here, not in an adapter, because the browser's grid and the
   * server's commit-time re-check must clamp to the same envelope.
   */
  shopDayHours(
    week: readonly DayHours[],
    localDate: LocalDate,
  ): readonly ShopDayHours[] | null {
    if (week.length !== 7) return null;
    const entry = week[LocalDate.weekday(localDate) - 1];
    if (entry === undefined) return null;
    if (entry.openingState === OpeningState.Closed) return [];
    return [ShopDayHours.of(entry.openMinutes, entry.closeMinutes)];
  },

  /**
   * Every given shop's hours for one day, in the given order — the
   * {@link ShopHours} list {@link buildDayWindows} clamps against, read from
   * the stored `ShopLocation` slice as it is (a whole location passes). One
   * {@link shopDayHours} per shop (composed, never restated). No filter:
   * which shops a day may offer — listed ones, a moved visit's own — is the
   * caller's rule (`PartyAdmissionSystem.shopListed`).
   */
  shopHoursOn(
    locations: readonly Pick<ShopLocation, 'id' | 'openingHours'>[],
    localDate: LocalDate,
  ): readonly ShopHours[] {
    const hours: ShopHours[] = [];
    for (let i = 0; i < locations.length; i++) {
      const location = locations[i] as Pick<
        ShopLocation,
        'id' | 'openingHours'
      >;
      hours.push({
        locationId: location.id,
        hours: RosterSystem.shopDayHours(location.openingHours, localDate),
      });
    }
    return hours;
  },

  /**
   * Is this chair worth drawing on the staff day: rostered somewhere today,
   * OR holding bookings anyway. The second arm is not padding — a barber
   * deactivated mid-month leaves the active roster while their booked
   * clients still walk through the door. Its negation is "off today".
   */
  worksDay(rosteredCount: number, appointmentCount: number): boolean {
    return rosteredCount > 0 || appointmentCount > 0;
  },

  /**
   * Where the shop stands at `minute` of `localDate` against its Mon-first
   * week (`DayHours`, the closed day kept), on the shop's wall clock:
   *
   * - open (`openMinutes ≤ minute < closeMinutes`, {@link DayHours.isOpenAt})
   *   → `CLOSES_SOON` with at most `DayHours.CLOSES_SOON_MINUTES` left,
   *   else `CLOSES_AT` — both at today's closing minute;
   * - before today's opening → `OPENS_AT` today's opening minute;
   * - closed today, or past closing → `OPENS_ON` the first open day of the
   *   next seven (the same weekday next week included), at its opening
   *   minute;
   * - a week open on no day → `OPENS_AT` with no minute (`null`).
   *
   * A weekday the week holds no entry for reads as closed.
   */
  shopOpeningAt(
    week: readonly DayHours[],
    localDate: LocalDate,
    minute: MinuteOfDay,
  ): ShopOpeningAt {
    const weekday = LocalDate.weekday(localDate);
    const today = DayHours.forWeekday(week, weekday);
    if (today !== null && today.openingState === OpeningState.Open) {
      if (DayHours.isOpenAt(week, weekday, minute)) {
        return {
          shopOpening:
            MinuteCount.span(minute, today.closeMinutes) <=
            DayHours.CLOSES_SOON_MINUTES
              ? ShopOpening.ClosesSoon
              : ShopOpening.ClosesAt,
          atMinutes: today.closeMinutes,
          localDate,
        };
      }
      if (minute < today.openMinutes) {
        return {
          shopOpening: ShopOpening.OpensAt,
          atMinutes: today.openMinutes,
          localDate,
        };
      }
    }
    for (let offset = 1; offset <= DAYS_IN_WEEK; offset++) {
      const day = LocalDate.addDays(localDate, offset);
      const hours = DayHours.forWeekday(week, LocalDate.weekday(day));
      if (hours !== null && hours.openingState === OpeningState.Open) {
        return {
          shopOpening: ShopOpening.OpensOn,
          atMinutes: hours.openMinutes,
          localDate: day,
        };
      }
    }
    return { shopOpening: ShopOpening.OpensAt, atMinutes: null, localDate };
  },

  /**
   * A barber's rostered windows for one shop day — the BOOKABLE window
   * (`roster-window.ts:98-196`): what a client may be offered on `/book`.
   *
   * It is deliberately the roster INTERSECTED with each shop's published
   * hours, so a client is never offered a time the shop is shut — and it is
   * NOT a bound on what can exist: staff may place a visit anywhere
   * (`PlacementPolicy.allowOutsideWindow`); that visit occupies real time and
   * counts in the statistics, it is simply never publicly bookable.
   *
   * Order of application:
   * 1. a whole-day absence on the day (`CLOSED`) yields nothing at all — the
   *    day leaves the capacity denominator, so nobody is penalised in
   *    utilisation for a holiday;
   * 2. the version in force that day, the day's weekday's segments — each
   *    carrying the shop it is worked at. An `HOURS` exception replaces the
   *    TIMES but keeps the place: its ranges land on the first segment's
   *    shop (moving a barber between shops is a roster amendment, not a
   *    one-day tweak), and it cannot open a weekday the roster does not work;
   * 3. each segment intersected with ITS OWN shop's hours (no entry or
   *    `null`: no bound; `[]`: closed);
   * 4. every `BLOCKED` range subtracted — from the windows, not merely
   *    marked busy, so unpaid time never enters the capacity denominator.
   *
   * Sorted by start, then shop (code-unit order).
   */
  buildDayWindows(input: BuildDayWindowsInput): readonly RosterWindow[] {
    const relevant = exceptionsOn(input.exceptions, input.localDate);
    if (hasWholeDayAbsence(relevant)) return [];

    const version = RosterSystem.versionFor(input.versions, input.localDate);
    if (version === null) return [];

    const weekday = LocalDate.weekday(input.localDate);
    const rostered = segmentsOn(version.segments, weekday);
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
            weekday,
            first.locationId,
            MinuteOfDay.ofProven(range.startMinutes),
            EndMinute.ofProven(range.endMinutes),
          ),
        );
      }
      segments = replaced;
    }

    const carveOuts = carveOutsOn(relevant);

    const windows: RosterWindow[] = [];
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i] as ShiftSegment;
      const worked = [MinuteRange.of(segment.startMinutes, segment.endMinutes)];
      const hours = hoursAt(input.shopHours, segment.locationId);
      const bounded =
        hours === null
          ? worked
          : IntervalSetSystem.intersect(worked, hoursAsRanges(hours));
      const kept = IntervalSetSystem.subtract(bounded, carveOuts);
      for (let k = 0; k < kept.length; k++) {
        const range = kept[k] as MinuteRange;
        windows.push(
          RosterWindow.of(
            input.barberId,
            segment.locationId,
            MinuteOfDay.ofProven(range.startMinutes),
            EndMinute.ofProven(range.endMinutes),
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
  buildDayCarveOuts(input: BuildDayWindowsInput): readonly RosterWindow[] {
    const relevant = exceptionsOn(input.exceptions, input.localDate);
    if (hasWholeDayAbsence(relevant)) return [];

    const carveOuts = carveOutsOn(relevant);
    if (carveOuts.length === 0) return [];

    const unblocked: DayException[] = [];
    for (let i = 0; i < relevant.length; i++) {
      const exception = relevant[i] as DayException;
      if (exception.exceptionEffect !== ExceptionEffect.Blocked) {
        unblocked.push(exception);
      }
    }
    const worked = RosterSystem.buildDayWindows({
      ...input,
      exceptions: unblocked,
    });

    const blocks: RosterWindow[] = [];
    for (let i = 0; i < worked.length; i++) {
      const window = worked[i] as RosterWindow;
      const covered = IntervalSetSystem.intersect([window], carveOuts);
      for (let k = 0; k < covered.length; k++) {
        const range = covered[k] as MinuteRange;
        blocks.push(
          RosterWindow.of(
            window.barberId,
            window.locationId,
            MinuteOfDay.ofProven(range.startMinutes),
            EndMinute.ofProven(range.endMinutes),
          ),
        );
      }
    }
    return blocks.sort(byStart);
  },

  /**
   * One barber's day at the OFFERED shops — {@link buildDayWindows} kept to
   * the shops `input.shopHours` names (the ones the day may offer: the
   * listed shops, a moved visit's own). A shop ABSENT from `shopHours` reads
   * as "no bound" to the roster, which is wrong for one hidden since: a
   * segment worked at a shop that left the list, or at one with no document,
   * must offer nothing — never its roster unclamped. So here `[]` offers
   * nothing at all. Empty: the barber is not on the day at those shops —
   * the booking grid's `barberDays`, the waitlist match and the staff
   * lane read it the same way.
   */
  offeredWindows(input: BuildDayWindowsInput): readonly RosterWindow[] {
    return atOfferedShops(RosterSystem.buildDayWindows(input), input.shopHours);
  },

  /**
   * The carve-outs at the OFFERED shops — {@link buildDayCarveOuts} kept to
   * the shops `input.shopHours` names, as {@link offeredWindows} keeps the
   * windows: a block over a window that is not there would be a rectangle
   * over nothing.
   */
  offeredCarveOuts(input: BuildDayWindowsInput): readonly RosterWindow[] {
    return atOfferedShops(
      RosterSystem.buildDayCarveOuts(input),
      input.shopHours,
    );
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
} as const;
