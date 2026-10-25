import {
  MinuteCount,
  MinuteDelta,
  type LocalDate,
  type EndMinute,
  type MinuteOfDay,
  UtcEpochMs,
} from '@core/primitives';

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

  /**
   * The envelope's END as an instant — {@link TimeCoordinate.instantAt} of
   * its exclusive end: the start as stored plus the wall-clock distance to
   * the end, of real elapsed time (T2/T9: what an `.ics` event ends at,
   * `client-appointments.ts` `addToCalendar`). Equal to the stored start plus
   * its sold span ({@link TimeCoordinate.durationMinutes}) because a stored
   * `endMinutes` never comes before `startMinutes`. Exact for every visit that
   * does not straddle a DST transition, which none can (the shop is closed
   * then).
   */
  endUtcMs(time: TimeCoordinate): UtcEpochMs {
    return TimeCoordinate.instantAt(time, time.endMinutes);
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
   * A minute of the visit's shop day as an instant — the appointment's
   * stored `utcEpochMs` plus that minute's wall-clock distance from the
   * envelope start (T9): a seat's start, the envelope's exclusive end, a
   * chair's start or end. Exact for every visit that does not straddle a
   * 03:00/04:00 DST transition, which none can (the shop is closed then):
   * on Sofia's 2026-03-29 (spring forward) a stored 02:30 start read at
   * 04:30 lands 120 elapsed minutes on where the wall clock shows 60, and on
   * 2026-10-25 (fall back) a 03:30 start read at 04:30 lands 60 on where it
   * shows 120 — a visit across the switch, which the shop never books.
   *
   * GATED by G-1 (flatten-spec §0.2, §2.3 T2/T9): it exists only under
   * ruling (a), for the T2 elapsed-time rules on instants — the per-seat
   * late-cancellation judgement (`CancellationPolicySystem`), the `.ics`
   * end ({@link TimeCoordinate.endUtcMs}), and the staff dashboard's
   * countdown and live remaining (an elapsed-time phrase, pass D D-6.4) —
   * NEVER placement math. Under ruling (b) the follow-up commit deletes it
   * and judges on `(localDate, minute)` instead. (The seat-start reader of
   * old, folded and generalised to any start or end minute, pass D D-6.5.)
   */
  instantAt(time: TimeCoordinate, minute: MinuteOfDay | EndMinute): UtcEpochMs {
    return UtcEpochMs.plusMinutes(
      time.utcEpochMs,
      MinuteDelta.between(time.startMinutes, minute),
    );
  },
} as const;
