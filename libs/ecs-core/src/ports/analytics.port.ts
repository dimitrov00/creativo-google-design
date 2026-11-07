import type {
  AppointmentId,
  BarberId,
  BusyKey,
  LocalDate,
  Result,
  UtcEpochMs,
} from '@core/primitives';
import type { RepositoryError } from '@core/errors';
import type {
  Appointment,
  ScheduleException,
  ShopLocation,
} from '@core/entities';

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

// ── Focused bundles (Law 9 — composed with `&`, never sliced) ─────────────

/** The analytics reads — `firestoreAnalyticsPorts(db, guardOf, log)` (functions). */
export type AnalyticsReadPorts = {
  readonly loadVisitsByBusyKeys: LoadVisitsByBusyKeys;
  readonly loadFollowUpsOf: LoadFollowUpsOf;
  readonly loadFollowUpsBookedIn: LoadFollowUpsBookedIn;
  readonly loadDeparturesForBarber: LoadDeparturesForBarber;
  readonly listBarberRecordIds: ListBarberRecordIds;
  readonly listLocations: ListLocations;
};
