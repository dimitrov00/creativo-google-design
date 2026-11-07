import type { Firestore, Query } from 'firebase-admin/firestore';
import { BarberId, LocalDate, Result } from '@core/primitives';
import type { RepositoryError } from '@core/errors';
import {
  type Appointment,
  Collections,
  QueryOp,
  type ScheduleException,
  type ShopLocation,
} from '@core/entities';
import type { AnalyticsReadPorts, Log } from '@core/ports';
import { BackfillPlanSystem, type StoredGuardOf } from '@core/systems';
import { admitStored } from './firestore-tx.adapter';
import { IN_CHUNK, overBound, readFailed } from './store-answer';

/**
 * Staff analytics' reads over the Admin SDK (`AnalyticsReadPorts`,
 * `docs/designs/staff-analytics.md` — Reads and cost), all outside any
 * transaction, each a root-field query over an index that exists:
 *
 * - `loadVisitsByBusyKeys` — `appointments where busyKeys
 *   array-contains-any`, `IN_CHUNK` keys a query;
 * - `loadFollowUpsOf` — `appointments where bookedFromAppointmentId in`,
 *   `IN_CHUNK` ids a query;
 * - `loadFollowUpsBookedIn` — `appointments where bookedAtUtcMs >= … and
 *   < …`, one range;
 * - `loadDeparturesForBarber` — `scheduleExceptions where barberId == … and
 *   localDate` between (the `(barberId, localDate)` index, #16);
 * - `listBarberRecordIds` — the ids of `barbers`, bodies not read;
 * - `listLocations` — every `locations` document.
 *
 * The queries' answers are concatenated in query order — no rule of the
 * adapter's: a party that holds keys of two chunks comes back twice, and
 * the pipeline counts each appointment once. Bodies are spread as stored
 * (`{ id, ...data }`, Law 5); every `appointments` row passes the
 * stored-document guard first (`StoredDocumentSystem.guardOf`, handed in by
 * `firestore-ports.ts`, the only production construction site), and the
 * FIRST malformed row fails the read — `RepositoryError.malformed`, logged
 * once — so a report is never computed over a silently shorter list.
 *
 * Every query is bounded at a NAMED cap from the design's tenant ceiling
 * (10 barbers × 3 shops, ~15 seats a barber-day, ~4,000 visits a
 * shop-month), read at the cap + 1: an answer past the cap is refused
 * (`overBound` — `REPOSITORY_READ_FAILED`, `resource-exhausted`), never
 * truncated. A read that throws answers `readFailed` with the failure's
 * canonical code.
 */

/**
 * The most visits one barber-day holds — four times the ceiling's 15 seats
 * (cancelled visits keep their keys, so a churned day holds more rows than
 * seats).
 */
const VISITS_PER_BARBER_DAY = 60;

/** The most follow-ups booked from one visit — one per client of a small party, and a rebooking or two. */
const FOLLOW_UPS_PER_VISIT = 5;

/**
 * The most visits booked in one shop range (a month and a day): five times
 * the ceiling's ~4,000 visits a shop-month, which every follow-up and walk-in
 * of the month falls inside.
 */
const BOOKED_IN_RANGE = 20_000;

export const firestoreAnalyticsPorts = (
  db: Firestore,
  guardOf: StoredGuardOf,
  log: Log,
): AnalyticsReadPorts => {
  /**
   * Every row of the query `build` makes, read at `cap + 1` and admitted through the guard —
   * past the cap the read is refused, a malformed row fails it. The query is
   * BUILT inside the read: one the SDK refuses to build is a failed read.
   */
  const bounded = async <E>(
    collection: string,
    build: () => Query,
    cap: number,
  ): Promise<Result<E[], RepositoryError>> => {
    let page;
    try {
      page = await build()
        .limit(cap + 1)
        .get();
    } catch (error) {
      return Result.err(readFailed(collection, error));
    }
    if (page.docs.length > cap) return Result.err(overBound(collection));
    const rows: E[] = [];
    for (const snap of page.docs) {
      const row = admitStored<E>(
        guardOf,
        collection,
        { id: snap.id, ...snap.data() },
        log,
      );
      if (!row.ok) return row;
      rows.push(row.value);
    }
    return Result.ok(rows);
  };

  /** `appointments where field op chunk`, chunk by chunk, every chunk's rows in order. */
  const chunked = async (
    field: string,
    op: typeof QueryOp.ArrayContainsAny | typeof QueryOp.In,
    values: readonly string[],
    perValue: number,
  ): Promise<Result<readonly Appointment[], RepositoryError>> => {
    const chunks = BackfillPlanSystem.chunk(values, IN_CHUNK);
    const answers = await Promise.all(
      chunks.map((chunk) =>
        bounded<Appointment>(
          Collections.Appointments,
          () =>
            db
              .collection(Collections.Appointments)
              .where(field, op, [...chunk]),
          chunk.length * perValue,
        ),
      ),
    );
    const rows: Appointment[] = [];
    for (const answer of answers) {
      if (!answer.ok) return answer;
      rows.push(...answer.value);
    }
    return Result.ok(rows);
  };

  return {
    loadVisitsByBusyKeys: (keys) =>
      chunked(
        'busyKeys',
        QueryOp.ArrayContainsAny,
        keys,
        VISITS_PER_BARBER_DAY,
      ),

    loadFollowUpsOf: (appointmentIds) =>
      chunked(
        'bookedFromAppointmentId',
        QueryOp.In,
        appointmentIds,
        FOLLOW_UPS_PER_VISIT,
      ),

    loadFollowUpsBookedIn: (fromUtcMs, toUtcMs) =>
      bounded<Appointment>(
        Collections.Appointments,
        () =>
          db
            .collection(Collections.Appointments)
            .where('bookedAtUtcMs', QueryOp.Gte, fromUtcMs)
            .where('bookedAtUtcMs', QueryOp.Lt, toUtcMs),
        BOOKED_IN_RANGE,
      ),

    // At most one departure a barber-day (its id is the day's busy key), so
    // the range's own length is its cap.
    loadDeparturesForBarber: (barberId, fromLocalDate, toLocalDate) =>
      bounded<ScheduleException>(
        Collections.ScheduleExceptions,
        () =>
          db
            .collection(Collections.ScheduleExceptions)
            .where('barberId', QueryOp.Eq, barberId)
            .where('localDate', QueryOp.Gte, fromLocalDate)
            .where('localDate', QueryOp.Lte, toLocalDate),
        Math.max(1, LocalDate.daysBetween(fromLocalDate, toLocalDate) + 1),
      ),

    listBarberRecordIds: async () => {
      try {
        // unbounded-ok: one document per barber record, a tenant's staff (the ceiling is 10)
        const snap = await db.collection(Collections.Barbers).select().get();
        return Result.ok(snap.docs.map((doc) => BarberId.of(doc.id)));
      } catch (error) {
        return Result.err(readFailed(Collections.Barbers, error));
      }
    },

    listLocations: async () => {
      try {
        // unbounded-ok: the tenant's shops (the ceiling is 3), written by hand
        const snap = await db.collection(Collections.Locations).get();
        return Result.ok(
          snap.docs.map(
            (doc) => ({ id: doc.id, ...doc.data() }) as ShopLocation,
          ),
        );
      } catch (error) {
        return Result.err(readFailed(Collections.Locations, error));
      }
    },
  };
};
