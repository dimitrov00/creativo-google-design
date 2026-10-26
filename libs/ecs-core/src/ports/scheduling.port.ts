import type { Observable } from 'rxjs';
import type { BookingPolicy, LivePolicyLine } from '@core/components';
import type {
  AppointmentId,
  BarberId,
  BusyKey,
  CapacityMonthId,
  CustomerId,
  LocalDate,
  LocationId,
  Result,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import type { PipelineError, RepositoryError } from '@core/errors';
import type {
  Appointment,
  BarberBusyDay,
  BarberLeadTimeSample,
  BarberSchedule,
  CapacityMonth,
  ClientMoneyRecord,
  ClientStatsRecord,
  PolicyRecomputeJob,
  ScheduleException,
  ShopLocation,
  WaitlistRequest,
} from '@core/entities';
import type { CallableName, CallableWire } from './callables';

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
) => Observable<Result<BarberBusyDay | null, RepositoryError>>;

/**
 * One barber's schedule exception for one day — `scheduleExceptions/{BusyKey}`
 * (the same key as the busy day); `null` when the day is as rostered. The
 * public effect only (§9 D16(b)).
 */
export type ObserveExceptions = (
  key: BusyKey,
) => Observable<Result<ScheduleException | null, RepositoryError>>;

/** A barber's roster versions — `barberSchedules/{barberId}`; `null` when unrostered. */
export type ObserveSchedule = (
  barberId: BarberId,
) => Observable<Result<BarberSchedule | null, RepositoryError>>;

/** One shop — `locations/{locationId}`; `null` when it is gone. */
export type ObserveLocation = (
  locationId: LocationId,
) => Observable<Result<ShopLocation | null, RepositoryError>>;

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
) => Observable<Result<CapacityMonth | null, RepositoryError>>;

// ── Appointments ──────────────────────────────────────────────────────────

/** One visit — `appointments/{id}`; `null` when absent. */
export type ObserveAppointment = (
  id: AppointmentId,
) => Observable<Result<Appointment | null, RepositoryError>>;

/**
 * One barber's day as the staff sheet reads it (OR-2): the visits it could
 * read, and how many it could not. `unreadableCount` is the number of
 * stored visits the read-time guard dropped from THIS answer — counted in
 * the loop that drops them, never a second read; `0` on a clean read. The
 * sheet words the count on the chair's all-day strip, so a dropped visit
 * never draws its time as a free gap.
 */
export type BarberDayRead = {
  readonly appointments: readonly Appointment[];
  readonly unreadableCount: number;
};

/**
 * Everything on ONE barber's chair for ONE day, every status — the staff
 * day sheet: `busyKeys array-contains key`, single-field, the key the
 * rebuild trigger queries by (`appointment-repository.adapter.ts:245-253`).
 * Rules allow it for staff only. A partial drop answers the rest with its
 * count ({@link BarberDayRead}); a day whose every visit is refused answers
 * the refusal — the failed chair, never an empty, free-looking day.
 */
export type ObserveBarberDay = (
  key: BusyKey,
) => Observable<Result<BarberDayRead, RepositoryError>>;

/**
 * A person's live bookings — `ownerUserId ==` (the ACCOUNT's own visits —
 * `UserId` for good, D29), live statuses, ordered by start (index #6). Which
 * of them are still ahead is decided by a system against `ShopNow`, not here.
 */
export type ObserveUpcoming = (
  ownerUserId: UserId,
) => Observable<Result<readonly Appointment[], RepositoryError>>;

/**
 * A person's newest visits, BOUNDED by `limit` — `ownerUserId ==`, newest
 * start first (index #18): history grows without end, the newest N is what
 * a person scrolls.
 */
export type ObserveHistory = (
  ownerUserId: UserId,
  limit: number,
) => Observable<Result<readonly Appointment[], RepositoryError>>;

/**
 * The staff search pool — the visits nearest `nowUtcMs` on BOTH sides: the
 * `limitPerSide` latest starting before it (`utcEpochMs < now`, `desc`) and
 * the `limitPerSide` earliest starting at or after it (`utcEpochMs >= now`,
 * `asc`), merged oldest first. Each half is a range + `orderBy` on the ONE
 * field, so both ride its automatic single-field index (no composite, no
 * `fieldOverrides` entry on `utcEpochMs`); ordering each half outward from
 * now makes the limit cut the far edges, never the middle. Every status.
 * The successor of `APPOINTMENT_REPOSITORY.searchWindow` — what the staff
 * day's search pool and the add-client page's «Скорошни» read
 * (`staff-day.store.ts` `reloadSearchPool`).
 */
