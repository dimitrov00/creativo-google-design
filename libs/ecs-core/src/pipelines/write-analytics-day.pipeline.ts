import {
  type AppointmentId,
  BusyKey,
  type LocationId,
  LogEvent,
  Result,
  type TimeZone,
  UtcEpochMs,
} from '@core/primitives';
import { CatalogErrorCode, RepositoryError } from '@core/errors';
import { ClientStatsPolicy, type DayFigures, WriteOp } from '@core/components';
import {
  type Appointment,
  type BarberAnalyticsDay,
  type BarberSchedule,
  Collections,
  QueryOp,
  type ScheduleException,
  type ShopLocation,
} from '@core/entities';
import type {
  AnalyticsReadPorts,
  AppointmentLoadPorts,
  ClockPorts,
  CommitPorts,
  DefaultLocationPorts,
  LogPorts,
  PolicyReadPorts,
  QuerySpec,
  ReadTx,
  ShopDayReadPorts,
} from '@core/ports';
import {
  type AnalyticsDay,
  type AnalyticsDaysInput,
  type AnalyticsFollowUp,
  type AttemptFailure,
  BackfillPlanSystem,
  BusySystem,
  type ShopNowAt,
  StaffAnalyticsSystem,
  TriggerAttemptSystem,
  ZonedTimeSystem,
} from '@core/systems';
import type { RebuildBusyCommand } from './rebuild-busy.pipeline';

/**
 * `writeAnalyticsDay` — keep `analyticsDays/{busyKey}` equal to what the
 * appointments, the roster and the departures say of one PAST barber-day
 * (`docs/designs/staff-analytics-v2.md`, «Shape», «Stamp ordering»). Fed
 * by the appointment trigger (the same decoded sides the busy rebuild
 * takes), the departure trigger (its one key) and the recompute (the
 * eligible keys of a page); the callable never writes.
 *
 * **Which days.** An `'APPOINTMENT'` command derives its keys from both
 * sides with `BusySystem.affectedKeys`, as the busy pipeline does — the
 * refusal of a malformed side is the answer only when no day is left — and,
 * when the written visit is a FOLLOW-UP (`bookedFromAppointmentId` on
 * either side), adds the source visit's busy keys: its day's rebooking
 * figures changed. A `'DEPARTURE'` or `'RECOMPUTE'` command names its keys.
 * A day that is not past (`StaffAnalyticsSystem.isPastDay`, judged on every
 * stretch shop's clock) is SKIPPED, never written: the report computes live
 * days from their visits.
 *
 * **Stamp ordering (Law 7 T2).** `sourceReadUtcMs = ports.nowUtcMs()` is
 * taken before the first read of a day. Outside the transaction, through
 * the named bundles: the roster, the departure, the day's visits (their
 * ids); the policy and the shops once per command. Inside ONE `commit` per
 * day: the visits of the day (`busyKeys array-contains`, no status filter
 * so cancelled visits are counted, `limit VISITS_PER_BARBER_DAY + 1` — one
 * row over the cap is a refused read), the follow-ups of those ids in
 * chunks of 30, the existing document, the source visit when the command
 * names one and the departure. The decide step folds
 * (`StaffAnalyticsSystem.storedDayOf`: the day, the locations it touched
 * and each one's share of a split day) and writes one `Set` ONLY when the stored
 * `dayComputedAtUtcMs` is earlier than `sourceReadUtcMs`: two writers racing
 * leave the later computation, and an older read never overwrites a newer
 * document. The adapter stamps the TTL `purgeAt` beside the body.
 *
 * **Idempotent, so retried.** A day's body is a deterministic function of
 * what it reads (the stamp aside), so a redelivery rewrites the same
 * figures. One failed day never costs the others theirs: each failure is
 * logged (`AnalyticsDayWriteFailed` — the key and the code) and collected,
 * and the attempt's verdict over them is `TriggerAttemptSystem
 * .decisiveFailure` (transient when any one is).
 */

/** Which event asked for the write — the ONLY source of these strings; the field is `analyticsDaySource`. */
export const AnalyticsDaySource = {
  Appointment: 'APPOINTMENT',
  Departure: 'DEPARTURE',
  Recompute: 'RECOMPUTE',
} as const;
export type AnalyticsDaySource =
  (typeof AnalyticsDaySource)[keyof typeof AnalyticsDaySource];

/** An appointment write — the busy rebuild's sides; the keys are derived here. */
export type AppointmentDayCommand = RebuildBusyCommand & {
  readonly analyticsDaySource: typeof AnalyticsDaySource.Appointment;
};

