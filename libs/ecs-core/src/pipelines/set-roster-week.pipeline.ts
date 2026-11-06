import { type RosterCall, WriteOp } from '@core/components';
import {
  type BarberSchedule,
  Collections,
  type ShopLocation,
} from '@core/entities';
import { type RepositoryError, SchedulingError } from '@core/errors';
import type { ClockPorts, CommitPorts } from '@core/ports';
import {
  type BarberId,
  type LocalDate,
  type LocationId,
  MinuteCount,
  Result,
} from '@core/primitives';
import {
  type RosterWeek,
  RosterWeekSystem,
  ZonedTimeSystem,
} from '@core/systems';

/**
 * `setRosterWeek` — the hours editor's save (owner, 2026-11-06: a weekly
 * hours editor with «＋ Почивка»): a chair's whole week, shifts and breaks,
 * standing from a day on. ONE transaction reads the roster and the shop
 * whose clock says what «today» is; `RosterWeekSystem.setFrom` judges the
 * week and replaces the versions from the day on (earlier weeks are the
 * record); the roster is written whole — a chair with none starts one,
 * with no turnaround. The capacity rebuild and the audit row ride the
 * roster's own triggers.
 *
 * The caller's refusals are the edge decoder's (`roster.wire.ts`).
 */

export type SetRosterWeekCommand = RosterWeek & {
  readonly barberId: BarberId;
  readonly locationId: LocationId;
  readonly fromLocalDate: LocalDate;
};

export type SetRosterWeekPorts = CommitPorts & ClockPorts;

type Snapshot = {
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
        const [schedule, location] = await Promise.all([
          tx.get<BarberSchedule>(path),
          tx.get<ShopLocation>([Collections.Locations, cmd.locationId]),
        ]);
        return { schedule, location };
      },
      ({ schedule, location }) => {
        if (location === null) {
          return Result.err(SchedulingError.rosterInvalidInput('locationId'));
        }
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
                }),
              ],
            })
          : versions;
      },
    );
    return committed.ok ? Result.ok({ barberId: cmd.barberId }) : committed;
  };
