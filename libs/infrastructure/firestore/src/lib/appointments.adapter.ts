import {
  type Firestore,
  type Query,
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
import { PagingSystem, type StoredDocument } from '@core/systems';
import {
  keepAdmitted,
  ListAdmission,
  observeCountedQuery,
  observeDoc,
  observeQuery,
  type ReadGuard,
  readFailed,
  readRawQuery,
} from './observe';

/** Ascending by the absolute start — the order a day sheet reads in. */
const byStart = (a: Appointment, b: Appointment): number =>
  UtcEpochMs.compare(a.utcEpochMs, b.utcEpochMs);

/** The start instant a newest-first page is ordered and resumed by. */
const startOf = (appointment: Appointment): UtcEpochMs =>
  appointment.utcEpochMs;

/** A document's id — what orders a tied instant. */
const idOf = (appointment: Appointment): AppointmentId => appointment.id;

/**
 * The cursor a next page can range below — `null` for a stored `NaN`: it
 * sorts below every number in Firestore, so nothing well-formed is older,
 * and the store refuses a `where('utcEpochMs', '<', NaN)` (edge hardening,
 * DEP-14). The raw rows are cut before they are admitted, so the cursor may
 * be such a row's instant.
 */
const resumable = (cursor: UtcEpochMs | null): UtcEpochMs | null =>
  cursor !== null && Number.isNaN(cursor) ? null : cursor;

/**
 * `appointments/*`, read side (flip 1, plan §3.4) — the successor of
 * `FirestoreAppointmentRepository`'s reads and `FirestoreClientHistoryReader`.
 * One function per query shape, every key a root key, every document its
 * entity (Law 5); the web never writes an appointment (callable-only).
 *
 * Which of the answered visits are still ahead, or already history, is a
 * system's decision against the shop's `ShopNow` — never this adapter's.
 *
 * Built with a {@link ReadGuard} (`guardedReads`, the composition root's),
 * every read passes the appointment guard (edge hardening D-3): a single
 * visit that is malformed answers `REPOSITORY_MALFORMED`; the staff lists
 * (`observeBarberDay`, `observeHistory`, `searchAppointmentWindow`, the
 * paged history) DROP it and report it, refusing only when the WHOLE answer
 * keeps none — the search's two halves admitted together, the history
 * judged on its first page (a later page that drops every row answers an
 * empty page and the history goes on) — c1db661's list posture, plus the
 * report and the systemic rule; the staff day answers how many it dropped
 * (`BarberDayRead.unreadableCount`, OR-2); `observeUpcoming` stays STRICT (a booking
 * you cannot see is a booking you cannot cancel). The guard is REQUIRED
 * (OR-33, DEP-F24): a bare `appointmentReadPorts(db)` does not type-check,
 * and the raw reads the page and the search cut before admitting
 * (`readRawQuery`) are admitted through it.
 */
export const appointmentReadPorts = (
  db: Firestore,
  guard: ReadGuard,
): AppointmentReadPorts => {
  const path = Collections.Appointments;
  const appointments = collection(db, path);

  /**
   * Visits read RAW (`readRawQuery`, no guard) — typed as visits for
   * `PagingSystem`'s cut alone, which keys them by their instant and id:
   * the page and its cursor are cut on the rows as read, and only then is
   * the page admitted (`admitPage`).
   */
  const rawVisits = async (
    raw: Query,
  ): Promise<Result<readonly Appointment[], RepositoryError>> =>
    (await readRawQuery(raw, path)) as unknown as Result<
      readonly Appointment[],
      RepositoryError
    >;

  /** A person's visits (as company too), newest start first — read RAW. */
  const newestFirst = (
    theirs: QueryConstraint,
    before: readonly QueryConstraint[],
    max: number,
  ) =>
    rawVisits(
      query(
        appointments,
        theirs,
        ...before,
        orderBy('utcEpochMs', 'desc'),
        limit(max),
      ),
    );

  /**
   * The page's rows through the LIST rule — dropped and reported (once per
   * `pageClientHistory` call). The systemic rule judges the history on its
   * FIRST page only (`first`): there, every row dropped refuses — a client
   * whose newest visits are all unreadable shows the read failure, never an
   * empty history. A LATER page that drops every row answers an empty page
   * (its cursor kept, so older visits still load), never a refusal that
   * would strand everything below it.
   */
  const admitPage = (
    rows: readonly Appointment[],
    reported: Set<string>,
    first: boolean,
  ): Result<readonly Appointment[], RepositoryError> =>
    keepAdmitted<Appointment>(
      rows as unknown as readonly StoredDocument[],
      path,
      guard,
      reported,
      first ? ListAdmission.DropMalformed : ListAdmission.DropOnly,
    );

  /**
   * One page of a client's history: `size + 1` rows read to know whether
   * anything older is left; on a tie at the page's last instant, every row
   * AT that instant and one row below it are read, and `PagingSystem` takes
   * the instant whole. The three queries read the RAW rows, so the page and
   * its cursor are cut on what Firestore ordered; the page's rows are then
   * admitted — a page may come out short, the history never ends early.
   * The first page ranges `utcEpochMs <= UtcEpochMs.MAX` like every later
   * page ranges below its cursor: Firestore's range filters are
   * type-bounded, so a stored `utcEpochMs` that is not a number (a string,
   * a map) never enters the read and can never become the cursor — in a
   * `desc` read it would sort before every instant (such a row was never
   * orderable among the instants; it cannot be reported here either). A
   * numeric but malformed one (fractional, negative) orders as a number,
   * cuts correctly and is then dropped by the guard. A stored `NaN` is a
   * number to Firestore that sorts BELOW every other number, so it can only
   * be the last row of a history — no well-formed visit lies below it —
   * and is dropped there; when it is the page's last row as read it would
   * be the cursor, and Firestore refuses a range below `NaN`, so that page
   * answers no cursor ({@link resumable}): the history ends where nothing
   * well-formed is left.
   */
  const pageOf = async (
    subjectCustomerId: CustomerId,
    beforeUtcMs: UtcEpochMs | null,
    max: number,
    reported: Set<string>,
  ): Promise<Result<ClientHistoryPage, RepositoryError>> => {
    const size = PagingSystem.pageSize(max);
    const theirs = where(
      'subjectCustomerIds',
      'array-contains',
      subjectCustomerId,
    );
    const read = await newestFirst(
      theirs,
      [
        beforeUtcMs === null
          ? where('utcEpochMs', '<=', UtcEpochMs.MAX)
          : where('utcEpochMs', '<', beforeUtcMs),
      ],
      size + 1,
    );
    if (!read.ok) return read;
    const first = beforeUtcMs === null;
    const step = PagingSystem.nextCursor(read.value, size, startOf);
    if (step.pageStep === PageStep.Page) {
      const page = admitPage(step.rows, reported, first);
      return page.ok
        ? Result.ok({
            appointments: page.value,
            nextBeforeUtcMs: resumable(step.cursor),
          })
        : page;
    }
    const [sameInstant, older] = await Promise.all([
      rawVisits(
        query(appointments, theirs, where('utcEpochMs', '==', step.boundary)),
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
    const page = admitPage(whole.rows, reported, first);
    return page.ok
      ? Result.ok({ appointments: page.value, nextBeforeUtcMs: whole.cursor })
      : page;
  };

  /**
   * The nearest visits on either side of `nowUtcMs`, ascending by start.
   * Both halves are read RAW and admitted ONCE, as the one answer they make
   * — so the systemic rule judges the whole window: a half whose every row
   * is malformed (the evening's only upcoming visit) drops beside the other
   * half's visits instead of refusing the search; only a window that read
   * rows and kept none refuses.
   */
  const windowOf = async (
    nowUtcMs: UtcEpochMs,
    limitPerSide: number,
  ): Promise<Result<readonly Appointment[], RepositoryError>> => {
    const [past, upcoming] = await Promise.all([
      readRawQuery(
        query(
          appointments,
          where('utcEpochMs', '<', nowUtcMs),
          orderBy('utcEpochMs', 'desc'),
          limit(limitPerSide),
        ),
        path,
      ),
      readRawQuery(
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
    return keepAdmitted<Appointment>(
      [...past.value].reverse().concat(upcoming.value),
      path,
      guard,
      null,
    );
  };

  return {
    observeAppointment: (id) => observeDoc(doc(db, path, id), guard),

    /**
     * One barber, one day, every status — the staff day sheet: a bare
     * `busyKeys array-contains` (single-field, the key the busy projection
     * is rebuilt from), sorted by start here because an `orderBy` beside it
     * would need a composite index for a handful of documents. Cancelled
     * rows included: the sheet greys them rather than leaving a gap. The
     * visits the guard dropped are COUNTED beside the rest
     * (`unreadableCount`, OR-2 — `admitCounted`, the same loop that drops
     * them), so the sheet says a chair holds visits it cannot show.
     */
    observeBarberDay: (key) =>
      observeCountedQuery<Appointment>(
        query(appointments, where('busyKeys', 'array-contains', key)),
        path,
        guard,
      ).pipe(
        map((answer) =>
          answer.ok
            ? Result.ok({
                appointments: [...answer.value.kept].sort(byStart),
                unreadableCount: answer.value.dropped,
              })
            : answer,
        ),
      ),

    /**
     * The account's live bookings, by start (index #6: `ownerUserId`,
     * `bookingStatus`, `utcEpochMs`). STRICT: one malformed booking refuses
     * the whole answer — a booking the client cannot see is one they cannot
     * cancel (c1db661's posture, kept).
     */
    observeUpcoming: (ownerUserId) =>
      observeQuery<Appointment>(
        query(
          appointments,
          where('ownerUserId', '==', ownerUserId),
          where('bookingStatus', 'in', BookingLifecycle.LIVE_STATUSES),
          orderBy('utcEpochMs'),
        ),
        path,
        guard,
        ListAdmission.RefuseMalformed,
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
        guard,
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
        return await pageOf(subjectCustomerId, beforeUtcMs, max, new Set());
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