/** A departure write — the one day it names. */
export type DepartureDayCommand = {
  readonly analyticsDaySource: typeof AnalyticsDaySource.Departure;
  readonly keys: readonly BusyKey[];
};

/** A recompute step — the eligible keys of its page. */
export type RecomputeDayCommand = {
  readonly analyticsDaySource: typeof AnalyticsDaySource.Recompute;
  readonly keys: readonly BusyKey[];
};

export type WriteAnalyticsDayCommand =
  AppointmentDayCommand | DepartureDayCommand | RecomputeDayCommand;

/** What became of each key, in key order, and the attempt's verdict. */
export type WriteAnalyticsDayAnswer = {
  /** Days written. */
  readonly writtenKeys: readonly BusyKey[];
  /** Days not yet past — left to the live report. */
  readonly skippedKeys: readonly BusyKey[];
  /** Days a NEWER computation had already written — stamp ordering kept it. */
  readonly keptKeys: readonly BusyKey[];
  /** Days that failed, beside their failures. */
  readonly failedKeys: readonly BusyKey[];
  /** Every day's failure, in key order — a refusal or a rejection. */
  readonly failures: readonly unknown[];
  /** The attempt's verdict over them (`TriggerAttemptSystem.decisiveFailure`); `null` when none. */
  readonly attemptFailure: AttemptFailure | null;
};

export type WriteAnalyticsDayPorts = CommitPorts &
  ShopDayReadPorts &
  AppointmentLoadPorts &
  AnalyticsReadPorts &
  PolicyReadPorts &
  DefaultLocationPorts &
  ClockPorts &
  LogPorts;

/** Firestore's most values an `in` query takes — the follow-up chunk. */
const IN_CHUNK = 30;

/** The visits holding one busy key, every status — the day's whole read set, one row over the cap included. */
export function visitsOnBusyDay(key: BusyKey): QuerySpec {
  return {
    collection: [Collections.Appointments],
    where: [{ field: 'busyKeys', op: QueryOp.ArrayContains, value: key }],
    orderBy: [],
    limit: StaffAnalyticsSystem.VISITS_PER_BARBER_DAY + 1,
  };
}

/** The visits booked from any of `ids` (≤ 30) — one chunk of the day's follow-up read, one row over its cap included. */
export function followUpsOf(ids: readonly AppointmentId[]): QuerySpec {
  return {
    collection: [Collections.Appointments],
    where: [{ field: 'bookedFromAppointmentId', op: QueryOp.In, value: ids }],
    orderBy: [],
    limit: ids.length * StaffAnalyticsSystem.FOLLOW_UPS_PER_VISIT + 1,
  };
}

/** `analyticsDays/{key}`. */
export function analyticsDayPath(key: BusyKey): readonly string[] {
  return [Collections.AnalyticsDays, key];
}

/** What one day's transaction read. */
type DayReadSet = {
  readonly visits: readonly Appointment[];
  readonly followUpChunks: readonly (readonly Appointment[])[];
  readonly existing: BarberAnalyticsDay | null;
  readonly departure: ScheduleException | null;
};

/** The zone a shop's wall clock reads in, or the default shop's for a shop not listed. */
function zoneOf(
  locations: readonly ShopLocation[],
  locationId: LocationId,
  fallback: TimeZone,
): TimeZone {
  for (let i = 0; i < locations.length; i++) {
    const location = locations[i] as ShopLocation;
    if (location.id === locationId) return location.timeZone;
  }
  return fallback;
}

/** `keys` with `more` appended, each once, sorted. */
function union(
  keys: readonly BusyKey[],
  more: readonly BusyKey[],
): readonly BusyKey[] {
  const out = [...keys];
  for (let i = 0; i < more.length; i++) {
    const key = more[i] as BusyKey;
    if (!out.includes(key)) out.push(key);
  }
  return out.sort();
}

/** The source visit an appointment command's sides name — the follow-up's origin, or none. */
function sourceOf(cmd: AppointmentDayCommand): AppointmentId | null {
  return (
    cmd.after?.bookedFromAppointmentId ??
    cmd.before?.bookedFromAppointmentId ??
    null
  );
}

/** Firestore's canonical name for gRPC 8 — a read past its named bound. */
const RESOURCE_EXHAUSTED = 'resource-exhausted';

/** What a command naming no day answers. */
const EMPTY_ANSWER: WriteAnalyticsDayAnswer = {
  writtenKeys: [],
  skippedKeys: [],
  keptKeys: [],
  failedKeys: [],
  failures: [],
  attemptFailure: null,
};

