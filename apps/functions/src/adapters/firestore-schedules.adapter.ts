import type { Firestore } from 'firebase-admin/firestore';
import {
  BarberId,
  type BusyKey,
  RepositoryError,
  Result,
} from '@core/primitives';
import {
  type BarberBusyDay,
  type BarberSchedule,
  Collections,
  type ScheduleException,
} from '@core/entities';
import type { BarberListPorts, ShopDayReadPorts } from '@core/ports';
import { TriggerAttemptSystem } from '@core/systems';

/**
 * The scheduling server reads outside any transaction (flip 1, blueprint
 * §4.1) — the waitlist matcher's day and the capacity sweep's population:
 *
 * - `loadSchedule` — `barberSchedules/{barberId}`;
 * - `loadBusyDay` — `barberBusy/{BusyKey}`, as stored (the caller pads it:
 *   `schedulingPortsContract`);
 * - `loadScheduleException` — `scheduleExceptions/{BusyKey}`, the same key;
 * - `listBarbers` — the ROSTERED barbers: the ids of `barberSchedules`,
 *   bodies not read (`select()`).
 *
 * Bodies are spread as stored (`{ id, ...snap.data() }`), `null` when absent;
 * a read that throws answers a `RepositoryError` value whose `reason` is the
 * failure's canonical code.
 */

function readFailed(path: string, error: unknown): RepositoryError {
  return RepositoryError.readFailed(
    path,
    TriggerAttemptSystem.failureCode(error),
  );
}

/** One document by collection and id — the entity, or `null` when absent. */
async function loadOne<E>(
  db: Firestore,
  collection: string,
  id: string,
): Promise<Result<E | null, RepositoryError>> {
  const path = `${collection}/${id}`;
  try {
    const snap = await db.collection(collection).doc(id).get();
    return Result.ok(
      snap.exists ? ({ id: snap.id, ...snap.data() } as E) : null,
    );
  } catch (error) {
    return Result.err(readFailed(path, error));
  }
}

export const firestoreSchedulePorts = (
  db: Firestore,
): BarberListPorts & ShopDayReadPorts => ({
  loadSchedule: (barberId) =>
    loadOne<BarberSchedule>(db, Collections.BarberSchedules, barberId),

  loadBusyDay: (key: BusyKey) =>
    loadOne<BarberBusyDay>(db, Collections.BarberBusy, key),

  loadScheduleException: (key: BusyKey) =>
    loadOne<ScheduleException>(db, Collections.ScheduleExceptions, key),

  listBarbers: async () => {
    try {
      const snap = await db
        .collection(Collections.BarberSchedules)
        .select()
        .get();
      return Result.ok(snap.docs.map((doc) => BarberId.of(doc.id)));
    } catch (error) {
      return Result.err(readFailed(Collections.BarberSchedules, error));
    }
  },
});
