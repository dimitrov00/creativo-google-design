import type { Observable } from 'rxjs';
import type { BookingPolicy } from '../components/booking-policy.data';
import type { BusyKey } from '../components/busy-key.data';
import type { DayKey } from '../components/day-key.data';
import type { PipelineError } from '../components/pipeline-errors.data';
import type { RepositoryError } from '../components/repository-errors.data';
import type { Result } from '../components/result.data';
import type {
  AppointmentEntity,
  AppointmentId,
} from '../entities/appointment.entity';
import type { BarberBusyDayEntity } from '../entities/barber-busy-day.entity';
import type { BarberLeadTimeSampleEntity } from '../entities/barber-lead-time-sample.entity';
import type { BarberScheduleEntity } from '../entities/barber-schedule.entity';
import type { BarberId } from '../entities/barber.entity';
import type {
  CapacityMonthEntity,
  CapacityMonthId,
} from '../entities/capacity-month.entity';
import type { ClientMoneyStatsEntity } from '../entities/client-money-stats.entity';
import type { ClientStatsEntity } from '../entities/client-stats.entity';
import type { LocationEntity, LocationId } from '../entities/location.entity';
import type { PolicyRecomputeJobEntity } from '../entities/policy-recompute-job.entity';
import type { ScheduleExceptionEntity } from '../entities/schedule-exception.entity';
import type { UserId } from '../entities/user.entity';
import type {
  WaitlistRequestEntity,
  WaitlistRequestId,
} from '../entities/waitlist-request.entity';
import type { CallableName } from './callables';

/**
 * The scheduling context's ports (blueprint §4.1, §4.2): the raw entity
 * streams the booking store derives availability from, the appointment,
 * waitlist and client-stats readers, the schedule-exception command, the
 * web's callable gateway, and the functions' scheduling reads. One function
 * per query shape; every `Observe*`/`Load*`/`Page*` port names its error,
 * `Result<X, RepositoryError>`; entities come straight from `snap.data()`.
 *
 * Availability is NEVER computed behind a port: `DayAvailability` is a
 * `computed()` in the booking store (or a pipeline) calling
 * `RosterSystem.buildDayWindows` + `AvailabilitySystem.availableOptions`
 * over these streams (§4.2 — today's violation at
 * `availability-reader.adapter.ts:30,179,405` leaves the adapter).
 *
 * Transactional reads (the booking commit's read set, the rebuild queries)
 * go through `ReadTx` of `tx.port.ts`, not through these ports.
 */

// ── Raw availability streams (the `SchedulingReadPorts` token, §5.2) ──────

/**
 * One barber's busy blocks for one day — `barberBusy/{BusyKey}`; `null`
 * when nothing is booked that day (no document). PII-free by
 * construction: `/book` reads it anonymously.
 */
export type ObserveBusyDay = (
  key: BusyKey,
) => Observable<Result<BarberBusyDayEntity | null, RepositoryError>>;

/**
 * One barber's schedule exception for one day — `scheduleExceptions/{BusyKey}`
 * (the same key as the busy day); `null` when the day is as rostered. The
 * public effect only (§9 D16(b)).
 */
export type ObserveExceptions = (
  key: BusyKey,
) => Observable<Result<ScheduleExceptionEntity | null, RepositoryError>>;

/** A barber's roster versions — `barberSchedules/{barberId}`; `null` when unrostered. */
export type ObserveSchedule = (
  barberId: BarberId,
) => Observable<Result<BarberScheduleEntity | null, RepositoryError>>;

/** One shop — `locations/{locationId}`; `null` when it is gone. */
export type ObserveLocation = (
  locationId: LocationId,
) => Observable<Result<LocationEntity | null, RepositoryError>>;

/**
 * The tenant's booking policy — `settings/bookingPolicy`, live. Never
 * `null`: an absent or partial document reads as
 * `BookingPolicy.withDefaults` (§9 D28 — the policy port returns a `Result`
 * like every other read port; a missing document is the normal case, not a
 * failure).
 */
