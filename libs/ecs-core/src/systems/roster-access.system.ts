import {
  BarberStatus,
  type DayExceptionsRequest,
  type ShiftSegment,
} from '@core/components';
import { type LocationId, Result } from '@core/primitives';
import { SchedulingError } from '@core/errors';
import type { Barber } from '@core/entities';

/**
 * RosterAccessSystem — which barber record a roster act may change, and
 * where its hours may sit (team onboarding D5, O3,
 * `docs/designs/team-onboarding.md`). Pure: the roster pipelines read the
 * barber record inside their commit and ask.
 *
 * WHO may is no longer asked here: `StaffAccessSystem.admit` judges the
 * caller's stored account against the owner's cells first (staff
 * permissions P6 — `HOURS` for a week and its breaks, `TIME_OFF` for a
 * barber's days), and these record checks run after it.
 */
export const RosterAccessSystem = {
  /**
   * The barber record a call names — `null` when its id names none — when
   * its hours can be edited:
   *
   * - the id names a record — else `SCHEDULING_ROSTER_INVALID_INPUT`
   *   (`barberId`), asked only after the caller is admitted;
   * - the record has not left the shop — else `SCHEDULING_ROSTER_DEPARTED`.
   */
  recordOf(barber: Barber | null): Result<Barber, SchedulingError> {
    if (barber === null) {
      return Result.err(SchedulingError.rosterInvalidInput('barberId'));
    }
    return barber.barberStatus === BarberStatus.Departed
      ? Result.err(SchedulingError.rosterDeparted(barber.id))
      : Result.ok(barber);
  },

  /**
   * Whether every shift of a week sits at a shop the barber works at: an
   * empty `locationIds` is every shop; otherwise the first segment at
   * another shop is `SCHEDULING_ROSTER_OUTSIDE_SHOPS`, naming it. The
   * answer is the segments as given.
   */
  withinShops(
    barber: Barber,
    segments: readonly ShiftSegment[],
  ): Result<readonly ShiftSegment[], SchedulingError> {
    for (let i = 0; i < segments.length; i++) {
      const placed = RosterAccessSystem.worksAt(
        barber,
        (segments[i] as ShiftSegment).locationId,
      );
      if (!placed.ok) return placed;
    }
    return Result.ok(segments);
  },

  /**
   * Whether the barber works at `locationId`: an empty `locationIds` is
   * every shop — else `SCHEDULING_ROSTER_OUTSIDE_SHOPS`, naming the shop.
   */
  worksAt(
    barber: Barber,
    locationId: LocationId,
  ): Result<Barber, SchedulingError> {
    return barber.locationIds.length === 0 ||
      barber.locationIds.includes(locationId)
      ? Result.ok(barber)
      : Result.err(SchedulingError.rosterOutsideShops(locationId));
  },

  /**
   * Whether an act on barbers' days (`setDayExceptions`) names records it
   * can change: every barber it touches is a record that has not left
   * ({@link RosterAccessSystem.recordOf}) and every day it files sits at a
   * shop its barber works at. `records` are the barber records the
   * transaction read; a barber with none there is refused as `recordOf`
   * refuses an id with no record. The first refusal, in the request's own
   * order.
   */
  placedDays(
    records: readonly Barber[],
    placements: readonly DayExceptionsRequest.Placement[],
  ): Result<null, SchedulingError> {
    for (let i = 0; i < placements.length; i++) {
      const placement = placements[i] as DayExceptionsRequest.Placement;
      let record: Barber | null = null;
      for (let j = 0; j < records.length; j++) {
        if ((records[j] as Barber).id === placement.barberId) {
          record = records[j] as Barber;
          break;
        }
      }
      const named = RosterAccessSystem.recordOf(record);
      if (!named.ok) return named;
      if (placement.locationId !== null) {
        const placed = RosterAccessSystem.worksAt(
          named.value,
          placement.locationId,
        );
        if (!placed.ok) return placed;
      }
    }
    return Result.ok(null);
  },
} as const;
