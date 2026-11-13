import { type RosterCall, WriteOp, WriteProvenance } from '@core/components';
import {
  type Barber,
  type BarberSchedule,
  Collections,
  type ShopLocation,
  type User,
} from '@core/entities';
import { type RepositoryError, SchedulingError } from '@core/errors';
import type { ClockPorts, CommitPorts } from '@core/ports';
import {
  type BarberId,
  type LocalDate,
  type LocationId,
  MinuteCount,
  type OperationId,
  Result,
  type UserId,
} from '@core/primitives';
import {
  RosterAccessSystem,
  type RosterWeek,
  RosterWeekSystem,
  ZonedTimeSystem,
} from '@core/systems';

/**
 * `setRosterWeek` — the hours editor's save (owner, 2026-11-06: a weekly
 * hours editor with «＋ Почивка»): a chair's whole week, shifts and breaks,
 * standing from a day on. ONE transaction reads the caller's account, the
 * barber record, the roster and the shop whose clock says what «today»
 * is, and asks:
 *
 * - `RosterAccessSystem.admit` — who may (team onboarding D5, O3): the
 *   front desk and the owners edit any barber's hours, a barber only their
 *   own (the STORED roles, block and link); an id with no record and a
 *   barber who has left are refused;
 * - `RosterAccessSystem.withinShops` — every shift at a shop the barber
 *   works at;
 * - `RosterWeekSystem.setFrom` — the week itself, replacing the versions
 *   from the day on (earlier weeks are the record).
 *
 * The roster is written whole, stamped with the act (`writeOperationId`) —
 * a chair with none starts one, with no turnaround. The capacity rebuild
 * and the audit row ride the roster's own triggers; the row names the call
 * by the stamp.
 *
 * The token's refusals (no caller, not working the book, an unreadable
 * field) are the edge decoder's (`roster.wire.ts`).
 */

export type SetRosterWeekCommand = RosterWeek & {
  readonly barberId: BarberId;
  readonly locationId: LocationId;
  readonly fromLocalDate: LocalDate;
  /** The verified caller — the wire's token gate admitted them. */
  readonly callerUserId: UserId;
  /** The act's name (WS-4.1), stamped on the roster. */
  readonly operationId: OperationId;
};

export type SetRosterWeekPorts = CommitPorts & ClockPorts;

type Snapshot = {
  readonly caller: User | null;
  readonly barber: Barber | null;
  readonly schedule: BarberSchedule | null;
  readonly location: ShopLocation | null;
};

export const setRosterWeek =
  (ports: SetRosterWeekPorts) =>
  async (
    cmd: SetRosterWeekCommand,
  ): Promise<Result<RosterCall.Amended, SchedulingError | RepositoryError>> => {
    const path = [Collections.BarberSchedules, cmd.barberId];
    // Read once, before the transaction: `decide` may run more than once.
    const nowUtcMs = ports.nowUtcMs();
    const committed = await ports.commit(
      async (tx): Promise<Snapshot> => {
        const [caller, barber, schedule, location] = await Promise.all([
          tx.get<User>([Collections.Users, cmd.callerUserId]),
          tx.get<Barber>([Collections.Barbers, cmd.barberId]),
          tx.get<BarberSchedule>(path),
          tx.get<ShopLocation>([Collections.Locations, cmd.locationId]),
        ]);
        return { caller, barber, schedule, location };
      },
      ({ caller, barber, schedule, location }) => {
        const admitted = RosterAccessSystem.admit(
          caller,
          barber,
          cmd.barberId,
          nowUtcMs,
        );
        if (!admitted.ok) return admitted;
        if (location === null) {
          return Result.err(SchedulingError.rosterInvalidInput('locationId'));
        }
        const placed = RosterAccessSystem.withinShops(
          admitted.value,
          cmd.segments,
        );
        if (!placed.ok) return placed;
        const today = ZonedTimeSystem.shopNow(
          nowUtcMs,
          location.timeZone,
        ).localDate;
        const versions = RosterWeekSystem.setFrom(
          schedule,
          cmd,
          cmd.fromLocalDate,
          today,
        );
        return versions.ok
          ? Result.ok({
              writes: [
                WriteOp.set(path, {
                  turnaroundMinutes:
                    schedule?.turnaroundMinutes ?? MinuteCount.ZERO,
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
