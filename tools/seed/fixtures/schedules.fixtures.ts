/**
 * THE DEV SEED'S SCHEDULE DOCUMENTS (flip 1): the rosters
 * (`barberSchedules/{barberId}`), the published schedule exceptions
 * (`scheduleExceptions/{BusyKey}`) and the fabricated public busy days
 * (`barberBusy/{BusyKey}`) — each body the flat archetype minus its `id`,
 * every coordinate the shop's wall clock (`localDate` + `*Minutes`) beside
 * the one instant computed once from the location's zone (Law 7.3). No
 * temporal body carries a zone (Law 7.2).
 *
 * The rosters are DATA the plan logic reads (`tools/seed/catalog.mjs`
 * clamps each segment to its shop's `openingHours`); the exception and
 * busy-day builders are what the seed writes for the days its calendar
 * names. A busy day the seed writes also carries the TTL `purgeAt` —
 * stamped by the writer through `purgeAtFor` (the one stamp,
 * `apps/functions/src/adapters/firestore-ttl.adapter.ts`), never here: the
 * `Timestamp` is no part of the entity.
 */
import {
  BlockKind,
  ExceptionEffectRule,
  MinuteBlock,
  MinuteRange,
  type ScheduleVersion,
  ShiftSegment,
} from '@core/components';
import type {
  BarberBusyDay,
  BarberSchedule,
  ScheduleException,
} from '@core/entities';
import { BarberId, BusyKey, LocationId, Weekday } from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import {
  at,
  type Body,
  CENTER,
  day,
  endAt,
  IVAN,
  minuteCount,
  MLADOST,
  NIKO,
  type Seeded,
  SHOP_TIME_ZONE,
  startAt,
  STEFAN,
  timeZoneOf,
  until,
} from './catalog.fixtures';

// ── Rosters ────────────────────────────────────────────────────────────────

/** A segment of a weekday's shift at one shop, whole hours. */
const segment = (
  weekday: Weekday,
  locationId: LocationId,
  from: number,
  to: number,
): ShiftSegment => ShiftSegment.of(weekday, locationId, at(from), until(to));

/** A split shift at one shop — mornings, lunch, afternoons. */
const shiftAt = (weekday: Weekday, locationId: LocationId) => [
  segment(weekday, locationId, 9, 13),
  segment(weekday, locationId, 14, 18),
];

/** Twelve to eight at the Center. */
const lateShift = (weekday: Weekday) => [segment(weekday, CENTER, 12, 20)];

/** One open-ended version from the start of the year; `amend` closes it and appends the next. */
const openEnded = (
  segments: readonly ShiftSegment[],
): readonly ScheduleVersion[] => [
  {
    seq: 0,
    effectiveFromLocalDate: day('2026-01-01'),
    effectiveToLocalDate: null,
    segments,
  },
];

/**
 * Barber rosters. Every shift segment carries ITS OWN location, because a
 * barber is not a fixture of one chair: Ivan covers the Center most of the
 * week and Mladost on Fridays, and Niko splits a single Wednesday between
 * the two. Several segments per weekday express a lunch break.
 * `turnaroundMinutes` is the reset between UNRELATED clients — never
 * applied between two seats of one party.
 */
export const SCHEDULES: readonly Seeded<BarberId, BarberSchedule>[] = [
  {
    id: IVAN,
    body: {
      turnaroundMinutes: minuteCount(10),
      versions: openEnded([
        ...shiftAt(Weekday.Mon, CENTER),
        ...shiftAt(Weekday.Tue, CENTER),
        ...shiftAt(Weekday.Wed, CENTER),
        ...shiftAt(Weekday.Thu, CENTER),
        // Ivan covers the Mladost chair on Fridays. Mladost opens 10:00, so
        // the morning segment starts with the shop rather than at 09:00 —
        // otherwise the first hour clips away and the roster reads as a lie.
        segment(Weekday.Fri, MLADOST, 10, 13),
        segment(Weekday.Fri, MLADOST, 14, 18),
        segment(Weekday.Sat, CENTER, 10, 16),
      ]),
    } satisfies Body<BarberSchedule>,
  },
  {
    id: NIKO,
    body: {
      turnaroundMinutes: minuteCount(0),
      versions: openEnded([
        ...lateShift(Weekday.Tue),
        // The headline case: ONE day, TWO shops. Center in the morning,
        // Mladost in the afternoon, two hours between them.
        segment(Weekday.Wed, CENTER, 9, 13),
        segment(Weekday.Wed, MLADOST, 15, 19),
        ...lateShift(Weekday.Thu),
        ...lateShift(Weekday.Fri),
        segment(Weekday.Sat, CENTER, 10, 18),
      ]),
    } satisfies Body<BarberSchedule>,
  },
  {
    // Stefan works the Center chair only, and takes Wednesdays off — so a
    // Wednesday party asking for him has no options, which the schedule
    // step has to render honestly rather than as a blank grid.
    id: STEFAN,
    body: {
      turnaroundMinutes: minuteCount(15),
      versions: openEnded([
        ...shiftAt(Weekday.Mon, CENTER),
        ...shiftAt(Weekday.Tue, CENTER),
        ...shiftAt(Weekday.Thu, CENTER),
        ...shiftAt(Weekday.Fri, CENTER),
        segment(Weekday.Sat, CENTER, 9, 15),
      ]),
    } satisfies Body<BarberSchedule>,
  },
];

// ── Exceptions and busy days ───────────────────────────────────────────────

/**
 * The shop day's first instant — the one instant a day document stores —
 * on the clock of the shop it names, else the default shop's.
 */
const firstInstantOf = (localDate: string, timeZone = SHOP_TIME_ZONE) =>
  ZonedTimeSystem.startOfLocalDay(day(localDate), timeZone);

/** `{barberId}__{localDate}` — the busy day's AND the exception's id. */
export function busyKeyOf(barberId: string, localDate: string): BusyKey {
  return BusyKey.of(BarberId.of(barberId), day(localDate));
}

/**
 * A published day off: the SANITIZED public document — effect only,
 * structurally no reason field (a `sick` day is staff-only data and must
 * never be derivable from the anonymous surface).
 */
export function closedDayBody(
  barberId: string,
  localDate: string,
  locationId: string,
): Body<ScheduleException> {
  return {
    barberId: BarberId.of(barberId),
    localDate: day(localDate),
    utcEpochMs: firstInstantOf(localDate, timeZoneOf(locationId)),
    locationId: LocationId.of(locationId),
    ...ExceptionEffectRule.closed(),
  } satisfies Body<ScheduleException>;
}

/**
 * A fabricated public busy day — geometry only, no reason, no ids, no
 * revenue: the occupied spans (`[startMinutes, endMinutes)` on the shop's
 * clock) merged into sorted `BUSY` blocks, as the rebuild writes them.
 */
export function busyDayBody(
  barberId: string,
  localDate: string,
  spans: readonly (readonly [number, number])[],
): Body<BarberBusyDay> {
  const merged = MinuteRange.normalize(
    spans.map(([from, to]) => MinuteRange.of(startAt(from), endAt(to))),
  );
  return {
    barberId: BarberId.of(barberId),
    localDate: day(localDate),
    utcEpochMs: firstInstantOf(localDate),
    blocks: merged.map((range) =>
      MinuteBlock.of(range.startMinutes, range.endMinutes, BlockKind.Busy),
    ),
  } satisfies Body<BarberBusyDay>;
}
