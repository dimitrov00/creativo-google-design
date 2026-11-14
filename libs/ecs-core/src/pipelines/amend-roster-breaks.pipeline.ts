import {
  type RosterCall,
  StaffTarget,
  WriteOp,
  WriteProvenance,
} from '@core/components';
import {
  type Barber,
  type BarberSchedule,
  Collections,
  type ShopLocation,
} from '@core/entities';
import {
  type AccessError,
  type RepositoryError,
  SchedulingError,
} from '@core/errors';
import type { ClockPorts, CommitPorts } from '@core/ports';
import {
  type BarberId,
  type LocationId,
  type OperationId,
  Result,
  StaffCapability,
  type UserId,
} from '@core/primitives';
import {
  RosterAccessSystem,
  type RosterBreakChange,
  RosterBreakSystem,
  StaffAccessSystem,
  ZonedTimeSystem,
} from '@core/systems';
import { readStaffCaller, type StaffCallerFacts } from './team-caller.pipeline';

/**
 * `amendRosterBreaks` — a chair's standing breaks changed «from this day on»
 * (owner, 2026-11-06: a lunch is part of the weekly pattern; «Този и
 * следващите» on a break, and a new weekly lunch). ONE transaction reads
 * the caller's account and the owner's permissions, the barber record, the
 * roster and the shop whose clock says what «today» is.
 * `StaffAccessSystem.admit` says who may (staff permissions P6): `HOURS`
 * on the barber the call names, judged on the STORED roles, block and link
 * against `settings/staffPermissions` — by default the front desk and the
 * owners change any barber's breaks, a barber only their own. Then
 * `RosterAccessSystem.recordOf`: never those of a barber who has left.
 * `RosterBreakSystem.amend` revises the versions from the day on and
 * refuses a past day or a chair with no roster; the roster's `versions`
 * are written whole, stamped with the act (`writeOperationId`). One write,
 * whatever the horizon: the capacity rebuild and the audit row ride the
 * roster's own triggers; the row names the call by the stamp.
 *
 * The token's refusals (no caller, no staff role, an unreadable field) are
 * the edge decoder's (`roster.wire.ts`).
 */

/** The call as the pipeline reads it — the change, its chair, its shop, the verified caller and the act's name. */
export type AmendRosterBreaksCommand = RosterBreakChange & {
  readonly barberId: BarberId;
  readonly locationId: LocationId;
  /** The verified caller — the wire's token gate admitted them. */
  readonly callerUserId: UserId;
  /** The act's name (WS-4.1), stamped on the roster. */
  readonly operationId: OperationId;
};

export type AmendRosterBreaksPorts = CommitPorts & ClockPorts;

type Snapshot = StaffCallerFacts & {
  readonly barber: Barber | null;
  readonly schedule: BarberSchedule | null;
  readonly location: ShopLocation | null;
};

export const amendRosterBreaks =
  (ports: AmendRosterBreaksPorts) =>
  async (
    cmd: AmendRosterBreaksCommand,
  ): Promise<
    Result<RosterCall.Amended, SchedulingError | AccessError | RepositoryError>
  > => {
    const path = [Collections.BarberSchedules, cmd.barberId];
    // Read once, before the transaction: `decide` may run more than once.
    const nowUtcMs = ports.nowUtcMs();
    const committed = await ports.commit(
      async (tx): Promise<Snapshot> => {
        const [facts, barber, schedule, location] = await Promise.all([
          readStaffCaller(tx, cmd.callerUserId),
          tx.get<Barber>([Collections.Barbers, cmd.barberId]),
          tx.get<BarberSchedule>(path),
          tx.get<ShopLocation>([Collections.Locations, cmd.locationId]),
        ]);
        return { ...facts, barber, schedule, location };
      },
      ({
        caller,
        permissions,
        barber,
        schedule,
        location,
      }): Result<
        { readonly writes: readonly WriteOp[] },
        SchedulingError | AccessError
      > => {
        const admitted = StaffAccessSystem.admit({
          staffCapability: StaffCapability.Hours,
          staffTarget: StaffTarget.barbers([cmd.barberId]),
          caller,
          permissions,
          nowUtcMs,
        });
        if (!admitted.ok) return admitted;
        const record = RosterAccessSystem.recordOf(barber);
        if (!record.ok) return record;
        if (location === null) {
          return Result.err(SchedulingError.rosterInvalidInput('locationId'));
        }
        const today = ZonedTimeSystem.shopNow(
          nowUtcMs,
          location.timeZone,
        ).localDate;
        const versions = RosterBreakSystem.amend(
          schedule,
          cmd.barberId,
          cmd,
          today,
        );
        return versions.ok
          ? Result.ok({
              writes: [
                WriteOp.update(path, {
                  versions: versions.value,
                  ...WriteProvenance.of(cmd.operationId),
                }),
              ],
            })
          : versions;
      },
    );
    return committed.ok ? Result.ok({ barberId: cmd.barberId }) : committed;
  };
