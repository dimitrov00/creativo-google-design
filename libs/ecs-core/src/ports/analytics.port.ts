import type {
  AnalyticsGoalKey,
  AppointmentId,
  BarberId,
  BusyKey,
  LocalDate,
  Result,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import type { RepositoryError } from '@core/errors';
import type {
  AnalyticsCall,
  AnalyticsReport,
  SetAnalyticsGoalCall,
} from '@core/components';
import type {
  AnalyticsRecomputeJob,
  Appointment,
  BarberAnalyticsDay,
  ClientStatsRecord,
  StoredAnalyticsGoal,
  ScheduleException,
  ShopLocation,
} from '@core/entities';
import type { Callable } from './scheduling.port';

/**
 * STAFF ANALYTICS' READS (`docs/designs/staff-analytics.md`, Reads and cost)
 * — the server's `staffAnalytics` pipeline reads these outside any
 * transaction; nothing is written. Every answer is the stored body as it is
 * (`{ id, ...data }`, Law 5), an `appointments` row admitted by the
 * stored-document guard first. A read that would answer more than its bound
 * is REFUSED (`RepositoryError`, `resource-exhausted`), never truncated: a
 * shorter list would be a report that silently lies.
 *
 * The other reads the pipeline takes are the existing bundles: the caller
 * (`ProfileLoadPorts`, `accounts.port.ts`), the rosters (`ShopDayReadPorts`'
 * `loadSchedule`), the policy (`PolicyReadPorts`), the clock and the log.
 */

/**
 * The visits holding any of `keys` — `appointments where busyKeys
 * array-contains-any`, Firestore's 30 values a query, so the adapter splits
 * a longer list and answers every query's rows in order. A party split
 * across two barbers holds two keys, so it can come back once per query
 * that names one of them: the CALLER counts each appointment once
 * (`StaffAnalyticsSystem.mergeVisits`). Cancelled visits keep their keys, so
 * late cancellations are found.
 */
export type LoadVisitsByBusyKeys = (
  keys: readonly BusyKey[],
) => Promise<Result<readonly Appointment[], RepositoryError>>;

/**
 * The visits booked FROM any of `appointmentIds` — `appointments where
 * bookedFromAppointmentId in`, 30 values a query (split by the adapter): one
 * barber's follow-ups, read by the visits they follow.
 */
export type LoadFollowUpsOf = (
  appointmentIds: readonly AppointmentId[],
) => Promise<Result<readonly Appointment[], RepositoryError>>;

/**
 * Every visit booked in `[fromUtcMs, toUtcMs)` — ONE `bookedAtUtcMs` range
 * over its default single-field index: the shop's follow-ups are the rows
 * among them with a `bookedFromAppointmentId`, which the caller keeps
 * (`StaffAnalyticsSystem.followUpOf`); the store cannot filter a second
 * field without a composite index.
 */
export type LoadFollowUpsBookedIn = (
  fromUtcMs: UtcEpochMs,
  toUtcMs: UtcEpochMs,
) => Promise<Result<readonly Appointment[], RepositoryError>>;

/**
 * One barber's departures from the roster over `[fromLocalDate,
 * toLocalDate]`, both included — `scheduleExceptions where barberId ==
 * … and localDate >= … and localDate <= …` (the existing `(barberId,
 * localDate)` index). At most one a day: the id is the day's `BusyKey`.
 */
export type LoadDeparturesForBarber = (
  barberId: BarberId,
  fromLocalDate: LocalDate,
  toLocalDate: LocalDate,
) => Promise<Result<readonly ScheduleException[], RepositoryError>>;

/**
 * The id of every barber record, whatever its `barberStatus` — `barbers`,
 * bodies not read: a retired barber's history stays reportable, and an
 * admin's scope names any record.
 */
export type ListBarberRecordIds = () => Promise<
  Result<readonly BarberId[], RepositoryError>
>;

/**
 * Every shop, whatever its `locationStatus` — the active ones bound
 * rostered time (as the schedule does), every one names a time zone.
 */
export type ListLocations = () => Promise<
  Result<readonly ShopLocation[], RepositoryError>
>;

/**
 * The stored past barber-days of `barberIds` over `[fromLocalDate,
 * toLocalDate]`, both included (staff analytics v2, «Ports»): for one
 * barber `analyticsDays where barberId == … and localDate >= … and localDate
 * <= …` over the `(barberId, localDate)` composite; for the shop one
 * `localDate` range over the collection. Each body admitted by
 * `DayFigures.is` first (a malformed one is dropped and logged). Bounded at
 * 366 × `barberIds.length` + 1: past it the adapter answers
 * `RepositoryError` `resource-exhausted` — a refused report, never a
 * truncated one. A day with no document is simply absent; the caller
 * computes it live.
 */
export type LoadAnalyticsDays = (
  barberIds: readonly BarberId[],
  fromLocalDate: LocalDate,
  toLocalDate: LocalDate,
) => Promise<Result<readonly BarberAnalyticsDay[], RepositoryError>>;

/**
 * The stored days of `keys`, by id — the Admin SDK's `getAll` over at most
 * `AnalyticsRecomputeJobSystem.PAGE_SIZE` (100) references, one answer per
 * key IN ORDER: the day, or `null` where no document exists (what the
 * recompute's eligibility reads). A malformed body is `null` too, and
 * logged.
 */
export type LoadAnalyticsDaysByKeys = (
  keys: readonly BusyKey[],
) => Promise<Result<readonly (BarberAnalyticsDay | null)[], RepositoryError>>;

/** `backfillJobs/analyticsRecompute` as stored, `null` when there is none — the write goes through `CommitPorts`. */
export type LoadAnalyticsRecomputeJob = () => Promise<
  Result<AnalyticsRecomputeJob | null, RepositoryError>
>;

/**
 * `analyticsGoals/{key}` as stored (`{ id, ...data }`), `null` when there is
 * none — the one extra read a `MONTH` report takes (staff analytics v2 PR 6,
 * «Goals»); the body admitted by `AnalyticsGoal.is` first — a malformed one
 * is `null`, and logged. The write goes through `CommitPorts`
 * (`setAnalyticsGoal`'s transaction).
 */
export type LoadAnalyticsGoal = (
  key: AnalyticsGoalKey,
) => Promise<Result<StoredAnalyticsGoal | null, RepositoryError>>;

// ── Focused bundles (Law 9 — composed with `&`, never sliced) ─────────────

/** The analytics reads — `firestoreAnalyticsPorts(db, guardOf, log)` (functions). */
/**
 * The clients whose FIRST worked visit at the shop fell in `[fromLocalDate,
 * toLocalDate]` — `clientStats where firstVisitLocalDate >= … and <= …`,
 * one range on the projection (its single-field index): the period's new
 * clients, whom and where they first came to on each record.
 */
export type LoadClientsFirstSeenIn = (
  fromLocalDate: LocalDate,
  toLocalDate: LocalDate,
) => Promise<Result<readonly ClientStatsRecord[], RepositoryError>>;

export type AnalyticsReadPorts = {
  readonly loadVisitsByBusyKeys: LoadVisitsByBusyKeys;
  readonly loadClientsFirstSeenIn: LoadClientsFirstSeenIn;
  readonly loadFollowUpsOf: LoadFollowUpsOf;
  readonly loadFollowUpsBookedIn: LoadFollowUpsBookedIn;
  readonly loadDeparturesForBarber: LoadDeparturesForBarber;
  readonly listBarberRecordIds: ListBarberRecordIds;
  readonly listLocations: ListLocations;
};

/** The stored days' reads — `firestoreAnalyticsDayPorts(db, log)` (functions); the writes are `CommitPorts`'. */
export type AnalyticsDayReadPorts = {
  readonly loadAnalyticsDays: LoadAnalyticsDays;
  readonly loadAnalyticsDaysByKeys: LoadAnalyticsDaysByKeys;
};

/** The recompute's job document — `firestoreJobsPorts(db)` (functions), beside the policy job's bundle. */
export type AnalyticsRecomputeJobPorts = {
  readonly loadAnalyticsRecomputeJob: LoadAnalyticsRecomputeJob;
};

/** The month goal's read — `firestoreAnalyticsGoalPorts(db, log)` (functions); the write is `CommitPorts`'. */
export type AnalyticsGoalPorts = {
  readonly loadAnalyticsGoal: LoadAnalyticsGoal;
};

// ── The web's side (the «Анализи» screen) ─────────────────────────────────

/**
 * One report asked of the `staffAnalytics` callable — the scope and the
 * period as `AnalyticsCall` names them (`scopeBarberId: null` is the shop
 * for an admin, the caller's own record for a barber); the answer the
 * report, every figure decided, or the callable's one `PipelineError`
 * (a refusal's `serverErrorCode` is an `AnalyticsErrorCode`).
 */
export type RequestAnalyticsReport = Callable<AnalyticsCall, AnalyticsReport>;

/**
 * One goal set through the `setAnalyticsGoal` callable (PR 6) — the scope,
 * the month and the range as `SetAnalyticsGoalCall` names them (the sheet
 * asks `AnalyticsGoal.rangeOf` before dialling, and
 * `StaffAnalyticsSystem.goalMonthOffered` says which months it may offer);
 * the answer the stored key and the set's stamp, or the callable's one
 * `PipelineError` (a refusal's `serverErrorCode` is an `AnalyticsErrorCode`
 * — `ANALYTICS_GOAL_FORBIDDEN`, `ANALYTICS_GOAL_INVALID_RANGE`, or v1's).
 */
export type SetAnalyticsGoal = Callable<
  SetAnalyticsGoalCall,
  SetAnalyticsGoalCall.Set
>;

/**
 * Which cached report — the account it was computed for and the request
 * it answered. The adapter spells the storage key from it
 * (`creativo.analytics/<definitionVersion>/<uid>/<scope>/<period>`); the
 * catalogue's version is the adapter's own constant, so a report of an
 * older definition is never read back.
 */
export type AnalyticsCacheKey = AnalyticsCall & {
  readonly userId: UserId;
};

/**
 * The report cached for `key` — figures and day rows only (its
 * `reportSeatRows` always empty: seat rows are never stored); `null` when
 * there is none. A stored value that is no report of this definition is
 * deleted and answers `REPOSITORY_MALFORMED`; a storage that cannot be read
 * answers `REPOSITORY_READ_FAILED` — the screen reads both as "no cache".
 * Synchronous, like the storage under it, so the screen paints it in the
 * tap's first frame.
 */
export type ReadCachedReport = (
  key: AnalyticsCacheKey,
) => Result<AnalyticsReport | null, RepositoryError>;

/**
 * Keeps `report` for `key`, its seat rows dropped — at most a handful of
 * entries, the least recently written dropped first. A full or disabled
 * storage answers a `RepositoryError` the screen ignores.
 */
export type WriteCachedReport = (
  key: AnalyticsCacheKey,
  report: AnalyticsReport,
) => Result<void, RepositoryError>;

/** Deletes every cached report on this device — sign-out, an account switch, a refusal. */
export type ClearCachedReports = () => Result<void, RepositoryError>;

/** The analytics callables — `ANALYTICS_CALL_PORTS` (web), `analyticsCallPorts(gateway)`: the report, and the goal (PR 6). */
export type AnalyticsCallPorts = {
  readonly requestReport: RequestAnalyticsReport;
  readonly setAnalyticsGoal: SetAnalyticsGoal;
};

/** The device's report cache — `ANALYTICS_CACHE_PORTS` (web), `localStorageAnalyticsCachePorts()`. */
export type AnalyticsCachePorts = {
  readonly readCachedReport: ReadCachedReport;
  readonly writeCachedReport: WriteCachedReport;
  readonly clearCachedReports: ClearCachedReports;
};
