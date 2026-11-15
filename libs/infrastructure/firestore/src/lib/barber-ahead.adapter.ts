import {
  type Firestore,
  collection,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import {
  type Appointment,
  type BarberBusyDay,
  Collections,
} from '@core/entities';
import type { BarberAheadPorts } from '@core/ports';
import { type ReadGuard, readQuery } from './observe';

/**
 * The most busy days one read answers: past a year ahead nobody is booked
 * (the booking horizon is weeks), and the projection's TTL removes a day
 * once it is behind.
 */
const BUSY_DAYS_MAX = 400;

/**
 * What lies ahead of one barber — `BARBER_AHEAD_PORTS` (team onboarding
 * D10): the reads behind «how many bookings would this last day leave
 * behind», each made ONCE.
 *
 * - `loadBusyDaysFrom` — `barberBusy` by barber and day (`barberId ==`,
 *   `localDate >=`, ordered by day: the projection's existing composite
 *   index). Only the days that exist are read — the public projection the
 *   booking grid reads one day at a time.
 * - `loadBarberDay` — `appointments where busyKeys array-contains key`,
 *   the single-field query the day sheet listens on. Rules allow it for
 *   whoever works the book.
 *
 * Both answer through the read guard's LIST rule (`readQuery`): a stored
 * row the guard refuses is dropped and reported, and a refused read is the
 * port's `RepositoryError`. Reads only.
 */
export const barberAheadPorts = (
  db: Firestore,
  guard: ReadGuard,
): BarberAheadPorts => ({
  loadBusyDaysFrom: (barberId, fromLocalDate) =>
    readQuery<BarberBusyDay>(
      query(
        collection(db, Collections.BarberBusy),
        where('barberId' satisfies keyof BarberBusyDay, '==', barberId),
        where('localDate' satisfies keyof BarberBusyDay, '>=', fromLocalDate),
        orderBy('localDate' satisfies keyof BarberBusyDay),
        limit(BUSY_DAYS_MAX),
      ),
      Collections.BarberBusy,
      guard,
    ),

  loadBarberDay: (key) =>
    readQuery<Appointment>(
      // unbounded-ok: one barber's day at every shop, every status: the day's visits, cancelled ones included
      query(
        collection(db, Collections.Appointments),
        where('busyKeys' satisfies keyof Appointment, 'array-contains', key),
      ),
      Collections.Appointments,
      guard,
    ),
});