export type SearchAppointmentWindow = (
  nowUtcMs: UtcEpochMs,
  limitPerSide: number,
) => Promise<Result<readonly Appointment[], RepositoryError>>;

/** One page of a client's visits, newest first, and where the next one starts. */
export type ClientHistoryPage = {
  readonly appointments: readonly Appointment[];
  /** The start instant (`utcEpochMs`) the next page reads strictly before; `null` at the end. */
  readonly nextBeforeUtcMs: UtcEpochMs | null;
};

/**
 * The client card's visit history — `subjectCustomerIds array-contains`
 * (the client RECORD, D29), the start instant `<` the cursor, `desc` (index
 * #19, `client-history-reader.adapter.ts:54-116`) — a Firestore range on
 * `utcEpochMs`, which is what that field is for (Law 7.3). A page never ends
 * between two visits sharing one start instant: `PagingSystem`'s
 * same-instant boundary rule (§2.8) decides the trim, so a cursor on that
 * instant skips nothing; the typed cursor is this port's, `PagingSystem`'s
 * key stays opaque (flatten-spec §3.8).
 */
export type PageClientHistory = (
  subjectCustomerId: CustomerId,
  beforeUtcMs: UtcEpochMs | null,
  limit: number,
) => Promise<Result<ClientHistoryPage, RepositoryError>>;

/** A person's waitlist requests — `ownerUserId ==` (the account, D29), `orderBy createdAtUtcMs desc` (index #17). */
export type ObserveMyWaitlistRequests = (
  ownerUserId: UserId,
) => Observable<Result<readonly WaitlistRequest[], RepositoryError>>;

// ── Client stats ──────────────────────────────────────────────────────────

/** `clientStats/{customerId}` — `null` before the record's first projection (D29). */
export type LoadClientStats = (
  customerId: CustomerId,
) => Promise<Result<ClientStatsRecord | null, RepositoryError>>;

/** `clientStats/{customerId}/restricted/money` — staff-only; `null` when none is stored. */
export type LoadClientMoney = (
  customerId: CustomerId,
) => Promise<Result<ClientMoneyRecord | null, RepositoryError>>;

/** One page of stored client stats, by document id, and where the next starts. */
export type ClientStatsPage = {
  readonly records: readonly ClientStatsRecord[];
  /** The last id of this page — the next page reads strictly after it; `null` at the end. */
  readonly nextAfterCustomerId: CustomerId | null;
};

/**
 * Stored client stats in document-id order — `orderBy(documentId())`
 * pages, single-field (the rhythm preview and the directory,
 * `client-stats-directory.adapter.ts:53`).
 */
export type PageClientStats = (
  afterCustomerId: CustomerId | null,
  limit: number,
) => Promise<Result<ClientStatsPage, RepositoryError>>;

/**
 * The ids of stored clients — client records (D29) — in document-id order,
 * bodies NOT read (`select()`): the policy recompute's and the backfill's
 * walk over `clientStats` (`recompute-on-policy-change.ts:274-278`,
 * `run-backfill.ts:442-446`). A page shorter than `limit` is the last.
 */
export type PageClients = (
  afterCustomerId: CustomerId | null,
  limit: number,
) => Promise<Result<readonly CustomerId[], RepositoryError>>;

/**
 * The policy recompute's progress document —
 * `backfillJobs/clientStatsPolicy`; `null` before the first pass (§9 D17).
 */
export type LoadPolicyRecomputeJob = () => Promise<
  Result<PolicyRecomputeJob | null, RepositoryError>
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
    stored: readonly (ScheduleException | null)[],
  ) => Result<readonly (ScheduleException | null)[], E>,
) => Promise<Result<void, E | RepositoryError>>;

// ── The web's callable gateway ────────────────────────────────────────────

/** One server pipeline as the web calls it: a payload in, a typed answer or a `PipelineError` out. */
export type Callable<In, Out> = (
  input: In,
) => Promise<Result<Out, PipelineError>>;

/**
 * `callableClient` (§4.2, Phase 4a 4A-4) — the successor of the four
 * duck-typed gateway copies (`BookingGateway`, the waitlist, OTP and streak
 * gateways): one function that names a server export and returns its
 * caller, typed BY NAME through {@link CallableWire} (the request is the
 * call component, the answer decoded by its call component's decoder —
 * `CALLABLE_ANSWER_DECODERS`), with ONE error classification
 * (`PipelineError.fromWire`). The name is read from the `Callables`
 * registry (`ports/callables.ts`), never a free string at the call site.
 * The implementation is `callableClientPorts(functions)` in
 * `libs/infrastructure/firebase-app`.
 */
export type CallableClient = <N extends CallableName>(
  name: N,
) => Callable<CallableWire[N]['input'], CallableWire[N]['answer']>;

