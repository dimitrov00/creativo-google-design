import {
  AccountLifecycle,
  BarberStatus,
  Roles,
  type ShiftSegment,
} from '@core/components';
import { type BarberId, Result, type UtcEpochMs } from '@core/primitives';
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
    const shops = barber.locationIds;
    if (shops.length === 0) return Result.ok(segments);
    for (let i = 0; i < segments.length; i++) {
      const locationId = (segments[i] as ShiftSegment).locationId;
      if (!shops.includes(locationId)) {
        return Result.err(SchedulingError.rosterOutsideShops(locationId));
      }
    }
    return Result.ok(segments);
  },
} as const;