export const writeAnalyticsDay =
  (ports: WriteAnalyticsDayPorts) =>
  async (
    cmd: WriteAnalyticsDayCommand,
  ): Promise<Result<WriteAnalyticsDayAnswer, RepositoryError>> => {
    const writtenKeys: BusyKey[] = [];
    const skippedKeys: BusyKey[] = [];
    const keptKeys: BusyKey[] = [];
    const failedKeys: BusyKey[] = [];
    const failures: unknown[] = [];

    /** One day's failure: logged with the key and its code, collected, never fatal. */
    function failed(key: BusyKey | null, error: unknown): void {
      ports.log('error', LogEvent.AnalyticsDayWriteFailed, {
        key,
        code: TriggerAttemptSystem.attemptFailure(error).failureCode,
      });
      if (key !== null) failedKeys.push(key);
      failures.push(error);
    }

    // ── The keys ──────────────────────────────────────────────────────────
    let keys: readonly BusyKey[];
    let sourceAppointmentId: AppointmentId | null = null;
    if (cmd.analyticsDaySource === AnalyticsDaySource.Appointment) {
      keys = BusySystem.affectedKeys(cmd.before, cmd.after, cmd.salvagedKeys);
      sourceAppointmentId = sourceOf(cmd);
      if (sourceAppointmentId !== null) {
        // The follow-up's source: its days join the keys. A source that
        // cannot be read costs its own days only, never the sides'.
        const source = await ports.loadAppointment(sourceAppointmentId);
        if (!source.ok) failed(null, source.error);
        else if (source.value !== null) {
          keys = union(keys, source.value.busyKeys);
        }
      }
      if (keys.length === 0 && failures.length === 0) {
        return cmd.refusal === null
          ? Result.ok(EMPTY_ANSWER)
          : Result.err(cmd.refusal);
      }
    } else {
      keys = union([], cmd.keys);
      if (keys.length === 0) return Result.ok(EMPTY_ANSWER);
    }

    // ── Once per command: the policy and the shops ────────────────────────
    const [policyRead, listed] = await Promise.all([
      ports.loadPolicy(),
      ports.listLocations(),
    ]);
    if (!policyRead.ok) return policyRead;
    if (!listed.ok) return listed;
    const policy = ClientStatsPolicy.forBooking(policyRead.value);
    const locations = listed.value;
    const clock = StaffAnalyticsSystem.clockLocationOf(
      locations,
      ports.defaultLocationId,
    );
    if (clock === null) {
      return Result.err(
        RepositoryError.readFailed(
          `${Collections.Locations}/${ports.defaultLocationId}`,
          CatalogErrorCode.LocationZoneUnknown,
        ),
      );
    }

    for (const key of keys) {
      const sourceReadUtcMs = ports.nowUtcMs();
      const { barberId, localDate } = BusyKey.split(key);
      const now = ZonedTimeSystem.shopNow(sourceReadUtcMs, clock.timeZone);
      const nowByLocation: ShopNowAt[] = locations.map((location) => ({
        locationId: location.id,
        ...ZonedTimeSystem.shopNow(sourceReadUtcMs, location.timeZone),
      }));

      /** What `daysOf` cuts this barber-day from: a roster, a departure and visits. */
      const dayInputOf = (
        roster: BarberSchedule | null,
        departure: ScheduleException | null,
        visits: readonly Appointment[],
      ): AnalyticsDaysInput => ({
        barberIds: [barberId],
        localDates: [localDate],
        rosters: roster === null ? [] : [roster],
        departures: departure === null ? [] : [departure],
        locations,
        visits,
        nowByLocation,
        now,
      });
      /** The day as `daysOf` cuts it. */
      const dayOf = (
        roster: BarberSchedule | null,
        departure: ScheduleException | null,
        visits: readonly Appointment[],
      ): AnalyticsDay =>
        StaffAnalyticsSystem.daysOf(
          dayInputOf(roster, departure, visits),
        )[0] as AnalyticsDay;

      // ── Outside the transaction: is the day past, and which visits ─────
      const [rosterRead, departureRead, visitsRead] = await Promise.all([
        ports.loadSchedule(barberId),
        ports.loadScheduleException(key),
        ports.loadVisitsByBusyKeys([key]),
      ]);
      if (!rosterRead.ok) {
        failed(key, rosterRead.error);
        continue;
      }
      if (!departureRead.ok) {
        failed(key, departureRead.error);
        continue;
      }
      if (!visitsRead.ok) {
        failed(key, visitsRead.error);
        continue;
      }
      const roster = rosterRead.value;
      const visitsOutside = visitsRead.value;
      if (!dayOf(roster, departureRead.value, visitsOutside).pastDay) {
        skippedKeys.push(key);
        continue;
      }
      const visitIds = StaffAnalyticsSystem.mergeVisits(visitsOutside).map(
        (visit) => visit.id,
      );
      const idChunks = BackfillPlanSystem.chunk(visitIds, IN_CHUNK);

      // ── Inside ONE transaction: the day's read set, the fold, the stamp ──
      let committed: Result<
        { readonly written: boolean; readonly visitCount: number },
        RepositoryError
      >;
      try {
        committed = await ports.commit(
          async (tx: ReadTx): Promise<DayReadSet> => {
            const [visits, followUpChunks, existing, , departure] =
              await Promise.all([
                tx.query<Appointment>(visitsOnBusyDay(key)),
                Promise.all(
                  idChunks.map((ids) =>
                    tx.query<Appointment>(followUpsOf(ids)),
                  ),
                ),
                tx.get<BarberAnalyticsDay>(analyticsDayPath(key)),
                // The follow-up's source enters the conflict set: a
                // concurrent edit of it re-runs this day.
                sourceAppointmentId === null
                  ? Promise.resolve(null)
                  : tx.get<Appointment>([
                      Collections.Appointments,
                      sourceAppointmentId,
                    ]),
                tx.get<ScheduleException>([
                  Collections.ScheduleExceptions,
                  key,
                ]),
              ]);
            return { visits, followUpChunks, existing, departure };
          },
          (
            read,
          ): Result<
            {
              readonly written: boolean;
              readonly visitCount: number;
              readonly writes: readonly WriteOp[];
            },
            RepositoryError
          > => {
            if (
              read.visits.length > StaffAnalyticsSystem.VISITS_PER_BARBER_DAY
            ) {
              return Result.err(
                RepositoryError.readFailed(
                  Collections.Appointments,
                  RESOURCE_EXHAUSTED,
                ),
              );
            }
            const followUps: AnalyticsFollowUp[] = [];
            for (let c = 0; c < read.followUpChunks.length; c++) {
              const chunk = read.followUpChunks[c] as readonly Appointment[];
              const ids = idChunks[c] as readonly AppointmentId[];
              if (
                chunk.length >
                ids.length * StaffAnalyticsSystem.FOLLOW_UPS_PER_VISIT
              ) {
                return Result.err(
                  RepositoryError.readFailed(
                    Collections.Appointments,
                    RESOURCE_EXHAUSTED,
                  ),
                );
              }
              for (let i = 0; i < chunk.length; i++) {
                const visit = chunk[i] as Appointment;
                if (!StaffAnalyticsSystem.isCountedFollowUp(visit)) continue;
                followUps.push(
                  StaffAnalyticsSystem.followUpOf(
                    visit,
                    ZonedTimeSystem.toLocal(
                      visit.bookedAtUtcMs,
                      zoneOf(locations, visit.locationId, clock.timeZone),
                    ).localDate,
                  ),
                );
              }
            }
            // Stamp ordering: a document computed from reads at or after
            // this one's stays — never overwritten with older reads.
            if (
              read.existing !== null &&
              UtcEpochMs.compare(
                read.existing.dayComputedAtUtcMs,
                sourceReadUtcMs,
              ) >= 0
            ) {
              return Result.ok({
                written: false,
                visitCount: read.visits.length,
                writes: [],
              });
            }
            // The day, the locations it touched, and each one's share of
            // a day split across shops (ADR 2026-11-09).
            const figures: DayFigures = StaffAnalyticsSystem.storedDayOf({
              dayInput: dayInputOf(roster, read.departure, read.visits),
              followUps,
              policy,
              computedAtUtcMs: sourceReadUtcMs,
            });
            return Result.ok({
              written: true,
              visitCount: read.visits.length,
              writes: [WriteOp.set(analyticsDayPath(key), figures)],
            });
          },
        );
      } catch (error) {
        failed(key, error);
        continue;
      }
      if (!committed.ok) {
        failed(key, committed.error);
        continue;
      }
      if (!committed.value.written) {
        keptKeys.push(key);
        continue;
      }
      writtenKeys.push(key);
      ports.log('info', LogEvent.AnalyticsDayWritten, {
        barberId,
        localDate,
        source: cmd.analyticsDaySource,
        visitCount: committed.value.visitCount,
        durationMs: UtcEpochMs.elapsedMs(sourceReadUtcMs, ports.nowUtcMs()),
      });
    }

    return Result.ok({
      writtenKeys,
      skippedKeys,
      keptKeys,
      failedKeys,
      failures,
      attemptFailure: TriggerAttemptSystem.decisiveFailure(failures),
    });
  };
