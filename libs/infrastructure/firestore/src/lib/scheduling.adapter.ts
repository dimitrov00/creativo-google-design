import { type Firestore, doc, runTransaction } from 'firebase/firestore';
import { distinctUntilChanged, map, startWith } from 'rxjs';
import { BookingPolicy } from '@core/components';
import { Result, defect } from '@core/primitives';
import {
  BOOKING_POLICY_DOC,
  type BookingPolicySettings,
  Collections,
  type ScheduleException,
} from '@core/entities';
import type { ScheduleExceptionPorts, SchedulingReadPorts } from '@core/ports';
import {
  entityOf,
  observeDoc,
  type ReadGuard,
  UNGUARDED,
  writeFailed,
} from './observe';

/**
 * The booking store's raw scheduling streams (flip 1, plan §3.4) — the
 * successor of `FirestoreAvailabilityReader`'s reads, WITHOUT its fold:
 * availability is a `computed()` over these streams calling `RosterSystem`
 * and `AvailabilitySystem` (+ `CapacitySystem` for the month), never an
 * adapter's business (F1-10, Law 4). Each member is one document, live, its
 * body the entity (Law 5):
 *
 * - `barberBusy/{BusyKey}` and `scheduleExceptions/{BusyKey}` — the busy
 *   blocks and the public exception effect of one barber's day (PII-free,
 *   `/book` reads them anonymously);
 * - `barberSchedules/{barberId}`, `locations/{locationId}` — the roster and
 *   the shop (its `timeZone`, its `openingHours`);
 * - `capacity/{YYYY-MM}` — the month calendar's free minutes (§9 D7);
 * - `settings/bookingPolicy` — the tenant's policy, defaults as the floor.
 *
 * Built with a {@link ReadGuard} (the composition root's `guardedReads`),
 * `observeBusyDay` answers the SINGLE rule (edge hardening D-3): a malformed
 * busy day emits `REPOSITORY_MALFORMED` and the listener stays — the grid
 * shows that barber-day as unreadable, fail-closed, never as free time (the
 * old reader dropped a corrupt span and offered the time under it, DEP-2).
 * The other five members read as stored. A bare `schedulingReadPorts(db)`
 * guards nothing.
 */
export const schedulingReadPorts = (
  db: Firestore,
  guard: ReadGuard = UNGUARDED,
): SchedulingReadPorts => ({
  observeBusyDay: (key) =>
    observeDoc(doc(db, Collections.BarberBusy, key), guard),
  observeExceptions: (key) =>
    observeDoc(doc(db, Collections.ScheduleExceptions, key)),
  observeSchedule: (barberId) =>
    observeDoc(doc(db, Collections.BarberSchedules, barberId)),
  observeLocation: (locationId) =>
    observeDoc(doc(db, Collections.Locations, locationId)),
  observeCapacityMonth: (month) =>
    observeDoc(doc(db, Collections.Capacity, month)),
  /**
   * `settings/bookingPolicy`, live, never `null`: the document IS the flat
   * `BookingPolicySettings` (Law 5), and it reaches the store through the
   * component's edge guard, `BookingPolicy.withDefaults` (§9 D28) — an
   * absent or partial body reads as the defaults (a tenant with no policy
   * document is the normal case). As today's reader: the stream STARTS on the
   * defaults, so the calendar is never briefly empty while the first
   * snapshot is a round trip away, and emits only when the policy CHANGES
   * (field-wise), so a seeded document saying the defaults re-bills nothing
   * downstream. A refused read is the port's `RepositoryError`.
   */
  observePolicy: () =>
    observeDoc<BookingPolicySettings>(
      doc(db, Collections.Settings, BOOKING_POLICY_DOC),
    ).pipe(
      map((answer) =>
        answer.ok
          ? Result.ok(BookingPolicy.withDefaults(answer.value))
          : answer,
      ),
      startWith(Result.ok(BookingPolicy.DEFAULT)),
      distinctUntilChanged(
        (a, b) => a.ok && b.ok && BookingPolicy.equals(a.value, b.value),
      ),
    ),
});

/**
 * The staff's pen on the roster — `writeScheduleException` (§4.2): every
 * key's stored exception is read and the pure merge's answer written inside
 * ONE transaction, so two staff editing one day never lose a block. A
 * merge that refuses writes nothing; a `null` answer deletes that day's
 * document (a day with nothing left blocked), and a key that held nothing
 * and still holds nothing is not written at all. The arithmetic is
 * `ScheduleExceptionSystem`'s, handed in as `merge` — none of it is here.
 */
export const scheduleExceptionPorts = (
  db: Firestore,
): ScheduleExceptionPorts => ({
  writeScheduleException: async (keys, merge) => {
    const refs = keys.map((key) =>
      doc(db, Collections.ScheduleExceptions, key),
    );
    try {
      return await runTransaction(db, async (tx) => {
        const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
        const stored = snaps.map((snap) => {
          const data = snap.data();
          return data === undefined
            ? null
            : entityOf<ScheduleException>(snap.id, data);
        });
        const merged = merge(stored);
        if (!merged.ok) return merged;
        if (merged.value.length !== refs.length) {
          defect(
            `writeScheduleException: ${refs.length} keys, ${merged.value.length} answers`,
          );
        }
        refs.forEach((ref, i) => {
          const next = merged.value.at(i) ?? null;
          if (next !== null) {
            const { id, ...body } = next;
            if (id !== ref.id) {
              defect(`writeScheduleException: ${id} answered for ${ref.id}`);
            }
            tx.set(ref, body);
          } else if (stored.at(i) !== null) {
            tx.delete(ref);
          }
        });
        return Result.ok(undefined);
      });
    } catch (cause) {
      return Result.err(writeFailed(Collections.ScheduleExceptions, cause));
    }
  },
});
