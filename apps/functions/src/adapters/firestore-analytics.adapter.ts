import type { Firestore, Query } from 'firebase-admin/firestore';
import { BarberId, type BusyKey, LocalDate, Result } from '@core/primitives';
import { RepositoryError } from '@core/errors';
import { AnalyticsGoal, DayFigures } from '@core/components';
import {
  type Appointment,
  type BarberAnalyticsDay,
  Collections,
  QueryOp,
  type ScheduleException,
  type ShopLocation,
  type StoredAnalyticsGoal,
} from '@core/entities';
import type {
  AnalyticsDayReadPorts,
  AnalyticsGoalPorts,
  AnalyticsReadPorts,
  Log,
} from '@core/ports';
import {
  AnalyticsRecomputeJobSystem,
  BackfillPlanSystem,
  StaffAnalyticsSystem,
  type StoredGuardOf,
} from '@core/systems';
import { admitStored, logRefusal } from './firestore-tx.adapter';
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
 * The most visits one barber-day holds and the most follow-ups booked from
 * one visit — the system's caps (`StaffAnalyticsSystem`), the same ones the
 * day writer's transaction queries read at (staff analytics v2, «Stamp
 * ordering»).
 */
const { VISITS_PER_BARBER_DAY, FOLLOW_UPS_PER_VISIT } = StaffAnalyticsSystem;

/** The most stored days one barber has in the reach — a leap year's days. */
const DAYS_PER_BARBER = 366;

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

/**
 * The stored days' reads over the Admin SDK (`AnalyticsDayReadPorts`, staff
 * analytics v2, «Ports»), outside any transaction:
 *
 * - `loadAnalyticsDays` — one barber: `analyticsDays where barberId == …
 *   and localDate >= … and localDate <= …` over the `(barberId, localDate)`
 *   composite; the shop (several barbers): one `localDate` range over the
 *   collection, the rows of the barbers asked for kept. Bounded at
 *   366 × the barbers + 1: past it the read is refused (`overBound`,
 *   `resource-exhausted`), never truncated. A malformed body
 *   (`DayFigures.is`) is dropped and logged — the caller computes that day
 *   live.
 * - `loadAnalyticsDaysByKeys` — the Admin SDK's `getAll` over at most
 *   `PAGE_SIZE` (100) references a round trip, one answer per key in
 *   order: the day, or `null` where no document exists or the body is
 *   malformed (logged).
 *
 * The writes go through the commit plan (`firestoreCommitPlan`), which
 * stamps the TTL `purgeAt` beside the body.
 */
export const firestoreAnalyticsDayPorts = (
  db: Firestore,
  log: Log,
): AnalyticsDayReadPorts => {
  /** The entity, or `null` for a body that is no day's figures — logged. */
  const admitted = (id: string, data: unknown): BarberAnalyticsDay | null => {
    if (DayFigures.is(data)) {
      return { id, ...data } as BarberAnalyticsDay;
    }
    logRefusal(
      log,
      RepositoryError.malformed(
        `${Collections.AnalyticsDays}/${id}`,
        'dayFigures',
      ),
    );
    return null;
  };

  return {
    loadAnalyticsDays: async (barberIds, fromLocalDate, toLocalDate) => {
      if (barberIds.length === 0) return Result.ok([]);
      const cap = DAYS_PER_BARBER * barberIds.length;
      let page;
      try {
        let query: Query = db
          .collection(Collections.AnalyticsDays)
          .where('localDate', QueryOp.Gte, fromLocalDate)
          .where('localDate', QueryOp.Lte, toLocalDate);
        if (barberIds.length === 1) {
          query = query.where('barberId', QueryOp.Eq, barberIds[0]);
        }
        page = await query.limit(cap + 1).get();
      } catch (error) {
        return Result.err(readFailed(Collections.AnalyticsDays, error));
      }
      if (page.docs.length > cap) {
        return Result.err(overBound(Collections.AnalyticsDays));
      }
      const rows: BarberAnalyticsDay[] = [];
      for (const snap of page.docs) {
        const day = admitted(snap.id, snap.data());
        if (day !== null && barberIds.includes(day.barberId)) rows.push(day);
      }
      return Result.ok(rows);
    },

    loadAnalyticsDaysByKeys: async (keys) => {
      const rows: (BarberAnalyticsDay | null)[] = [];
      for (const chunk of BackfillPlanSystem.chunk(
        keys,
        AnalyticsRecomputeJobSystem.PAGE_SIZE,
      )) {
        let snaps;
        try {
          snaps = await db.getAll(
            ...chunk.map((key: BusyKey) =>
              db.collection(Collections.AnalyticsDays).doc(key),
            ),
          );
        } catch (error) {
          return Result.err(readFailed(Collections.AnalyticsDays, error));
        }
        for (const snap of snaps) {
          rows.push(snap.exists ? admitted(snap.id, snap.data()) : null);
        }
      }
      return Result.ok(rows);
    },
  };
};

/**
 * The month goal's read over the Admin SDK (`AnalyticsGoalPorts`, staff
 * analytics v2 PR 6, «Goals»), outside any transaction: ONE
 * `analyticsGoals/{key}` get — the body admitted by `AnalyticsGoal.is`
 * first; a malformed one is `null` and logged (`REPOSITORY_MALFORMED`), so
 * the report shows no goal rather than a wrong one. The write is
 * `setAnalyticsGoal`'s commit plan (`firestoreCommitPlan`).
 */
export const firestoreAnalyticsGoalPorts = (
  db: Firestore,
  log: Log,
): AnalyticsGoalPorts => ({
  loadAnalyticsGoal: async (key) => {
    const path = `${Collections.AnalyticsGoals}/${key}`;
    let snap;
    try {
      snap = await db.collection(Collections.AnalyticsGoals).doc(key).get();
    } catch (error) {
      return Result.err(readFailed(path, error));
    }
    if (!snap.exists) return Result.ok(null);
    const data = snap.data();
    if (AnalyticsGoal.is(data)) {
      const goal: StoredAnalyticsGoal = { id: key, ...data };
      return Result.ok(goal);
    }
    logRefusal(log, RepositoryError.malformed(path, 'analyticsGoal'));
    return Result.ok(null);
  },
});
