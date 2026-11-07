import { type RosterCall, WriteOp } from '@core/components';
import {
  type BarberSchedule,
  Collections,
  type ShopLocation,
} from '@core/entities';
import { type RepositoryError, SchedulingError } from '@core/errors';
import type { ClockPorts, CommitPorts } from '@core/ports';
import { type BarberId, type LocationId, Result } from '@core/primitives';
import {
  type RosterBreakChange,
  RosterBreakSystem,
  ZonedTimeSystem,
} from '@core/systems';

/**
 * `amendRosterBreaks` — a chair's standing breaks changed «from this day on»
 * (owner, 2026-11-06: a lunch is part of the weekly pattern; «Този и
 * следващите» on a break, and a new weekly lunch). ONE transaction reads
 * the roster and the shop whose clock says what «today» is;
 * `RosterBreakSystem.amend` revises the versions from the day on and
 * refuses a past day or a chair with no roster; the roster's `versions`
 * are written whole. One write, whatever the horizon: the capacity rebuild
 * and the audit row ride the roster's own triggers.
 *
 * The caller's refusals (no caller, not working the book, an unreadable
 * field) are the edge decoder's (`roster.wire.ts`).
 */

/** The call as the pipeline reads it — the change, its chair and its shop (the act's id stays at the edge). */
export type AmendRosterBreaksCommand = RosterBreakChange & {
  readonly barberId: BarberId;
  readonly locationId: LocationId;
};

export type AmendRosterBreaksPorts = CommitPorts & ClockPorts;

type Snapshot = {
  readonly schedule: BarberSchedule | null;
  readonly location: ShopLocation | null;
};

export const amendRosterBreaks =
  (ports: AmendRosterBreaksPorts) =>
  async (
    cmd: AmendRosterBreaksCommand,
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
        const versions = RosterBreakSystem.amend(
          schedule,
          cmd.barberId,
          cmd,
          today,
        );
        return versions.ok
          ? Result.ok({
              writes: [WriteOp.update(path, { versions: versions.value })],
            })
          : versions;
      },
    );
    return committed.ok ? Result.ok({ barberId: cmd.barberId }) : committed;
  };
