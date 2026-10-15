import {
  BookingStatus,
  type BusyKey,
  type LocalDate,
  type RepositoryError,
  Result,
  type TimeZone,
} from '@core/primitives';
import { type Appointment, Collections, QueryOp } from '@core/entities';
import type { QuerySpec, TelemetryPorts, TxPorts } from '@core/ports';
import { BusySystem, ZonedTimeSystem } from '@core/systems';

/**
 * `rebuildBusy` — keep `barberBusy` equal to what the appointments say
 * (`rebuild-busy.ts`, blueprint §4.1). The projection stores NORMALIZED
 * geometry, so a change is never subtracted: every busy day either side of
 * an appointment write touches is RECOMPUTED from every live appointment
 * that occupies it, one transaction per day — the read (`busyKeys
 * array-contains key ∧ bookingStatus in [PENDING, CONFIRMED]`, index #7)
 * is what serialises the rebuild against a booking commit. A day nothing
 * live occupies is DELETED (`BusySystem.rebuild`).
 *
 * A failed day is logged and the failure goes on to the edge — the days
 * after it are repaired by the next write, as today.
 */

/** What one appointment write asks of the projection — both sides of the write, and the tenant's clock zone. */
export type RebuildBusyCommand = {
  readonly before: Appointment | null;
  readonly after: Appointment | null;
  /** The zone a busy day's first instant (`utcEpochMs`) is stamped in — the tenant's (`TENANT_ZONE`). */
  readonly timeZone: TimeZone;
};

/** The busy days rebuilt, in key order. */
export type RebuildBusyAnswer = {
  readonly rebuiltKeys: readonly BusyKey[];
};

export type RebuildBusyPorts = Pick<TxPorts, 'commit'> &
  Pick<TelemetryPorts, 'log'>;

/** The live appointments on one busy day — the rebuild's whole read set. */
export function liveOnBusyDay(key: BusyKey): QuerySpec {
  return {
    collection: [Collections.Appointments],
    where: [
      { field: 'busyKeys', op: QueryOp.ArrayContains, value: key },
      {
        field: 'bookingStatus',
        op: QueryOp.In,
        value: [BookingStatus.Pending, BookingStatus.Confirmed],
      },
    ],
    orderBy: [],
    limit: null,
  };
}

export const rebuildBusy =
  (ports: RebuildBusyPorts) =>
  async (
    cmd: RebuildBusyCommand,
  ): Promise<Result<RebuildBusyAnswer, RepositoryError>> => {
    const dayStartUtcMs = (localDate: LocalDate) =>
      ZonedTimeSystem.startOfLocalDay(localDate, cmd.timeZone);
    const keys = BusySystem.affectedKeys(cmd.before, cmd.after);
    const rebuiltKeys: BusyKey[] = [];
    for (const key of keys) {
      let committed: Result<unknown, RepositoryError>;
      try {
        committed = await ports.commit(
          (tx) => tx.query<Appointment>(liveOnBusyDay(key)),
          (live) => {
            const write = BusySystem.rebuild(key, live, dayStartUtcMs);
            return Result.ok({ writes: write === null ? [] : [write] });
          },
        );
      } catch (error) {
        // Surfaced for the operator, never swallowed: the projection is
        // repaired by the NEXT write either way, but a persistent failure
        // here means cancelled time stays blocked.
        ports.log('error', 'barberBusy rebuild failed', { key, error });
        throw error;
      }
      if (!committed.ok) return committed;
      rebuiltKeys.push(key);
    }
    return Result.ok({ rebuiltKeys });
  };
