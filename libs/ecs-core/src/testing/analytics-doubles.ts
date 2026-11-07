import {
  type AppointmentId,
  type BarberId,
  type BusyKey,
  Result,
  type UserId,
} from '@core/primitives';
import type {
  Appointment,
  BarberSchedule,
  ScheduleException,
  ShopLocation,
  User,
} from '@core/entities';
import type {
  AnalyticsReadPorts,
  ProfileLoadPorts,
  ShopDayReadPorts,
} from '@core/ports';
import { BackfillPlanSystem } from '@core/systems';

/** Firestore's most values an `in` / `array-contains-any` query takes — the adapter's chunk. */
const IN_CHUNK = 30;

/** What `memoryAnalyticsReadPorts` reads; every collection empty when omitted. */
export type AnalyticsReadState = {
  readonly visits?: readonly Appointment[];
  readonly departures?: readonly ScheduleException[];
  readonly barberIds?: readonly BarberId[];
  readonly locations?: readonly ShopLocation[];
};

/** The queries the double ran, in call order — one entry per Firestore query the adapter would send. */
export type AnalyticsReadLog = {
  /** Each `array-contains-any` chunk's keys. */
  readonly visitQueries: (readonly BusyKey[])[];
  /** Each `bookedFromAppointmentId in` chunk's ids. */
  readonly followUpQueries: (readonly AppointmentId[])[];
  /** Each `bookedAtUtcMs` range, `[from, to)`. */
  readonly bookedInQueries: (readonly [number, number])[];
  /** Each departure range, `[barberId, from, to]`. */
  readonly departureQueries: (readonly [BarberId, string, string])[];
};

/**
 * `AnalyticsReadPorts` over plain arrays, answering as the Firestore adapter
 * does: the key and id lists split into queries of 30 (`IN_CHUNK`), each
 * query's matches answered in order and CONCATENATED — so a party holding
 * keys of two chunks comes back twice, exactly as the store answers it, and
 * the caller must count it once. The ranges are inclusive dates and a
 * half-open instant range. `log` records every query.
 */
export function memoryAnalyticsReadPorts(state: AnalyticsReadState = {}): {
  readonly ports: AnalyticsReadPorts;
  readonly log: AnalyticsReadLog;
} {
  const visits = state.visits ?? [];
  const log: AnalyticsReadLog = {
    visitQueries: [],
    followUpQueries: [],
    bookedInQueries: [],
    departureQueries: [],
  };
  const ports: AnalyticsReadPorts = {
    loadVisitsByBusyKeys: async (keys) => {
      const rows: Appointment[] = [];
      for (const chunk of BackfillPlanSystem.chunk(keys, IN_CHUNK)) {
        log.visitQueries.push(chunk);
        for (const visit of visits) {
          if (visit.busyKeys.some((key) => chunk.includes(key))) {
            rows.push(visit);
          }
        }
      }
      return Result.ok(rows);
    },
    loadFollowUpsOf: async (appointmentIds) => {
      const rows: Appointment[] = [];
      for (const chunk of BackfillPlanSystem.chunk(appointmentIds, IN_CHUNK)) {
        log.followUpQueries.push(chunk);
        for (const visit of visits) {
          if (
            visit.bookedFromAppointmentId !== null &&
            chunk.includes(visit.bookedFromAppointmentId)
          ) {
            rows.push(visit);
          }
        }
      }
      return Result.ok(rows);
    },
    loadFollowUpsBookedIn: async (fromUtcMs, toUtcMs) => {
      log.bookedInQueries.push([fromUtcMs, toUtcMs]);
      return Result.ok(
        visits.filter(
          (visit) =>
            visit.bookedAtUtcMs !== null &&
            visit.bookedAtUtcMs >= fromUtcMs &&
            visit.bookedAtUtcMs < toUtcMs,
        ),
      );
    },
    loadDeparturesForBarber: async (barberId, fromLocalDate, toLocalDate) => {
      log.departureQueries.push([barberId, fromLocalDate, toLocalDate]);
      return Result.ok(
        (state.departures ?? []).filter(
          (departure) =>
            departure.barberId === barberId &&
            departure.localDate >= fromLocalDate &&
            departure.localDate <= toLocalDate,
        ),
      );
    },
    listBarberRecordIds: async () => Result.ok(state.barberIds ?? []),
    listLocations: async () => Result.ok(state.locations ?? []),
  };
  return { ports, log };
}

/** `ProfileLoadPorts` — `users/{uid}` as stored, `null` when absent. */
export function memoryProfileLoadPorts(
  users: readonly User[],
): ProfileLoadPorts {
  return {
    loadProfile: async (userId: UserId) =>
      Result.ok(users.find((user) => user.id === userId) ?? null),
  };
}

/** `ShopDayReadPorts` over the rosters given — no busy day, no single-day exception. */
export function memoryShopDayReadPorts(
  schedules: readonly BarberSchedule[],
): ShopDayReadPorts {
  return {
    loadSchedule: async (barberId) =>
      Result.ok(schedules.find((schedule) => schedule.id === barberId) ?? null),
    loadBusyDay: async () => Result.ok(null),
    loadScheduleException: async () => Result.ok(null),
  };
}