// ── Server reads (the functions' pipelines) ───────────────────────────────

/**
 * `settings/bookingPolicy`, read OUTSIDE any transaction on purpose
 * (`load-booking-policy.ts:22` — it never widens a conflict set). An absent
 * document is `BookingPolicy.withDefaults` (§9 D28).
 */
export type LoadPolicy = () => Promise<Result<BookingPolicy, RepositoryError>>;

/** `barberBusy/{BusyKey}` — `null` when the day holds nothing. */
export type LoadBusyDay = (
  key: BusyKey,
) => Promise<Result<BarberBusyDay | null, RepositoryError>>;

/**
 * `scheduleExceptions/{BusyKey}` — one barber's published exception for one
 * day, read OUTSIDE a transaction (the waitlist matcher's day check, §4.1
 * `matchWaitlist`); `null` when the day is as rostered. The same key as the
 * busy day; the public effect only (§9 D16(b)).
 */
export type LoadScheduleException = (
  key: BusyKey,
) => Promise<Result<ScheduleException | null, RepositoryError>>;

/** `barberSchedules/{barberId}` — `null` when unrostered. */
export type LoadSchedule = (
  barberId: BarberId,
) => Promise<Result<BarberSchedule | null, RepositoryError>>;

/**
 * Every open request naming `localDate` — open status, `localDates
 * array-contains` (index #14, `firestore-waitlist-store.ts:94-95`): what a
 * freed day has to consider.
 */
export type LoadOpenWaitlist = (
  localDate: LocalDate,
) => Promise<Result<readonly WaitlistRequest[], RepositoryError>>;

/**
 * Several `capacity/{YYYY-MM}` documents in one `getAll`, positions
 * preserved (`out[i]` is `months[i]`, `null` before its first rebuild) —
 * read once and shared by every barber (`sample-lead-time.ts:82-95`).
 */
export type LoadCapacityMonths = (
  months: readonly CapacityMonthId[],
) => Promise<Result<readonly (CapacityMonth | null)[], RepositoryError>>;

/**
 * `listBarbers` (§4.1 `sampleLeadTime`) — the ROSTERED barbers, the ids of
 * `barberSchedules` (bodies not read): the roster is the population, not
 * the catalogue (`sample-lead-time.ts:97-100`).
 */
export type ListBarbers = () => Promise<
  Result<readonly BarberId[], RepositoryError>
>;

/**
 * `barberLeadTimeSamples/{barberId__localDate}` `Set` — one barber's daily
 * sample; the adapter stamps the root `purgeAt` (`localDate` + 400 d).
 * Written daily, ungated (F1-2): an un-backfillable snapshot; the TTL
 * bounds it (OR-27 — no manifest flag gates the writer).
 */
export type WriteLeadTimeSample = (
  sample: BarberLeadTimeSample,
) => Promise<Result<void, RepositoryError>>;

/**
 * The booking policy's line and when it last changed — `settings/bookingPolicy`
 * (its `cancellationWindowHours` through `BookingPolicy.withDefaults`, and
 * the document's `updateTime`; `null` with no document).
 */
export type LoadPolicyLine = () => Promise<
  Result<LivePolicyLine, RepositoryError>
>;

// ── Focused bundles (Law 9 — composed with `&`, never sliced) ─────────────
//
// Each bundle is a concrete record, 1:1 with a web `InjectionToken`
// (`ports.tokens.ts`) or a functions adapter factory; a consumer that needs
// several takes their intersection. A subset no bundle names is a missing
// bundle — split it here, never `Pick` it at the use site.

// The web's bundles (one `InjectionToken` each, `ports.tokens.ts`).

/**
 * A shop day's raw streams — per barber the roster, the busy day and the
 * schedule exception, and the named shop: the booking sheet's day.
 */
export type ShopDayStreamPorts = {
  readonly observeBusyDay: ObserveBusyDay;
  readonly observeExceptions: ObserveExceptions;
  readonly observeSchedule: ObserveSchedule;
  readonly observeLocation: ObserveLocation;
};

/** The booking policy, live. */
export type PolicyStreamPorts = {
  readonly observePolicy: ObservePolicy;
};

/** A month's capacity document, live — the calendar's markers. */
export type CapacityStreamPorts = {
  readonly observeCapacityMonth: ObserveCapacityMonth;
};

/**
 * The booking store's raw entity streams — the bundle the web's
 * `SCHEDULING_READ_PORTS` token binds (§4.3, §5.2), eager or lazy, the
 * `(db) => bundle` export of `scheduling.adapter.ts`. Availability is a
 * `computed()` over these (`RosterSystem` + `AvailabilitySystem`, and
 * `CapacitySystem` over the month for the calendar's markers).
 */
