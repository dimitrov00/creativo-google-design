import {
  AccountLifecycle,
  BarberStatus,
  type DayExceptionsRequest,
  Roles,
  type ShiftSegment,
} from '@core/components';
import {
  type BarberId,
  type LocationId,
  Result,
  type UtcEpochMs,
} from '@core/primitives';
import { SchedulingError } from '@core/errors';
import type { Barber, User } from '@core/entities';

/**
 * RosterAccessSystem — who may edit a barber's hours, breaks and days off,
 * and where those hours may sit (team onboarding D5, O3,
 * `docs/designs/team-onboarding.md`). Pure: the roster pipelines read the
 * caller's account and the barber record inside their commit and ask.
 *
 * The rules cannot say which barber a caller is, so this is judged on the
 * STORED account: its roles, its block and its barber link. The caller's
 * block is an elapsed-time rule (`AccountLifecycle.isBlockedAt`):
 * `nowUtcMs`, never the shop clock.
 */
export const RosterAccessSystem = {
  /**
   * The barber record `barberId` names, when `caller` may edit its hours:
   *
   * - the caller works the book and is not blocked, and either holds a role
   *   that edits ANY roster (`Roles.ROSTERS`: the front desk and the
   *   owners) or is the barber — their account is linked to this very
   *   record — else `SCHEDULING_ROSTER_FORBIDDEN`;
   * - the id names a record — else `SCHEDULING_ROSTER_INVALID_INPUT`
   *   (`barberId`), asked only after the caller is admitted;
   * - the record has not left the shop — else `SCHEDULING_ROSTER_DEPARTED`.
   */
  admit(
    caller: User | null,
    barber: Barber | null,
    barberId: BarberId,
    nowUtcMs: UtcEpochMs,
  ): Result<Barber, SchedulingError> {
    if (
      caller === null ||
      AccountLifecycle.isBlockedAt(caller, nowUtcMs) ||
      !Roles.mayBook(caller.roles) ||
      !(
        Roles.editsAnyRoster(caller.roles) || caller.linkedBarberId === barberId
      )
    ) {
      return Result.err(SchedulingError.rosterForbidden());
    }
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
   * Whether `caller` may make an act on barbers' days (`setDayExceptions`):
   * every barber it touches is admitted as {@link RosterAccessSystem.admit}
   * admits — so a barber cannot move a block onto a colleague — and every
   * day it files sits at a shop its barber works at. `records` are the
   * barber records the transaction read; a barber with none there is
   * refused as `admit` refuses an id with no record. The first refusal, in
   * the request's own order.
   */
  admitDays(
    caller: User | null,
    records: readonly Barber[],
    placements: readonly DayExceptionsRequest.Placement[],
    nowUtcMs: UtcEpochMs,
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
      const admitted = RosterAccessSystem.admit(
        caller,
        record,
        placement.barberId,
        nowUtcMs,
      );
      if (!admitted.ok) return admitted;
      if (placement.locationId !== null) {
        const placed = RosterAccessSystem.worksAt(
          admitted.value,
          placement.locationId,
        );
        if (!placed.ok) return placed;
      }
    }
    return Result.ok(null);
  },
} as const;
