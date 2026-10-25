import { BookingLifecycle } from '@core/components';
import {
  type BusyKey,
  type LocalDate,
  type LocationId,
  Result,
} from '@core/primitives';
import { type RepositoryError } from '@core/errors';
import { type Appointment, Collections, QueryOp } from '@core/entities';
import type {
  CommitPorts,
  DefaultLocationPorts,
  LocationLoadPorts,
  LogPorts,
  QuerySpec,
} from '@core/ports';
import {
  type AttemptFailure,
  BusySystem,
  TriggerAttemptSystem,
  ZonedTimeSystem,
} from '@core/systems';
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
 * written appointment's shop (the side after the write, else before, else
 * the location a refused side still names), read once and only when a day
 * needs rebuilding — Law 7.2: the zone lives on the location
 * (`readShopZone`; with no location in scope, the default location's, F-4;
 * a zone that cannot be read is a store failure, nothing rebuilt).
 *
 * **Idempotent, so retried (edge-hardening D-5).** The trigger deploys
 * `retry: true`: a day is recomputed from its live appointments and its body
 * is deterministic, so a redelivery writes the identical document (or the
 * same delete). One failed day never costs the others theirs — each failure
 * (a commit's rejection or refusal) is logged and collected, the next day
 * still rebuilt, and the attempt's verdict over them is the edge's
 * (`attemptFailure`, `TriggerAttemptSystem.decisiveFailure`): transient
 * when any one is — the redelivery re-runs every day — else the first,
 * logged and never redelivered (a malformed appointment on the day,
 * `REPOSITORY_MALFORMED` → `data-loss`).
 *
 * **A refused side (edge-hardening D-3).** A side the read-time guard
 * refused reaches the command as `null` plus what it still names
 * (`salvagedKeys`, `salvagedLocationId`) and the refusal itself: its keys
 * are rebuilt too, so repairing or deleting a malformed visit still frees
 * its old day. Safe, because a key only says WHICH day to recompute — the
 * transaction re-reads that day's live appointments, guarded. The refusal
 * is the ANSWER (`REPOSITORY_MALFORMED`, judged `data-loss`: permanent, one
 * attempt line) only when the sides together leave no day to rebuild — the
 * one `affectedKeys` computation decides it, here, never the edge.
 */

/** What one appointment write asks of the projection — both sides of the write. */
export type RebuildBusyCommand = {
  /** The side before the write as admitted — `null` when absent or refused. */
  readonly before: Appointment | null;
  /** The side after the write as admitted — `null` when absent or refused. */
  readonly after: Appointment | null;
  /** The refused sides' salvaged busy keys (D-3) — `[]` when no side was refused. */
  readonly salvagedKeys: readonly BusyKey[];
  /** A refused side's salvaged location — the zone's source when no side was admitted. */
  readonly salvagedLocationId: LocationId | null;
  /** The first side the read-time guard refused — the answer when no day is left to rebuild. */
  readonly refusal: RepositoryError | null;
};

/** The busy days rebuilt, in key order, and every day that failed. */
export type RebuildBusyAnswer = {
  readonly rebuiltKeys: readonly BusyKey[];
  /** Every day's failure, in key order — a refusal or a rejection. */
  readonly failures: readonly unknown[];
  /** The attempt's verdict over them (`TriggerAttemptSystem.decisiveFailure`); `null` when none. */
  readonly attemptFailure: AttemptFailure | null;
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
    const keys = BusySystem.affectedKeys(
      cmd.before,
      cmd.after,
      cmd.salvagedKeys,
    );
    if (keys.length === 0) {
      return cmd.refusal === null
        ? Result.ok({ rebuiltKeys: [], failures: [], attemptFailure: null })
        : Result.err(cmd.refusal);
    }
    const written = cmd.after ?? cmd.before;
    const zone = await readShopZone(ports)(
      written === null ? cmd.salvagedLocationId : written.locationId,
    );
    if (!zone.ok) return zone;
    const dayStartUtcMs = (localDate: LocalDate) =>
      ZonedTimeSystem.startOfLocalDay(localDate, zone.value);
    const rebuiltKeys: BusyKey[] = [];
    const failures: unknown[] = [];
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
        // Surfaced for the operator, never swallowed: a persistent failure
        // here means cancelled time stays blocked. The verdict decides
        // whether the event is redelivered.
        ports.log('error', 'barberBusy rebuild failed', { key, error });
        failures.push(error);
        continue;
      }
      if (!committed.ok) {
        ports.log('error', 'barberBusy rebuild failed', {
          key,
          error: committed.error,
        });
        failures.push(committed.error);
        continue;
      }
      rebuiltKeys.push(key);
    }
    return Result.ok({
      rebuiltKeys,
      failures,
      attemptFailure: TriggerAttemptSystem.decisiveFailure(failures),
    });
  };
