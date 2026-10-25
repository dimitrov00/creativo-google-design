import {
  type Firestore,
  type QueryConstraint,
  collection,
  doc,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { map } from 'rxjs';
import {
  type AppointmentId,
  type CustomerId,
  Result,
  UtcEpochMs,
} from '@core/primitives';
import { type RepositoryError } from '@core/errors';
import { BookingLifecycle, PageStep } from '@core/components';
import { type Appointment, Collections } from '@core/entities';
import type { AppointmentReadPorts, ClientHistoryPage } from '@core/ports';
import { PagingSystem } from '@core/systems';
import { observeDoc, observeQuery, readFailed, readQuery } from './observe';

/** Ascending by the absolute start — the order a day sheet reads in. */
const byStart = (a: Appointment, b: Appointment): number =>
  UtcEpochMs.compare(a.utcEpochMs, b.utcEpochMs);

/** The start instant a newest-first page is ordered and resumed by. */
const startOf = (appointment: Appointment): UtcEpochMs =>
  appointment.utcEpochMs;

/** A document's id — what orders a tied instant. */
const idOf = (appointment: Appointment): AppointmentId => appointment.id;

/**
 * `appointments/*`, read side (flip 1, plan §3.4) — the successor of
 * `FirestoreAppointmentRepository`'s reads and `FirestoreClientHistoryReader`.
 * One function per query shape, every key a root key, every document its
 * entity (Law 5); the web never writes an appointment (callable-only).
 *
 * Which of the answered visits are still ahead, or already history, is a
 * system's decision against the shop's `ShopNow` — never this adapter's.
 */
export const appointmentReadPorts = (db: Firestore): AppointmentReadPorts => {
  const path = Collections.Appointments;
  const appointments = collection(db, path);

  /** A person's visits (as company too), newest start first. */
  const newestFirst = (
    theirs: QueryConstraint,
    before: readonly QueryConstraint[],
    max: number,
  ) =>
    readQuery<Appointment>(
      query(
        appointments,
        theirs,
        ...before,
        orderBy('utcEpochMs', 'desc'),
        limit(max),
      ),
      path,
    );

  /**
   * One page of a client's history: `size + 1` rows read to know whether
   * anything older is left; on a tie at the page's last instant, every row
   * AT that instant and one row below it are read, and `PagingSystem` takes
   * the instant whole.
   */
  const pageOf = async (
    subjectCustomerId: CustomerId,
    beforeUtcMs: UtcEpochMs | null,
    max: number,
  ): Promise<Result<ClientHistoryPage, RepositoryError>> => {
    const size = PagingSystem.pageSize(max);
    const theirs = where(
      'subjectCustomerIds',
      'array-contains',
      subjectCustomerId,
    );
    const read = await newestFirst(
      theirs,
      beforeUtcMs === null ? [] : [where('utcEpochMs', '<', beforeUtcMs)],
      size + 1,
    );
    if (!read.ok) return read;
    const step = PagingSystem.nextCursor(read.value, size, startOf);
    if (step.pageStep === PageStep.Page) {
      return Result.ok({
        appointments: step.rows,
        nextBeforeUtcMs: step.cursor,
      });
    }
    const [sameInstant, older] = await Promise.all([
      readQuery<Appointment>(
        query(appointments, theirs, where('utcEpochMs', '==', step.boundary)),
        path,
      ),
      newestFirst(theirs, [where('utcEpochMs', '<', step.boundary)], 1),
    ]);
    if (!sameInstant.ok) return sameInstant;
    if (!older.ok) return older;
    const whole = PagingSystem.sameInstantBoundary(
      step.newer,
      sameInstant.value,
      idOf,
      older.value.length > 0,
      step.boundary,
    );
    return Result.ok({
      appointments: whole.rows,
      nextBeforeUtcMs: whole.cursor,
    });
  };

  /** The nearest visits on either side of `nowUtcMs`, ascending by start. */
  const windowOf = async (
    nowUtcMs: UtcEpochMs,
    limitPerSide: number,
  ): Promise<Result<readonly Appointment[], RepositoryError>> => {
    const [past, upcoming] = await Promise.all([
      readQuery<Appointment>(
        query(
          appointments,
          where('utcEpochMs', '<', nowUtcMs),
          orderBy('utcEpochMs', 'desc'),
          limit(limitPerSide),
        ),
        path,
      ),
      readQuery<Appointment>(
        query(
          appointments,
          where('utcEpochMs', '>=', nowUtcMs),
          orderBy('utcEpochMs'),
          limit(limitPerSide),
        ),
        path,
      ),
    ]);
    if (!past.ok) return past;
    if (!upcoming.ok) return upcoming;
    return Result.ok([...past.value].reverse().concat(upcoming.value));
  };

  return {
    observeAppointment: (id) => observeDoc(doc(db, path, id)),

    /**
     * One barber, one day, every status — the staff day sheet: a bare
     * `busyKeys array-contains` (single-field, the key the busy projection
     * is rebuilt from), sorted by start here because an `orderBy` beside it
     * would need a composite index for a handful of documents. Cancelled
     * rows included: the sheet greys them rather than leaving a gap.
     */
    observeBarberDay: (key) =>
      observeQuery<Appointment>(
        query(appointments, where('busyKeys', 'array-contains', key)),
        path,
      ).pipe(
        map((answer) =>
          answer.ok ? Result.ok([...answer.value].sort(byStart)) : answer,
        ),
      ),

    /** The account's live bookings, by start (index #6: `ownerUserId`, `bookingStatus`, `utcEpochMs`). */
    observeUpcoming: (ownerUserId) =>
      observeQuery<Appointment>(
        query(
          appointments,
          where('ownerUserId', '==', ownerUserId),
          where('bookingStatus', 'in', BookingLifecycle.LIVE_STATUSES),
          orderBy('utcEpochMs'),
        ),
        path,
      ),

    /** The account's newest `max` visits, newest start first (index #18: `ownerUserId`, `utcEpochMs` desc). */
    observeHistory: (ownerUserId, max) =>
      observeQuery<Appointment>(
        query(
          appointments,
          where('ownerUserId', '==', ownerUserId),
          orderBy('utcEpochMs', 'desc'),
          limit(max),
        ),
        path,
      ),

    /**
     * The client card's history, a page at a time — `subjectCustomerIds
     * array-contains`, `utcEpochMs <` the cursor, newest first (index #19).
     * A page never ends between two visits sharing one start instant
     * (`PagingSystem`'s same-instant boundary rule), so the cursor — the
     * oldest start of the page — skips nothing.
     */
    pageClientHistory: async (subjectCustomerId, beforeUtcMs, max) => {
      try {
        return await pageOf(subjectCustomerId, beforeUtcMs, max);
      } catch (cause) {
        // `limit(n)` refuses a count that is not a whole positive number.
        return Result.err(readFailed(path, cause));
      }
    },

    /**
     * The staff search pool and the add-client page's «Скорошни» — the
     * nearest visits on either side of now: two halves, each a range and an
     * `orderBy` on the SAME root key, so both ride the automatic single-field
     * index on `utcEpochMs` (no composite, and no fieldOverride may ever be
     * put on it). Ordering each half outward from now is what makes the
     * limit cut the far edges, not the middle; the two are answered as one
     * list, ascending by start.
     */
    searchAppointmentWindow: async (nowUtcMs, limitPerSide) => {
      try {
        return await windowOf(nowUtcMs, limitPerSide);
      } catch (cause) {
        return Result.err(readFailed(path, cause));
      }
    },
  };
};
