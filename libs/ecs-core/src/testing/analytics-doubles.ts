import {
  AnalyticsGoalKey,
  type AppointmentId,
  type BarberId,
  BusyKey,
  Result,
  type UserId,
  type UtcEpochMs,
} from '@core/primitives';
import {
  PipelineError,
  PipelineErrorCode,
  RepositoryError,
} from '@core/errors';
import type {
  AnalyticsReport,
  SetAnalyticsGoalCall,
  AnalyticsCall,
} from '@core/components';
import {
  type AnalyticsRecomputeJob,
  type Appointment,
  type BarberAnalyticsDay,
  type BarberSchedule,
  type ClientStatsRecord,
  Collections,
  type ScheduleException,
  type ShopLocation,
  type StoredAnalyticsGoal,
  type User,
} from '@core/entities';
import type {
  AnalyticsCallPorts,
  AnalyticsDayReadPorts,
  AnalyticsGoalPorts,
  AnalyticsReadPorts,
  AnalyticsRecomputeJobPorts,
  ProfileLoadPorts,
  ShopDayReadPorts,
} from '@core/ports';
import { AnalyticsRecomputeJobSystem, BackfillPlanSystem } from '@core/systems';

/** Firestore's most values an `in` / `array-contains-any` query takes — the adapter's chunk. */
const IN_CHUNK = 30;

/** The most stored days one barber has in the reach — the adapter's range bound (`firestore-analytics.adapter.ts`). */
const DAYS_PER_BARBER = 366;

/** Firestore's canonical name for gRPC 8 — what the adapter answers a read past its bound with (`overBound`). */
const RESOURCE_EXHAUSTED = 'resource-exhausted';

/** What `memoryAnalyticsDayPorts` holds; no day and no job when omitted. */
export type AnalyticsDayState = {
  readonly days?: readonly BarberAnalyticsDay[];
  readonly job?: AnalyticsRecomputeJob | null;
};

/** The queries the day double ran, in call order — one entry per Firestore read the adapter would send. */
export type AnalyticsDayReadLog = {
  /** Each range read: `[barberIds, from, to]`. */
  readonly rangeQueries: (readonly [readonly BarberId[], string, string])[];
  /** Each `getAll` page's keys. */
  readonly keyReads: (readonly BusyKey[])[];
  /** How many times the job document was read. */
  jobReads: number;
};

/**
 * `AnalyticsDayReadPorts & AnalyticsRecomputeJobPorts` over plain arrays,
 * answering as the Firestore adapters do: the range by `barberId` and an
 * inclusive `localDate` range — bounded at 366 × the barbers asked for,
 * past it REFUSED (`resource-exhausted`), never truncated — the keys one
 * page (≤ `PAGE_SIZE`) at a time with `null` where no day is stored, the
 * job as held. `log` records every read.
 */
export function memoryAnalyticsDayPorts(state: AnalyticsDayState = {}): {
  readonly ports: AnalyticsDayReadPorts & AnalyticsRecomputeJobPorts;
  readonly log: AnalyticsDayReadLog;
} {
  const days = state.days ?? [];
  const log: AnalyticsDayReadLog = {
    rangeQueries: [],
    keyReads: [],
    jobReads: 0,
  };
  const ports: AnalyticsDayReadPorts & AnalyticsRecomputeJobPorts = {
    loadAnalyticsDays: async (barberIds, fromLocalDate, toLocalDate) => {
      log.rangeQueries.push([barberIds, fromLocalDate, toLocalDate]);
      const rows = days.filter(
        (day) =>
          barberIds.includes(day.barberId) &&
          day.localDate >= fromLocalDate &&
          day.localDate <= toLocalDate,
      );
      return rows.length > DAYS_PER_BARBER * barberIds.length
        ? Result.err(
            RepositoryError.readFailed(
              Collections.AnalyticsDays,
              RESOURCE_EXHAUSTED,
            ),
          )
        : Result.ok(rows);
    },
    loadAnalyticsDaysByKeys: async (keys) => {
      const rows: (BarberAnalyticsDay | null)[] = [];
      for (const page of BackfillPlanSystem.chunk(
        keys,
        AnalyticsRecomputeJobSystem.PAGE_SIZE,
      )) {
        log.keyReads.push(page);
        for (const key of page) {
          rows.push(
            days.find(
              (day) => BusyKey.of(day.barberId, day.localDate) === key,
            ) ?? null,
          );
        }
      }
      return Result.ok(rows);
    },
    loadAnalyticsRecomputeJob: async () => {
      log.jobReads++;
      return Result.ok(state.job ?? null);
    },
  };
  return { ports, log };
}

