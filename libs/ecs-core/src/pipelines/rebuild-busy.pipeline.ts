import { BookingLifecycle } from '@core/components';
import { type BusyKey, type LocalDate, Result } from '@core/primitives';
import { type RepositoryError } from '@core/errors';
import { type Appointment, Collections, QueryOp } from '@core/entities';
import type {
  CommitPorts,
  DefaultLocationPorts,
  LocationLoadPorts,
  LogPorts,
  QuerySpec,
} from '@core/ports';
import { BusySystem, ZonedTimeSystem } from '@core/systems';
import { readShopZone } from './shop-zone-read.pipeline';

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
 * A busy day's first instant (`utcEpochMs`) is stamped on the zone of the
 * written appointment's shop (the side after the write, else before), read
 * once and only when a day needs rebuilding — Law 7.2: the zone lives on the
 * location (`readShopZone`; a zone that cannot be read is a store failure).
 *
 * A failed day is logged and the failure goes on to the edge — the days
 * after it are repaired by the next write, as today.
 */

/** What one appointment write asks of the projection — both sides of the write. */
export type RebuildBusyCommand = {
  readonly before: Appointment | null;
  readonly after: Appointment | null;
};

/** The busy days rebuilt, in key order. */
export type RebuildBusyAnswer = {
  readonly rebuiltKeys: readonly BusyKey[];
};

export type RebuildBusyPorts = CommitPorts &
  LocationLoadPorts &
  DefaultLocationPorts &
  LogPorts;

/** The live appointments on one busy day — the rebuild's whole read set. */
export function liveOnBusyDay(key: BusyKey): QuerySpec {
  return {
    collection: [Collections.Appointments],
    where: [
      { field: 'busyKeys', op: QueryOp.ArrayContains, value: key },
      {
        field: 'bookingStatus',
        op: QueryOp.In,
        value: BookingLifecycle.LIVE_STATUSES,
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
    const keys = BusySystem.affectedKeys(cmd.before, cmd.after);
    if (keys.length === 0) return Result.ok({ rebuiltKeys: [] });
    const written = cmd.after ?? cmd.before;
    const zone = await readShopZone(ports)(
      written === null ? null : written.locationId,
    );
    if (!zone.ok) return zone;
    const dayStartUtcMs = (localDate: LocalDate) =>
      ZonedTimeSystem.startOfLocalDay(localDate, zone.value);
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
