import { type Firestore, doc } from 'firebase/firestore';
import { distinctUntilChanged, map, startWith } from 'rxjs';
import { BookingPolicy } from '@core/components';
import { Result } from '@core/primitives';
import {
  BOOKING_POLICY_DOC,
  type BookingPolicySettings,
  Collections,
} from '@core/entities';
import type { SchedulingReadPorts } from '@core/ports';
import { observeDoc, type ReadGuard } from './observe';

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
 * The other five members read through the same guard, as stored — the
 * registry guards none of their collections. The guard is REQUIRED (OR-33,
 * DEP-F24): a bare `schedulingReadPorts(db)` does not type-check.
 *
 * Reads only. The browser writes none of these: a day exception changes
 * through the `setDayExceptions` callable (team onboarding O4), a roster
 * through `setRosterWeek` and `amendRosterBreaks`.
 */
export const schedulingReadPorts = (
  db: Firestore,
  guard: ReadGuard,
): SchedulingReadPorts => ({
  observeBusyDay: (key) =>
    observeDoc(doc(db, Collections.BarberBusy, key), guard),
  observeExceptions: (key) =>
    observeDoc(doc(db, Collections.ScheduleExceptions, key), guard),
  observeSchedule: (barberId) =>
    observeDoc(doc(db, Collections.BarberSchedules, barberId), guard),
  observeLocation: (locationId) =>
    observeDoc(doc(db, Collections.Locations, locationId), guard),
  observeCapacityMonth: (month) =>
    observeDoc(doc(db, Collections.Capacity, month), guard),
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
      guard,
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