export type SchedulingReadPorts = ShopDayStreamPorts &
  PolicyStreamPorts &
  CapacityStreamPorts;

/** The staff schedule-exception command — `SCHEDULE_EXCEPTION_PORTS`. */
export type ScheduleExceptionPorts = {
  readonly writeScheduleException: WriteScheduleException;
};

/** One visit, a barber's day and the staff search window. */
export type StaffAppointmentReadPorts = {
  readonly observeAppointment: ObserveAppointment;
  readonly observeBarberDay: ObserveBarberDay;
  readonly searchAppointmentWindow: SearchAppointmentWindow;
};

/** An account's upcoming visits and history (`ownerUserId`, the account's own). */
export type AccountAppointmentReadPorts = {
  readonly observeUpcoming: ObserveUpcoming;
  readonly observeHistory: ObserveHistory;
};

/** A client record's history pages. */
export type ClientHistoryReadPorts = {
  readonly pageClientHistory: PageClientHistory;
};

/** The appointment readers — `APPOINTMENT_READ_PORTS`. */
export type AppointmentReadPorts = StaffAppointmentReadPorts &
  AccountAppointmentReadPorts &
  ClientHistoryReadPorts;

/** An account's own waitlist requests — `WAITLIST_READ_PORTS`. */
export type WaitlistReadPorts = {
  readonly observeMyWaitlistRequests: ObserveMyWaitlistRequests;
};

/** One client record's statistics and money. */
export type ClientStatsLoadPorts = {
  readonly loadClientStats: LoadClientStats;
  readonly loadClientMoney: LoadClientMoney;
};

/** The client statistics in pages — the rhythm preview's walk. */
export type ClientStatsPagePorts = {
  readonly pageClientStats: PageClientStats;
};

/** The client-stats readers, keyed by the client record (D29) — `CLIENT_STATS_READ_PORTS`. */
export type ClientStatsReadPorts = ClientStatsLoadPorts & ClientStatsPagePorts;

/** The callable RPC gateway. */
export type GatewayPorts = {
  readonly callableClient: CallableClient;
};

// The functions' bundles (one adapter factory each, `apps/functions/src/adapters`).

/** The booking policy — `firestore-settings.adapter.ts`. */
export type PolicyReadPorts = {
  readonly loadPolicy: LoadPolicy;
};

/** A barber's roster, busy day and schedule exception for a shop day. */
export type ShopDayReadPorts = {
  readonly loadBusyDay: LoadBusyDay;
  readonly loadScheduleException: LoadScheduleException;
  readonly loadSchedule: LoadSchedule;
};

/** The tenant's barbers. */
export type BarberListPorts = {
  readonly listBarbers: ListBarbers;
};

/** The open waitlist requests a freed time may match. */
export type OpenWaitlistReadPorts = {
  readonly loadOpenWaitlist: LoadOpenWaitlist;
};

/** The capacity months — `firestore-capacity.adapter.ts`. */
export type CapacityReadPorts = {
  readonly loadCapacityMonths: LoadCapacityMonths;
};

/** The daily lead-time sample — `firestore-lead-time.adapter.ts`. */
export type LeadTimeWritePorts = {
  readonly writeLeadTimeSample: WriteLeadTimeSample;
};

/** The server and background pipelines' scheduling reads. */
export type ServerSchedulingReadPorts = PolicyReadPorts &
  ShopDayReadPorts &
  BarberListPorts &
  OpenWaitlistReadPorts &
  CapacityReadPorts &
  LeadTimeWritePorts;

/** The client records in pages — the recompute and the backfill walk them. */
export type ClientPagePorts = {
  readonly pageClients: PageClients;
};

/** The policy-recompute job's progress. */
export type PolicyRecomputeJobPorts = {
  readonly loadPolicyRecomputeJob: LoadPolicyRecomputeJob;
};

/** The administrative batch reads. */
export type AdminBatchPorts = ClientPagePorts & PolicyRecomputeJobPorts;

/** The policy's live line for the daily sweep. */
export type PolicyLinePorts = {
  readonly loadPolicyLine: LoadPolicyLine;
};

/**
 * The scheduling context's whole port suite — assembled by intersection of
 * its bundles, never sliced back apart (Law 9).
 */
export type SchedulingPorts = SchedulingReadPorts &
  ScheduleExceptionPorts &
  AppointmentReadPorts &
  WaitlistReadPorts &
  ClientStatsReadPorts &
  ServerSchedulingReadPorts &
  AdminBatchPorts &
  PolicyLinePorts &
  GatewayPorts;
