import {
  MinuteCount,
  MinuteDelta,
} from '../primitives/duration-minutes.primitive';
import type { LocalDate } from '../primitives/local-date.primitive';
import type {
  EndMinute,
  MinuteOfDay,
} from '../primitives/minute-of-day.primitive';
import { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';

/**
 * Where a booking sits on the shop's clock, and on the absolute timeline —
 * the time slice of the `Appointment` archetype — the owner's `TimeCoordinate`,
 * the general time slice every temporal entity follows — flat at the root of the
 * entity and its document (Law 6):
 *
 * - the SHOP WALL CLOCK — `localDate` plus the envelope `startMinutes` /
 *   `endMinutes` (first seat start to last seat end, an exclusive end, F-1),
 *   what every collision, packing and calendar computation reads (T1). Every
 *   seat of the appointment starts on this `localDate` and ends by 1440
 *   (one shop day per appointment, F-6);
 * - the ABSOLUTE POINT — `utcEpochMs`, the envelope start as an instant,
 *   computed ONCE at the ingestion boundary by `ZonedTimeSystem.toUtc` with
 *   the location's `timeZone`, for range indexes, reminder crons and `.ics`.
 *
 * No time-zone field: the zone is the location's (Law 7.2).
 */
export type TimeCoordinate = {
  /** The shop's wall-clock day, `YYYY-MM-DD`. */
  readonly localDate: LocalDate;
  /** The envelope start, `[0, 1440)` from the shop's local midnight. */
  readonly startMinutes: MinuteOfDay;
  /** The envelope's exclusive end, `(0, 1440]`. */
  readonly endMinutes: EndMinute;
  /** The envelope start as an instant — indexes, crons and `.ics` only. */
  readonly utcEpochMs: UtcEpochMs;
};

export const TimeCoordinate = {
  /** The envelope's length on the wall clock — `0` for an empty or inverted one. */
  durationMinutes(time: TimeCoordinate): MinuteCount {
    return MinuteCount.span(time.startMinutes, time.endMinutes);
  },

  /** Do two bookings overlap on the shop's wall clock? Same day, intersecting minutes. */
  overlaps(a: TimeCoordinate, b: TimeCoordinate): boolean {
    return (
      a.localDate === b.localDate &&
      a.startMinutes < b.endMinutes &&
      b.startMinutes < a.endMinutes
    );
  },

  /**
   * A seat's start as an instant — the appointment's `utcEpochMs` plus the
   * seat's wall-clock distance from the envelope start (T9). Exact for every
   * visit that does not straddle a 03:00/04:00 DST transition, which none
   * can (the shop is closed then). For the per-seat late-cancellation
   * judgement only.
   *
   * GATED by G-1 (flatten-spec §0.2, §2.3 T2/T9): it exists only under ruling
   * (a); under ruling (b) the follow-up commit deletes it and judges the
   * seat on `(localDate, seat.startMinutes)` instead.
   */
  seatStartUtcMs(
    time: TimeCoordinate,
    seat: { readonly startMinutes: MinuteOfDay },
  ): UtcEpochMs {
    return UtcEpochMs.plusMinutes(
      time.utcEpochMs,
      MinuteDelta.between(time.startMinutes, seat.startMinutes),
    );
  },
} as const;