export type ObservePolicy = () => Observable<
  Result<BookingPolicy, RepositoryError>
>;

/**
 * One month of every barber's free minutes per day per shop —
 * `capacity/{YYYY-MM}`, the month calendar's markers (§9 D7); `null` before
 * the month's first rebuild.
 */
export type ObserveCapacityMonth = (
  month: CapacityMonthId,
) => Observable<Result<CapacityMonthEntity | null, RepositoryError>>;

// ── Appointments ──────────────────────────────────────────────────────────

/** One visit — `appointments/{id}`; `null` when absent. */
export type ObserveAppointment = (
  id: AppointmentId,
) => Observable<Result<AppointmentEntity | null, RepositoryError>>;

/**
 * Everything on ONE barber's chair for ONE day, every status — the staff
 * day sheet: `busyKeys array-contains key`, single-field, the key the
 * rebuild trigger queries by (`appointment-repository.adapter.ts:245-253`).
 * Rules allow it for staff only.
 */
export type ObserveBarberDay = (
  key: BusyKey,
) => Observable<Result<readonly AppointmentEntity[], RepositoryError>>;

/**
 * A person's live bookings — `ownerUserId ==`, `bookingStatus.kind in
 * [pending, confirmed]`, `orderBy timeInterval.startMs` (index #6). Which of
 * them are still ahead is decided by a system against `nowMs`, not here.
 */
export type ObserveUpcoming = (
  ownerUserId: UserId,
) => Observable<Result<readonly AppointmentEntity[], RepositoryError>>;

/**
 * A person's newest visits, BOUNDED by `limit` — `ownerUserId ==`,
 * `orderBy timeInterval.startMs desc` (index #18): history grows without
 * end, the newest N is what a person scrolls.
 */
export type ObserveHistory = (
  ownerUserId: UserId,
  limit: number,
) => Observable<Result<readonly AppointmentEntity[], RepositoryError>>;

/** One page of a client's visits, newest first, and where the next one starts. */
export type ClientHistoryPage = {
  readonly appointments: readonly AppointmentEntity[];
  /** The `timeInterval.startMs` the next page reads strictly before; `null` at the end. */
  readonly nextBeforeMs: number | null;
};

/**
 * The client card's visit history — `subjectUserIds array-contains`,
 * `timeInterval.startMs <` the cursor, `desc` (index #19,
 * `client-history-reader.adapter.ts:54-116`). A page never ends between two
 * visits sharing one start instant: `PagingSystem`'s same-instant boundary
 * rule (§2.8) decides the trim, so a cursor on that instant skips nothing.
 */
export type PageClientHistory = (
  subjectUserId: UserId,
  beforeMs: number | null,
  limit: number,
) => Promise<Result<ClientHistoryPage, RepositoryError>>;

/** A person's waitlist requests — `ownerUserId ==`, `orderBy createdAtMs desc` (index #17). */
export type ObserveMyWaitlistRequests = (
  ownerUserId: UserId,
) => Observable<Result<readonly WaitlistRequestEntity[], RepositoryError>>;

// ── Client stats ──────────────────────────────────────────────────────────

/** `clientStats/{uid}` — `null` before the person's first projection. */
export type LoadClientStats = (
  userId: UserId,
) => Promise<Result<ClientStatsEntity | null, RepositoryError>>;

/** `clientStats/{uid}/restricted/money` — staff-only; `null` when none is stored. */
export type LoadClientMoney = (
  userId: UserId,
) => Promise<Result<ClientMoneyStatsEntity | null, RepositoryError>>;

/** One page of stored client stats, by document id, and where the next starts. */
export type ClientStatsPage = {
  readonly records: readonly ClientStatsEntity[];
  /** The last id of this page — the next page reads strictly after it; `null` at the end. */
  readonly nextAfterUserId: UserId | null;
};

