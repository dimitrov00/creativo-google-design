import {
  type DayExceptionsCall,
  DayExceptionsRequest,
  StaffTarget,
  type WriteOp,
} from '@core/components';
import {
  type BarberId,
  defect,
  type LocationId,
  type OperationId,
  Result,
  StaffCapability,
  type TimeZone,
  type UserId,
  type UtcEpochMs,
} from '@core/primitives';
import {
  type AccessError,
  type RepositoryError,
  SchedulingError,
} from '@core/errors';
import {
  type Barber,
  Collections,
  type ScheduleException,
} from '@core/entities';
import type {
  ClockPorts,
  CommitPorts,
  HashPorts,
  LocationLoadPorts,
  ScheduleExceptionPorts,
} from '@core/ports';
import {
  DayExceptionWriteSystem,
  RosterAccessSystem,
  StaffAccessSystem,
} from '@core/systems';
import { applyDayExceptions } from './schedule-blocks.pipeline';
import {
  readStaffCaller,
  type StaffCallerFacts,
  teamActor,
} from './team-caller.pipeline';

/**
 * `setDayExceptions` — a barber's days off, blocks and one-day breaks,
 * changed as ONE act (team onboarding D5, O4,
 * `docs/designs/team-onboarding.md`): the staff schedule's four pens
 * (`dayExceptionsEdit`: block, clear, move, a day's breaks) behind one
 * callable. `scheduleExceptions` has no client writer, so who may is no
 * longer "anyone who works the book": it is judged here, on the caller's
 * STORED account.
 *
 * 1. **The zones** — every shop the request files days at is read
 *    (`loadLocation`): a day's first instant is read in its shop's zone
 *    (Law 7.3). A shop that is not there is
 *    `SCHEDULING_ROSTER_INVALID_INPUT` (`locationId`).
 * 2. **One transaction** (Law 4: the transaction is the sandwich) — the
 *    exception write the pens hand their merge to
 *    (`ScheduleExceptionPorts`), run over the server's commit: it reads
 *    `users/{caller}` and `settings/staffPermissions`, the record of every
 *    barber the act touches and every day document, and asks
 *    - `StaffAccessSystem.admit` — who may (staff permissions P6):
 *      `TIME_OFF` on EVERY barber the act names. By default the front desk
 *      and the owners change any barber's days, a barber only their own
 *      (so never a move onto a colleague);
 *    - `RosterAccessSystem.placedDays` — a barber who has left and a day
 *      filed at a shop its barber does not work at are refused;
 *    - the pen's own merge (`applyDayExceptions` →
 *      `ScheduleExceptionSystem`), unchanged from the browser's;
 *    - `DayExceptionWriteSystem.writesOf` — only the days that really
 *      change are written, beside ONE `TEAM_DAY_EXCEPTIONS_CHANGED` row per
 *      barber, credited to the caller over their stored roles. The rows
 *      land with the days or not at all.
 *
 * A refusal writes nothing. The capacity rebuild of each changed day rides
 * the document's own trigger, as before. The answer: the barbers the act
 * named. The token's refusals (no caller, no staff role, an unreadable
 * field) are the edge decoder's (`roster.wire.ts`).
 */

/** The call as the wire decoded it, with the verified caller. */
export type SetDayExceptionsCommand = DayExceptionsRequest & {
  /** The verified caller — the wire's token gate admitted them. */
  readonly callerUserId: UserId;
  /** The act's name (WS-4.1): its audit rows are keyed by it. */
  readonly operationId: OperationId;
};

export type SetDayExceptionsPorts = CommitPorts &
  ClockPorts &
  HashPorts &
  LocationLoadPorts;

type Snapshot = StaffCallerFacts & {
  /** The records of the barbers the act touches — those that exist. */
  readonly barbers: readonly Barber[];
  /** Each day document, positions as the keys asked. */
  readonly stored: readonly (ScheduleException | null)[];
};

/** The zone of every shop the request files days at, or the refusal. */
async function zonesOf(
  ports: LocationLoadPorts,
  locationIds: readonly LocationId[],
): Promise<
  Result<ReadonlyMap<LocationId, TimeZone>, SchedulingError | RepositoryError>
> {
  const zones = new Map<LocationId, TimeZone>();
  for (const locationId of locationIds) {
    const location = await ports.loadLocation(locationId);
    if (!location.ok) return location;
    if (location.value === null) {
      return Result.err(SchedulingError.rosterInvalidInput('locationId'));
    }
    zones.set(locationId, location.value.timeZone);
  }
  return Result.ok(zones);
}

/**
 * The exception write the pens hand their merge to, over the server's
 * commit: the caller and the barbers read beside the days, the caller
 * judged before the merge runs, the changed days and their audit rows
 * committed as one plan.
 */
function transactional(
  ports: SetDayExceptionsPorts,
  cmd: SetDayExceptionsCommand,
  barberIds: readonly BarberId[],
  nowUtcMs: UtcEpochMs,
): ScheduleExceptionPorts {
  const placements = DayExceptionsRequest.placements(cmd);
  return {
    writeScheduleException: async (keys, merge) => {
      const committed = await ports.commit(
        async (tx): Promise<Snapshot> => {
          const [facts, records, stored] = await Promise.all([
            readStaffCaller(tx, cmd.callerUserId),
            tx.getAll<Barber>(
              barberIds.map((barberId) => [Collections.Barbers, barberId]),
            ),
            tx.getAll<ScheduleException>(
              keys.map((key) => [Collections.ScheduleExceptions, key]),
            ),
          ]);
          const barbers: Barber[] = [];
          for (const record of records) {
            if (record !== null) barbers.push(record);
          }
          return { ...facts, barbers, stored };
        },
        ({
          caller,
          permissions,
          barbers,
          stored,
        }): Result<
          { readonly writes: readonly WriteOp[] },
          SchedulingError | AccessError
        > => {
          const admitted = StaffAccessSystem.admit({
            staffCapability: StaffCapability.TimeOff,
            staffTarget: StaffTarget.barbers(barberIds),
            caller,
            permissions,
            nowUtcMs,
          });
          if (!admitted.ok) return admitted;
          const placed = RosterAccessSystem.placedDays(barbers, placements);
          if (!placed.ok) return placed;
          const merged = merge(stored);
          if (!merged.ok) return merged;
          return Result.ok({
            writes: DayExceptionWriteSystem.writesOf(
              {
                edit: cmd.dayExceptionsEdit,
                keys,
                stored,
                merged: merged.value,
                actor: teamActor(cmd.callerUserId, admitted.value),
                nowUtcMs,
                operationId: cmd.operationId,
              },
              ports.hash,
            ),
          });
        },
      );
      return committed.ok ? Result.ok(undefined) : committed;
    },
  };
}

export const setDayExceptions =
  (ports: SetDayExceptionsPorts) =>
  async (
    cmd: SetDayExceptionsCommand,
  ): Promise<
    Result<
      DayExceptionsCall.Saved,
      SchedulingError | AccessError | RepositoryError
    >
  > => {
    // Read once, before the transaction: `decide` may run more than once.
    const nowUtcMs = ports.nowUtcMs();
    const zones = await zonesOf(ports, DayExceptionsRequest.locationIds(cmd));
    if (!zones.ok) return zones;
    const barberIds = DayExceptionsRequest.barberIds(cmd);
    const written = await applyDayExceptions(
      transactional(ports, cmd, barberIds, nowUtcMs),
    )(
      cmd,
      (locationId) =>
        zones.value.get(locationId) ??
        defect(`setDayExceptions: no zone read for ${locationId}`),
    );
    return written.ok ? Result.ok({ barberIds }) : written;
  };
