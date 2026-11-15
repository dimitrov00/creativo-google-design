import { Actor, SystemSource, type WriteOp } from '@core/components';
import { type BarberId, LogEvent, Result } from '@core/primitives';
import type { RepositoryError } from '@core/errors';
import type { Barber } from '@core/entities';
import { EmploymentSystem, ZonedTimeSystem } from '@core/systems';
import {
  closeBarberPeriod,
  type CloseIfEndedPorts,
} from './close-barber-period.pipeline';
import { readShopZone } from './shop-zone-read.pipeline';
import { TEAM_BARBERS } from './team-caller.pipeline';

/**
 * `closeEndedPeriods` — the daily close (team onboarding D10): every
 * barber whose last working day is behind the shop's today leaves the
 * team, with nobody having to remember.
 *
 * - **«Today»** is the default location's, read once, as the other
 *   scheduled jobs read theirs. A zone that cannot be read is the run's
 *   store failure.
 * - **Who** is `EmploymentSystem.dueOf` over every barber record: the
 *   periods that have ended — a last day BEFORE today, so a missed run is
 *   caught up — and the departures that still owe their account a revoke.
 * - **Each** is one `closeBarberPeriod`, credited to the job
 *   (`SCHEDULED_JOB`). Its commit re-reads the record, so an extension
 *   made between the list and the close wins.
 * - **Failures are isolated per barber**: one that could not close is
 *   logged (`team.period_close_failed`) and the rest go ahead; the next
 *   run tries it again.
 *
 * The run takes no command: the tick carries nothing the close reads.
 */

/** What a run left, by record. */
export type EndedPeriodsAnswer = {
  /** The records that left with this run. */
  readonly closedBarberIds: readonly BarberId[];
  /** The records whose account's sessions are still to be ended. */
  readonly revokeOwedBarberIds: readonly BarberId[];
  /** The records whose close could not be read or written. */
  readonly failedBarberIds: readonly BarberId[];
};

export type CloseEndedPeriodsPorts = CloseIfEndedPorts;

/** The run's list: the records to work on, read and nothing written. */
type Listed = {
  readonly due: readonly BarberId[];
  readonly writes: readonly WriteOp[];
};

export const closeEndedPeriods =
  (ports: CloseEndedPeriodsPorts) =>
  async (): Promise<Result<EndedPeriodsAnswer, RepositoryError>> => {
    const zone = await readShopZone(ports)(null);
    if (!zone.ok) return zone;
    const today = ZonedTimeSystem.shopNow(
      ports.nowUtcMs(),
      zone.value,
    ).localDate;
    const listed = await ports.commit(
      (tx) => tx.query<Barber>(TEAM_BARBERS),
      (barbers): Result<Listed, never> =>
        Result.ok({
          due: EmploymentSystem.dueOf(barbers, today),
          writes: [],
        }),
    );
    if (!listed.ok) return listed;

    const actor = Actor.system(SystemSource.ScheduledJob);
    const closedBarberIds: BarberId[] = [];
    const revokeOwedBarberIds: BarberId[] = [];
    const failedBarberIds: BarberId[] = [];
    const failed = (barberId: BarberId, error: unknown): void => {
      failedBarberIds.push(barberId);
      ports.log('error', LogEvent.TeamPeriodCloseFailed, { barberId, error });
    };
    for (const barberId of listed.value.due) {
      try {
        const close = await closeBarberPeriod(ports)({
          barberId,
          today,
          actor,
        });
        if (!close.ok) {
          failed(barberId, close.error.errorCode);
          continue;
        }
        if (close.value.closed) closedBarberIds.push(barberId);
        if (close.value.revokeOwed) revokeOwedBarberIds.push(barberId);
      } catch (error) {
        failed(barberId, error);
      }
    }
    return Result.ok({ closedBarberIds, revokeOwedBarberIds, failedBarberIds });
  };