/**
 * Stored client stats in document-id order — `orderBy(documentId())`
 * pages, single-field (the rhythm preview and the directory,
 * `client-stats-directory.adapter.ts:53`).
 */
export type PageClientStats = (
  afterUserId: UserId | null,
  limit: number,
) => Promise<Result<ClientStatsPage, RepositoryError>>;

/**
 * The ids of stored clients in document-id order, bodies NOT read
 * (`select()`) — the policy recompute's and the backfill's walk over
 * `clientStats` (`recompute-on-policy-change.ts:274-278`,
 * `run-backfill.ts:442-446`). A page shorter than `limit` is the last.
 */
export type PageClients = (
  afterUserId: UserId | null,
  limit: number,
) => Promise<Result<readonly UserId[], RepositoryError>>;

/**
 * The policy recompute's progress document —
 * `backfillJobs/clientStatsPolicy`; `null` before the first pass (§9 D17).
 */
export type LoadPolicyRecomputeJob = () => Promise<
  Result<PolicyRecomputeJobEntity | null, RepositoryError>
>;

// ── Schedule exceptions (the staff command) ───────────────────────────────

/**
 * `writeScheduleException` (§4.2) — reads the stored exception of every
 * key and writes the merge, inside ONE transaction. `merge` is the pure
 * `ScheduleExceptionSystem` decision: given the stored bodies (positions
 * preserved, `null` when absent) it returns the new body per key —
 * `null` deletes that day's document — or refuses with its own error, in
 * which case nothing is written. One key for a block, many for a series.
 */
export type WriteScheduleException = <E>(
  keys: readonly BusyKey[],
  merge: (
    stored: readonly (ScheduleExceptionEntity | null)[],
  ) => Result<readonly (ScheduleExceptionEntity | null)[], E>,
) => Promise<Result<void, E | RepositoryError>>;

// ── The web's callable gateway ────────────────────────────────────────────

/** One server pipeline as the web calls it: a payload in, a typed answer or a `PipelineError` out. */
export type Callable<In, Out> = (
  input: In,
) => Promise<Result<Out, PipelineError>>;

/**
 * `callableClient` (§4.2) — the successor of the four duck-typed gateway
 * copies (`BookingGateway`, the waitlist, OTP and streak gateways): one
 * function that names a server export and returns its typed caller, with
 * ONE error translation (`translateFunctionsError`'s table) into
 * `PipelineError`. The name is read from the `Callables` registry
 * (`ports/callables.ts`), never a free string at the call site. The
 * implementation lives beside the web adapters in `libs/infrastructure/*`.
 */
export type CallableClient = <In, Out>(name: CallableName) => Callable<In, Out>;

// ── Server reads (the functions' pipelines) ───────────────────────────────

/**
 * `settings/bookingPolicy`, read OUTSIDE any transaction on purpose
 * (`load-booking-policy.ts:22` — it never widens a conflict set). An absent
 * document is `BookingPolicy.withDefaults` (§9 D28).
 */
export type LoadPolicy = () => Promise<Result<BookingPolicy, RepositoryError>>;

/** `appointments/{id}` — `null` when absent. */
export type LoadAppointment = (
  id: AppointmentId,
) => Promise<Result<AppointmentEntity | null, RepositoryError>>;

/** `barberBusy/{BusyKey}` — `null` when the day holds nothing. */
export type LoadBusyDay = (
  key: BusyKey,
) => Promise<Result<BarberBusyDayEntity | null, RepositoryError>>;

/** `barberSchedules/{barberId}` — `null` when unrostered. */
export type LoadSchedule = (
  barberId: BarberId,
) => Promise<Result<BarberScheduleEntity | null, RepositoryError>>;

/** `waitlistRequests/{id}` — `null` when absent. */
export type LoadWaitlistRequest = (
  id: WaitlistRequestId,
) => Promise<Result<WaitlistRequestEntity | null, RepositoryError>>;

