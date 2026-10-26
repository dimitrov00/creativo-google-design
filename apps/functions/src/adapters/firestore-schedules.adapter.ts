import type { Firestore } from 'firebase-admin/firestore';
import { BarberId, type BusyKey, Result } from '@core/primitives';
import { RepositoryError } from '@core/errors';
import {
  type BarberBusyDay,
  type BarberSchedule,
  Collections,
  type ScheduleException,
} from '@core/entities';
import type { BarberListPorts, Log, ShopDayReadPorts } from '@core/ports';
import { type StoredGuardOf, TriggerAttemptSystem } from '@core/systems';
import { admitStored } from './firestore-tx.adapter';

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
 *
 * A present document of a guarded collection (`barberBusy` — the guard
 * registry the composition root passes, `StoredDocumentSystem.guardOf`)
 * passes its stored-document guard first (edge hardening D-3, a SINGLE
 * read): admitted, it is the same object as before; refused, the read
 * answers `RepositoryError.malformed(path, field)` and logs the refusal
 * once (`'malformed document refused'`, `{ path, field }`). The registry
 * and the log are REQUIRED (OR-33, DEP-F24): a bare
 * `firestoreSchedulePorts(db)` does not type-check.
 */

function readFailed(path: string, error: unknown): RepositoryError {
  return RepositoryError.readFailed(
    path,
    TriggerAttemptSystem.failureCode(error),
  );
}

/**
 * One document by collection and id — the entity, `null` when absent, or
 * the guard's refusal (logged once) when the collection is guarded and the
 * document malformed.
 */
async function loadOne<E>(
  db: Firestore,
  collection: string,
  id: string,
  guardOf: StoredGuardOf,
  log: Log,
): Promise<Result<E | null, RepositoryError>> {
  const path = `${collection}/${id}`;
  let snap;
  try {
    snap = await db.collection(collection).doc(id).get();
  } catch (error) {
    return Result.err(readFailed(path, error));
  }
  if (!snap.exists) return Result.ok(null);
  return admitStored<E>(
    guardOf,
    collection,
    { id: snap.id, ...snap.data() },
    log,
  );
}

export const firestoreSchedulePorts = (
  db: Firestore,
  guardOf: StoredGuardOf,
  log: Log,
): BarberListPorts & ShopDayReadPorts => ({
  loadSchedule: (barberId) =>
    loadOne<BarberSchedule>(
      db,
      Collections.BarberSchedules,
      barberId,
      guardOf,
      log,
    ),

  loadBusyDay: (key: BusyKey) =>
    loadOne<BarberBusyDay>(db, Collections.BarberBusy, key, guardOf, log),

  loadScheduleException: (key: BusyKey) =>
    loadOne<ScheduleException>(
      db,
      Collections.ScheduleExceptions,
      key,
      guardOf,
      log,
    ),

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