/** What `memoryAnalyticsReadPorts` reads; every collection empty when omitted. */
export type AnalyticsReadState = {
  readonly visits?: readonly Appointment[];
  readonly departures?: readonly ScheduleException[];
  readonly barberIds?: readonly BarberId[];
  readonly locations?: readonly ShopLocation[];
  /** The client-stats projections (`clientStats`), read by first visit. */
  readonly clientStats?: readonly ClientStatsRecord[];
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
    loadClientsFirstSeenIn: async (fromLocalDate, toLocalDate) =>
      Result.ok(
        (state.clientStats ?? []).filter(
          (record) =>
            record.firstVisitLocalDate !== null &&
            record.firstVisitLocalDate >= fromLocalDate &&
            record.firstVisitLocalDate <= toLocalDate,
        ),
      ),
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

/**
 * `AnalyticsGoalPorts` over a plain list (staff analytics v2 PR 6): the goal
 * whose `id` is the key asked for, `null` when none is held. `log` records
 * every key read — one entry per `analyticsGoals/{key}` get the adapter
 * would send, so a spec proves a `MONTH` reads the goal once and no other
 * span reads it at all.
 */
export function memoryAnalyticsGoalPorts(
  goals: readonly StoredAnalyticsGoal[],
): {
  readonly ports: AnalyticsGoalPorts;
  readonly log: { readonly keyReads: AnalyticsGoalKey[] };
} {
  const log = { keyReads: [] as AnalyticsGoalKey[] };
  const ports: AnalyticsGoalPorts = {
    loadAnalyticsGoal: async (key) => {
      log.keyReads.push(key);
      return Result.ok(goals.find((goal) => goal.id === key) ?? null);
    },
  };
  return { ports, log };
}

/** What `scriptedAnalyticsCallPorts` answers; a callable left unscripted answers `PIPELINE_UNKNOWN`. */
export type AnalyticsCallScript = {
  readonly report?: (
    call: AnalyticsCall,
  ) => Result<AnalyticsReport, PipelineError>;
  readonly goal?: (
    call: SetAnalyticsGoalCall,
  ) => Result<SetAnalyticsGoalCall.Set, PipelineError>;
};

/** Every call the scripted bundle took, in order. */
export type AnalyticsCallLog = {
  readonly reports: AnalyticsCall[];
  readonly goals: SetAnalyticsGoalCall[];
};

/**
 * The web's `AnalyticsCallPorts` as a scripted double (PR 6): `requestReport`
 * and `setAnalyticsGoal` answer what the script says — a decoded report, a
 * decoded `{ goalKey, goalSetAtUtcMs }`, or a refusal — and `log` records
 * every call as sent, so a store spec asserts the exact `SetAnalyticsGoalCall`
 * the sheet dialled without a gateway. An unscripted callable answers the
 * classification an unreachable one would (`PIPELINE_UNKNOWN`).
 */
export function scriptedAnalyticsCallPorts(script: AnalyticsCallScript = {}): {
  readonly ports: AnalyticsCallPorts;
  readonly log: AnalyticsCallLog;
} {
  const log: AnalyticsCallLog = { reports: [], goals: [] };
  const unknown = <T>(): Result<T, PipelineError> =>
    Result.err(PipelineError.bare(PipelineErrorCode.Unknown));
  const ports: AnalyticsCallPorts = {
    requestReport: async (call) => {
      log.reports.push(call);
      return script.report === undefined ? unknown() : script.report(call);
    },
    setAnalyticsGoal: async (call) => {
      log.goals.push(call);
      return script.goal === undefined ? unknown() : script.goal(call);
    },
  };
  return { ports, log };
}

/** A `setAnalyticsGoal` answer as the callable gives it for `call` — the key of its scope and month, stamped `at`. */
export function goalSetAnswerOf(
  call: SetAnalyticsGoalCall,
  at: UtcEpochMs,
): SetAnalyticsGoalCall.Set {
  return {
    goalKey: AnalyticsGoalKey.of(call.scopeBarberId, call.goalMonth),
    goalSetAtUtcMs: at,
  };
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