/**
 * Every open request naming `dayKey` — `status.kind == open`, `dayKeys
 * array-contains` (index #14, `firestore-waitlist-store.ts:94-95`): what a
 * freed day has to consider.
 */
export type LoadOpenWaitlist = (
  dayKey: DayKey,
) => Promise<Result<readonly WaitlistRequestEntity[], RepositoryError>>;

/**
 * Several `capacity/{YYYY-MM}` documents in one `getAll`, positions
 * preserved (`out[i]` is `months[i]`, `null` before its first rebuild) —
 * read once and shared by every barber (`sample-lead-time.ts:82-95`).
 */
export type LoadCapacityMonths = (
  months: readonly CapacityMonthId[],
) => Promise<Result<readonly (CapacityMonthEntity | null)[], RepositoryError>>;

/**
 * `listBarbers` (§4.1 `sampleLeadTime`) — the ROSTERED barbers, the ids of
 * `barberSchedules` (bodies not read): the roster is the population, not
 * the catalogue (`sample-lead-time.ts:97-100`).
 */
export type ListBarbers = () => Promise<
  Result<readonly BarberId[], RepositoryError>
>;

/**
 * `barberLeadTimeSamples/{barberId__dayKey}` `Set` — one barber's daily
 * sample; the adapter stamps the root `purgeAt` (`dayKey` + 400 d). The
 * daily writer runs only behind the `leadTimeSampling` manifest flag until
 * the trend reader lands (§3.1).
 */
export type WriteLeadTimeSample = (
  sample: BarberLeadTimeSampleEntity,
) => Promise<Result<void, RepositoryError>>;

/**
 * The scheduling context's port catalogue. Each composition root binds the
 * `Pick` its runtime implements — the web its streams, readers, command and
 * `callableClient`; the functions the server reads.
 */
export type SchedulingPorts = {
  readonly observeBusyDay: ObserveBusyDay;
  readonly observeExceptions: ObserveExceptions;
  readonly observeSchedule: ObserveSchedule;
  readonly observeLocation: ObserveLocation;
  readonly observePolicy: ObservePolicy;
  readonly observeCapacityMonth: ObserveCapacityMonth;
  readonly observeAppointment: ObserveAppointment;
  readonly observeBarberDay: ObserveBarberDay;
  readonly observeUpcoming: ObserveUpcoming;
  readonly observeHistory: ObserveHistory;
  readonly pageClientHistory: PageClientHistory;
  readonly observeMyWaitlistRequests: ObserveMyWaitlistRequests;
  readonly loadClientStats: LoadClientStats;
  readonly loadClientMoney: LoadClientMoney;
  readonly pageClientStats: PageClientStats;
  readonly pageClients: PageClients;
  readonly loadPolicyRecomputeJob: LoadPolicyRecomputeJob;
  readonly writeScheduleException: WriteScheduleException;
  readonly callableClient: CallableClient;
  readonly loadPolicy: LoadPolicy;
  readonly loadAppointment: LoadAppointment;
  readonly loadBusyDay: LoadBusyDay;
  readonly loadSchedule: LoadSchedule;
  readonly loadWaitlistRequest: LoadWaitlistRequest;
  readonly loadOpenWaitlist: LoadOpenWaitlist;
  readonly loadCapacityMonths: LoadCapacityMonths;
  readonly listBarbers: ListBarbers;
  readonly writeLeadTimeSample: WriteLeadTimeSample;
};

/**
 * The booking store's raw entity streams — the bundle the web's
 * `SCHEDULING_READ_PORTS` token binds (§4.3, §5.2), eager or lazy, the
 * `(db) => bundle` export of `scheduling.adapter.ts`.
 */
export type SchedulingReadPorts = Pick<
  SchedulingPorts,
  | 'observeBusyDay'
  | 'observeSchedule'
  | 'observeExceptions'
  | 'observeLocation'
  | 'observePolicy'
>;
