/**
 * `@creativo/ecs-core/testing` — test support only. Specs import it (inside
 * ecs-core by the RELATIVE path `../testing`; elsewhere through the alias);
 * production code never may (the root `no-restricted-imports`
 * testing-entry-point guard).
 *
 * Five families, each a plain function — no classes, no module state:
 *
 * - the purity contract's {@link deepFreeze} (`ecs-systems.md` spec contract);
 * - the pinned impure primitives a pipeline hands its systems — `nowMs`,
 *   `nextId`, `hash` (`tx.port.ts`) — and the one `FIXTURE_TODAY` pin
 *   (blueprint §7, tests Q1);
 * - in-memory port doubles for the Phase 1 ports — the read half
 *   ({@link memoryReadTx}), the single commit port ({@link memoryCommitPlan},
 *   which records every applied plan for the spec to assert), the telemetry
 *   bundle ({@link recordingTelemetry}) and the whole {@link memoryTxPorts}
 *   bundle — and the scheduling busy streams ({@link memoryLoadBusyDay},
 *   {@link memoryObserveBusyDay}): plain functions over a `Map`, never an SDK
 *   fake;
 * - port contracts as data — `testing/scheduling.port.contract.ts`, the
 *   busy cases every `LoadBusyDay`/`ObserveBusyDay` implementation runs
 *   (the successor of the application layer's `availabilityReaderBusyCases`,
 *   blueprint §7);
 * - fixtures: complete, internally consistent entities and day tables with
 *   every field present, overridable field by field, and the loyalty
 *   fixtures of `testing/loyalty.fixtures.ts` — the rhythm's rule as
 *   entities, and the two loyalty JSON files (`testing/fixtures/loyalty/`)
 *   the dev seed reads by path.
 *
 * Expected instants are literal epoch-ms constants, never computed with a
 * date library (§9 D5): zone math in a fixture goes through ZonedTimeSystem
 * like everywhere else.
 */
import { defer, of } from 'rxjs';
import { AccountStatus } from './components/account-status.data';
import { BookingStatus } from './components/booking-status.data';
import { BusyKey } from './components/busy-key.data';
import {
  BarberState,
  LocationState,
  ServiceState,
} from './components/catalog-status.data';
import { DayHours } from './components/opening-hours.data';
import { DayKey } from './components/day-key.data';
import type { DayOffset } from './components/day-offset.data';
import type { LocalizedText } from './components/localized-text.data';
import { MinuteBlock, BlockKind } from './components/minute-block.data';
import { E164 } from './components/phone-number.data';
import { PlacementKind } from './components/placement-kind.data';
import { Registration } from './components/registration.data';
import { Result } from './components/result.data';
import { Role } from './components/role.data';
import { ShiftSegment } from './components/schedule-version.data';
import type { ScheduleVersion } from './components/schedule-version.data';
import { SeatOutcome } from './components/seat-outcome.data';
import {
  Seat,
  SeatId,
  SeatRelationship,
  SeatSubject,
} from './components/seat.data';
import { ServiceTerms } from './components/service-terms.data';
import { TenantConfig } from './components/tenant-config.data';
import { TimeInterval } from './components/time-interval.data';
import { Weekday } from './components/weekday.data';
import { WriteKind } from './components/write-op.data';
import type { DocBody, DocPath, WriteOp } from './components/write-op.data';
import { ExceptionEffect } from './components/exception-effect.data';
import {
  AppointmentId,
  type AppointmentEntity,
} from './entities/appointment.entity';
import {
  BarberBusyDayId,
  type BarberBusyDayEntity,
} from './entities/barber-busy-day.entity';
import type { BarberScheduleEntity } from './entities/barber-schedule.entity';
import { BarberId, type BarberEntity } from './entities/barber.entity';
import { LocationId, type LocationEntity } from './entities/location.entity';
import {
  ScheduleExceptionId,
  type ScheduleExceptionEntity,
} from './entities/schedule-exception.entity';
import { ServiceCategoryId } from './entities/service-category.entity';
import { ServiceId, type ServiceEntity } from './entities/service.entity';
import { UserId, type UserEntity } from './entities/user.entity';
import { RepositoryError } from './components/repository-errors.data';
import type { LoadBusyDay, ObserveBusyDay } from './ports/scheduling.port';
import type { Log, TrackError } from './ports/telemetry.port';
import { Collections, QueryOp } from './ports/collections';
import type {
  CommitPlan,
  Hash,
  NextId,
  NowMs,
  QueryFilter,
  QuerySpec,
  ReadTx,
  TxPorts,
} from './ports/tx.port';
import { ZonedTimeSystem } from './systems/zoned-time.system';

/* ── The purity contract ────────────────────────────────────────────────── */

export { deepFreeze } from './testing/deep-freeze';

/* ── The port contracts and the fixture families of their own files ────── */

export * from './testing/scheduling.port.contract';
export * from './testing/loyalty.fixtures';

/* ── Result helpers ─────────────────────────────────────────────────────── */

/** The success value, or a thrown fixture failure naming the error struct. */
export function unwrapOk<T, E>(result: Result<T, E>): T {
  if (!result.ok) {
    throw new Error(
      `expected ok, got error ${JSON.stringify(result.error)} — a broken fixture`,
    );
  }
  return result.value;
}

/** The error struct, or a thrown fixture failure naming the value. */
export function unwrapErr<T, E>(result: Result<T, E>): E {
  if (result.ok) {
    throw new Error(
      `expected an error, got ok ${JSON.stringify(result.value)} — a broken fixture`,
    );
  }
  return result.error;
}

/* ── Pinned impure primitives ───────────────────────────────────────────── */

/** The tenant zone every fixture lives in (`TenantConfig.DEFAULT`). */
export const FIXTURE_ZONE: string = TenantConfig.DEFAULT.zone;

/**
 * The one "today" pin of the fixtures (blueprint §7, tests Q1 — the
 * `today: '2026-09-28'` of the legacy fixtures). A Monday in Sofia, summer
 * time (UTC+3), weeks clear of either DST switch.
 */
export const FIXTURE_TODAY: DayKey = DayKey.of('2026-09-28');

/** Local midnight of {@link FIXTURE_TODAY} in Sofia: 2026-09-27T21:00:00Z. */
export const FIXTURE_DAY_START_MS = 1_790_542_800_000;

/** The pinned wall clock: 2026-09-28 09:00 EEST = 2026-09-28T06:00:00Z. */
export const FIXTURE_NOW_MS = 1_790_575_200_000;

const MS_PER_MINUTE = 60_000;

/** A {@link NowMs} that always answers the same instant. */
export function pinnedNowMs(epochMs: number = FIXTURE_NOW_MS): NowMs {
  return () => epochMs;
}

/**
 * A {@link NowMs} that advances by `stepMs` on every read — for a pipeline
 * that stamps "started" and "finished" separately. The first read answers
 * `startMs`.
 */
export function steppingNowMs(
  startMs: number = FIXTURE_NOW_MS,
  stepMs = 1_000,
): NowMs {
  let reads = 0;
  return () => startMs + stepMs * reads++;
}

/** A {@link NextId} answering `prefix-1`, `prefix-2`, … in call order. */
export function sequentialIds(prefix = 'id'): NextId {
  let issued = 0;
  return () => `${prefix}-${++issued}`;
}

/** 32-bit FNV-1a over the UTF-16 code units, seeded per lane. */
function fnv1a(input: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * A deterministic stand-in for the production sha256-hex {@link Hash}: the
 * same shape (64 lowercase hex characters) and the same determinism, so a
 * spec can pin the ids a pipeline derives from `hash(basis)`. NOT
 * cryptographic — eight seeded FNV-1a lanes — and never production code.
 */
export const fixtureHash: Hash = (input) => {
  let out = '';
  for (let lane = 0; lane < 8; lane++) {
    out += fnv1a(input, Math.imul(lane + 1, 0x9e3779b1))
      .toString(16)
      .padStart(8, '0');
  }
  return out;
};

/* ── In-memory port doubles ─────────────────────────────────────────────── */

/**
 * The document table the doubles read and write: `path.join('/')` → body
 * (the entity minus `id`, Law 5). A plain `Map`, so a spec seeds it and
 * asserts on it directly.
 */
export type MemoryStore = Map<string, DocBody>;

/** A store seeded with documents, as `{ path, body }` pairs. */
export function memoryStore(
  documents: readonly { readonly path: DocPath; readonly body: DocBody }[] = [],
): MemoryStore {
  const store: MemoryStore = new Map();
  for (const doc of documents) store.set(pathKey(doc.path), doc.body);
  return store;
}

function pathKey(path: DocPath): string {
  return path.join('/');
}

function entityAt<E>(store: MemoryStore, path: DocPath): E | null {
  const body = store.get(pathKey(path));
  if (body === undefined) return null;
  return { id: path[path.length - 1], ...body } as E;
}

/** A field of a map by name, or `undefined` — no dynamic index. */
function own(map: object, name: string): unknown {
  return Object.getOwnPropertyDescriptor(map, name)?.value;
}

/** A dotted component path (`bookingStatus.kind`) read off a body. */
function fieldAt(body: DocBody, field: string): unknown {
  let current: unknown = body;
  for (const part of field.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = own(current, part);
  }
  return current;
}

/** Firestore value equality: deep, key-order independent for maps. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    a === null ||
    b === null
  ) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aEntries = Object.entries(a);
  if (aEntries.length !== Object.keys(b).length) return false;
  for (const [key, value] of aEntries) {
    if (!Object.hasOwn(b, key) || !sameValue(value, own(b, key))) return false;
  }
  return true;
}

/** Firestore's cross-type order, reduced to the types components store. */
function typeRank(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'boolean') return 1;
  if (typeof value === 'number') return 2;
  if (typeof value === 'string') return 3;
  if (Array.isArray(value)) return 4;
  return 5;
}

function compareValues(a: unknown, b: unknown): number {
  const rank = typeRank(a) - typeRank(b);
  if (rank !== 0) return rank;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return Number(a) - Number(b);
  }
  return 0;
}

function includesValue(list: unknown, value: unknown): boolean {
  return Array.isArray(list) && list.some((item) => sameValue(item, value));
}

function matches(body: DocBody, filter: QueryFilter): boolean {
  const actual = fieldAt(body, filter.field);
  switch (filter.op) {
    case QueryOp.Eq:
      return sameValue(actual, filter.value);
    case QueryOp.Ne:
      return actual !== undefined && !sameValue(actual, filter.value);
    case QueryOp.Lt:
      return (
        typeRank(actual) === typeRank(filter.value) &&
        compareValues(actual, filter.value) < 0
      );
    case QueryOp.Lte:
      return (
        typeRank(actual) === typeRank(filter.value) &&
        compareValues(actual, filter.value) <= 0
      );
    case QueryOp.Gt:
      return (
        typeRank(actual) === typeRank(filter.value) &&
        compareValues(actual, filter.value) > 0
      );
    case QueryOp.Gte:
      return (
        typeRank(actual) === typeRank(filter.value) &&
        compareValues(actual, filter.value) >= 0
      );
    case QueryOp.ArrayContains:
      return includesValue(actual, filter.value);
    case QueryOp.ArrayContainsAny:
      return (
        Array.isArray(filter.value) &&
        filter.value.some((wanted) => includesValue(actual, wanted))
      );
    case QueryOp.In:
      return includesValue(filter.value, actual);
    case QueryOp.NotIn:
      return actual !== undefined && !includesValue(filter.value, actual);
  }
}

function runQuery(store: MemoryStore, spec: QuerySpec): readonly DocPath[] {
  const prefix = `${pathKey(spec.collection)}/`;
  const hits: { readonly path: DocPath; readonly body: DocBody }[] = [];
  for (const [key, body] of store) {
    if (!key.startsWith(prefix)) continue;
    const id = key.slice(prefix.length);
    if (id.length === 0 || id.includes('/')) continue;
    if (spec.where.every((filter) => matches(body, filter))) {
      hits.push({ path: [...spec.collection, id], body });
    }
  }
  hits.sort((a, b) => {
    for (const order of spec.orderBy) {
      const c = compareValues(
        fieldAt(a.body, order.field),
        fieldAt(b.body, order.field),
      );
      if (c !== 0) return order.descending ? -c : c;
    }
    const ka = pathKey(a.path);
    const kb = pathKey(b.path);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  const limited = spec.limit === null ? hits : hits.slice(0, spec.limit);
  return limited.map((hit) => hit.path);
}

/** A {@link ReadTx} over a store that also records what it was asked. */
export type MemoryReadTx = ReadTx & {
  /** Every path read by `get`/`getAll`, in order (absent documents too). */
  readonly reads: readonly DocPath[];
  /** Every query asked, in order. */
  readonly queries: readonly QuerySpec[];
};

/**
 * The read half over a store. Absent documents answer `null`, exactly as
 * the transaction does; a query answers entities (`{ id, ...body }`) in the
 * query's order, ties broken by path.
 */
export function memoryReadTx(store: MemoryStore): MemoryReadTx {
  const reads: DocPath[] = [];
  const queries: QuerySpec[] = [];
  return {
    reads,
    queries,
    get: async <E>(path: DocPath) => {
      reads.push(path);
      return entityAt<E>(store, path);
    },
    getAll: async <E>(paths: readonly DocPath[]) => {
      reads.push(...paths);
      return paths.map((path) => entityAt<E>(store, path));
    },
    query: async <E>(spec: QuerySpec) => {
      queries.push(spec);
      return runQuery(store, spec).map((path) => entityAt<E>(store, path) as E);
    },
  };
}

/**
 * Merges an update's field map at the ROOT, as the transaction adapter
 * does: each key is one root field by its literal name (Law 5: writes
 * target root fields, never dot paths) — a `.` in a key is a character.
 */
function mergeFields(body: DocBody, fields: DocBody): DocBody {
  return { ...body, ...fields };
}

/**
 * A plan staged against a store: the bodies it would leave (`null` = deleted),
 * or the first `Create` that met a document already there.
 */
type StagedPlan =
  | { readonly conflict: null; readonly staged: Map<string, DocBody | null> }
  | { readonly conflict: string };

/**
 * Stages a write plan without touching the store, seeing its own earlier
 * writes. A `Create` over an existing document stops the staging as the
 * plan's conflict (Firestore's ALREADY_EXISTS); an `Update` of an absent
 * one throws (NOT_FOUND — an infrastructure failure, never a value).
 */
function stageWrites(
  store: MemoryStore,
  writes: readonly WriteOp[],
): StagedPlan {
  const staged = new Map<string, DocBody | null>();
  const current = (key: string): DocBody | null =>
    staged.has(key)
      ? (staged.get(key) as DocBody | null)
      : (store.get(key) ?? null);
  for (const op of writes) {
    const key = pathKey(op.path);
    switch (op.kind) {
      case WriteKind.Set:
        staged.set(key, op.body);
        break;
      case WriteKind.Create:
        if (current(key) !== null) return { conflict: key };
        staged.set(key, op.body);
        break;
      case WriteKind.Update: {
        const existing = current(key);
        if (existing === null) {
          throw new Error(`NOT_FOUND: ${key} — the plan was not applied`);
        }
        staged.set(key, mergeFields(existing, op.fields));
        break;
      }
      case WriteKind.Delete:
        staged.set(key, null);
        break;
    }
  }
  return { conflict: null, staged };
}

/** Writes a staged plan through to the store. */
function commitStaged(
  store: MemoryStore,
  staged: ReadonlyMap<string, DocBody | null>,
): void {
  for (const [key, body] of staged) {
    if (body === null) store.delete(key);
    else store.set(key, body);
  }
}

/**
 * Applies a write plan to a store all-or-nothing, with the transaction's
 * own failures: `create` over an existing document and `update` of an
 * absent one reject the whole plan (Firestore's ALREADY_EXISTS / NOT_FOUND),
 * leaving the store untouched. ({@link memoryCommitPlan} answers the
 * ALREADY_EXISTS as a value instead, as the `CommitPlan` port says.)
 */
export function applyWrites(
  store: MemoryStore,
  writes: readonly WriteOp[],
): void {
  const plan = stageWrites(store, writes);
  if (plan.conflict !== null) {
    throw new Error(
      `ALREADY_EXISTS: ${plan.conflict} — the plan was not applied`,
    );
  }
  commitStaged(store, plan.staged);
}

/** A {@link CommitPlan} double and the record of what reached it. */
export type MemoryCommit = {
  readonly commit: CommitPlan;
  /** Every APPLIED plan, in commit order — a refused decision adds none. */
  readonly plans: readonly (readonly WriteOp[])[];
  /** The read set of every attempt, in order. */
  readonly transactions: readonly MemoryReadTx[];
};

/**
 * The single commit port over a store (the in-memory sibling of the
 * functions' `FakeProjectionFirestore`, blueprint §7): runs `read` against a
 * {@link memoryReadTx}, hands the snapshot to the pure `decide`, applies the
 * returned plan atomically and answers the decision without its plan. A
 * refusal writes nothing. A `Create` over an existing document answers
 * `RepositoryError.alreadyExists(path)` as a VALUE and applies nothing, as
 * the `CommitPlan` port and the Firestore adapter do; an `Update` of an
 * absent document (NOT_FOUND) rejects the promise, the way an
 * infrastructure failure does.
 */
export function memoryCommitPlan(store: MemoryStore): MemoryCommit {
  const plans: (readonly WriteOp[])[] = [];
  const transactions: MemoryReadTx[] = [];
  const commit: CommitPlan = async <S, D, E>(
    read: (tx: ReadTx) => Promise<S>,
    decide: (
      snapshot: S,
    ) => Result<D & { readonly writes: readonly WriteOp[] }, E>,
  ): Promise<Result<D, E | RepositoryError>> => {
    const tx = memoryReadTx(store);
    transactions.push(tx);
    const decision = decide(await read(tx));
    if (!decision.ok) return decision;
    const { writes, ...rest } = decision.value;
    const plan = stageWrites(store, writes);
    if (plan.conflict !== null) {
      return Result.err(RepositoryError.alreadyExists(plan.conflict));
    }
    commitStaged(store, plan.staged);
    plans.push(writes);
    // `rest` is the decision minus its plan — `D` exactly, which the
    // spread's `Omit` cannot prove for a generic `D`.
    return Result.ok(rest as unknown as D);
  };
  return { commit, plans, transactions };
}

/** The pinned transaction bundle over a store, plus the commit record. */
export function memoryTxPorts(
  store: MemoryStore,
  options: Partial<Pick<TxPorts, 'nowMs' | 'nextId' | 'hash'>> = {},
): TxPorts & Pick<MemoryCommit, 'plans' | 'transactions'> {
  const { commit, plans, transactions } = memoryCommitPlan(store);
  return {
    commit,
    plans,
    transactions,
    nowMs: options.nowMs ?? pinnedNowMs(),
    nextId: options.nextId ?? sequentialIds(),
    hash: options.hash ?? fixtureHash,
  };
}

/** One recorded `log` call. */
export type LoggedLine = {
  readonly level: 'info' | 'warn' | 'error';
  readonly msg: string;
  readonly fields: Record<string, unknown> | null;
};

/** One recorded `trackError` call. */
export type TrackedError = {
  readonly error: unknown;
  readonly context: Record<string, unknown> | null;
};

/** The telemetry bundle as recording doubles. */
export function recordingTelemetry(): {
  readonly log: Log;
  readonly trackError: TrackError;
  readonly lines: readonly LoggedLine[];
  readonly errors: readonly TrackedError[];
} {
  const lines: LoggedLine[] = [];
  const errors: TrackedError[] = [];
  return {
    lines,
    errors,
    log: (level, msg, fields) => {
      lines.push({ level, msg, fields: fields ?? null });
    },
    trackError: (error, context) => {
      errors.push({ error, context: context ?? null });
    },
  };
}

/**
 * `loadBusyDay` — the server's busy read (`scheduling.port.ts`) — over a
 * store: `barberBusy/{key}` as the entity, `null` when the day holds
 * nothing. Exactly the stored document: no padding, no merging, no
 * release — availability is derived by the caller, never behind the port
 * (blueprint §4.2). The in-memory runner of `schedulingPortsContract`.
 */
export function memoryLoadBusyDay(store: MemoryStore): LoadBusyDay {
  return async (key) =>
    Result.ok(
      entityAt<BarberBusyDayEntity>(store, [Collections.BarberBusy, key]),
    );
}

/**
 * `observeBusyDay` — the browser's busy stream — over a store: ONE
 * emission of the day as stored when subscribed, then complete. A later
 * write to the store is not re-emitted; a spec that needs the second
 * emission subscribes again.
 */
export function memoryObserveBusyDay(store: MemoryStore): ObserveBusyDay {
  return (key) =>
    defer(() =>
      of<Result<BarberBusyDayEntity | null, RepositoryError>>(
        Result.ok(
          entityAt<BarberBusyDayEntity>(store, [Collections.BarberBusy, key]),
        ),
      ),
    );
}

/* ── Fixture builders ───────────────────────────────────────────────────── */

/**
 * The day table a pipeline would build once per request, through
 * ZonedTimeSystem like every caller. Throws on an empty table (an unknown
 * zone or an inverted range is a broken fixture, not a case).
 */
export function dayTableFixture(
  fromDayKey: string = FIXTURE_TODAY,
  toDayKey: string = fromDayKey,
  zone: string = FIXTURE_ZONE,
): readonly DayOffset[] {
  const days = ZonedTimeSystem.dayTable(
    zone,
    DayKey.of(fromDayKey),
    DayKey.of(toDayKey),
  );
  if (days.length === 0) {
    throw new Error(
      `no day table for ${zone} ${fromDayKey}..${toDayKey} — a broken fixture`,
    );
  }
  return days;
}

/** The instant of a local wall-clock minute on {@link FIXTURE_TODAY}. */
export function fixtureTodayAt(hours: number, minutes = 0): number {
  return FIXTURE_DAY_START_MS + (hours * 60 + minutes) * MS_PER_MINUTE;
}

/** The ids every builder defaults to, so fixtures cross-reference. */
export const FIXTURE_IDS = {
  barber: BarberId.of('b-ivan'),
  location: LocationId.of('loc-center'),
  service: ServiceId.of('svc-classic-cut'),
  category: ServiceCategoryId.of('cat-cuts'),
  client: UserId.of('u-client'),
  appointment: AppointmentId.of('appt-1'),
  seat: SeatId.of('seat-1'),
} as const;

/** Bilingual text with both locales filled. */
export function textFixture(en: string, bg: string = en): LocalizedText {
  return { bg, en };
}

/** The classic cut: 28,00 €, 30 minutes, no pads. */
export const FIXTURE_TERMS: ServiceTerms = ServiceTerms.unpadded(
  2800,
  'EUR',
  30,
);

/** A booked seat: the client's own classic cut with Ivan at 10:00 today. */
export function seatFixture(overrides: Partial<Seat> = {}): Seat {
  return {
    id: FIXTURE_IDS.seat,
    serviceId: FIXTURE_IDS.service,
    variantId: null,
    barberId: FIXTURE_IDS.barber,
    barberPref: null,
    terms: Seat.termsOf(FIXTURE_TERMS, FIXTURE_TERMS),
    startMs: fixtureTodayAt(10),
    subject: SeatSubject.account(FIXTURE_IDS.client, SeatRelationship.Self),
    outcome: SeatOutcome.scheduled(),
    tip: null,
    ...overrides,
  };
}

/**
 * A confirmed one-seat appointment consistent with its seat: the interval,
 * the barber list and the busy key are derived from {@link seatFixture}, so
 * override the seats and the derived fields together.
 */
export function appointmentFixture(
  overrides: Partial<AppointmentEntity> = {},
): AppointmentEntity {
  const seat = seatFixture();
  return {
    id: FIXTURE_IDS.appointment,
    locationId: FIXTURE_IDS.location,
    ownerUserId: FIXTURE_IDS.client,
    subjectUserIds: [FIXTURE_IDS.client],
    placement: PlacementKind.Self,
    inferredPlacement: null,
    barberIds: [seat.barberId],
    busyKeys: [BusyKey.of(seat.barberId, FIXTURE_TODAY)],
    timeInterval: TimeInterval.of(seat.startMs, Seat.endMs(seat)),
    zone: FIXTURE_ZONE,
    bookingStatus: BookingStatus.confirm(FIXTURE_NOW_MS - 86_400_000),
    seats: [seat],
    contact: null,
    bookedAtMs: FIXTURE_NOW_MS - 86_400_000,
    arrivedAtMs: null,
    bookedFromAppointmentId: null,
    discounts: [],
    voucherRedemptions: [],
    revision: 1,
    appliedOperations: [],
    stoodSeatPairs: null,
    ...overrides,
  };
}

/** Ivan, active, working at the centre shop. */
export function barberFixture(
  overrides: Partial<BarberEntity> = {},
): BarberEntity {
  return {
    id: FIXTURE_IDS.barber,
    name: textFixture('Ivan', 'Иван'),
    handle: 'ivan',
    title: textFixture('Barber', 'Бръснар'),
    bio: textFixture('Classic cuts.', 'Класически подстрижки.'),
    avatar: null,
    yearsExperience: 8,
    locationIds: [FIXTURE_IDS.location],
    instagramHandle: null,
    status: BarberState.Active,
    sortOrder: 0,
    ...overrides,
  };
}

/** The centre shop, open 09:00–19:00 Monday to Saturday, closed Sunday. */
export function locationFixture(
  overrides: Partial<LocationEntity> = {},
): LocationEntity {
  const weekday = DayHours.open(9 * 60, 19 * 60);
  return {
    id: FIXTURE_IDS.location,
    name: textFixture('Centre', 'Център'),
    shortName: null,
    address: textFixture('1 Vitosha Blvd, Sofia', 'бул. Витоша 1, София'),
    geo: { lat: 42.6977, lng: 23.3219 },
    phone: { e164: E164.of('+35921234567'), display: '02 123 4567' },
    mapUrl: null,
    cover: null,
    photos: [],
    openingHours: [
      weekday,
      weekday,
      weekday,
      weekday,
      weekday,
      weekday,
      DayHours.closed(),
    ],
    zone: FIXTURE_ZONE,
    status: LocationState.Active,
    sortOrder: 0,
    ...overrides,
  };
}

/** The classic cut, offered by Ivan at the catalogue terms. */
export function serviceFixture(
  overrides: Partial<ServiceEntity> = {},
): ServiceEntity {
  return {
    id: FIXTURE_IDS.service,
    name: textFixture('Classic cut', 'Класическо подстригване'),
    description: textFixture('Scissors and clippers.', 'Ножица и машинка.'),
    categoryId: FIXTURE_IDS.category,
    baseTerms: FIXTURE_TERMS,
    variants: [],
    offerings: [
      { barberId: FIXTURE_IDS.barber, base: FIXTURE_TERMS, overrides: [] },
    ],
    cover: null,
    locationIds: [FIXTURE_IDS.location],
    conflictsWith: [],
    composition: null,
    upsellOnly: false,
    popular: false,
    status: ServiceState.Active,
    sortOrder: 0,
    ...overrides,
  };
}

/** A registered, active client with a phone and nothing else optional. */
export function userFixture(overrides: Partial<UserEntity> = {}): UserEntity {
  return {
    id: FIXTURE_IDS.client,
    registration: Registration.registered(),
    phone: E164.of('+359888123456'),
    firstName: 'Maria',
    lastName: 'Petrova',
    roles: [Role.Client],
    accountStatus: AccountStatus.active(),
    email: null,
    birthDate: null,
    searchName: 'maria petrova',
    searchPrefixes: ['m', 'ma', 'mar', 'p', 'pe', 'pet'],
    ...overrides,
  };
}

/**
 * Ivan's schedule: one open-ended version from 2026-01-01, 09:00–18:00 at the
 * centre shop Monday to Friday.
 */
export function barberScheduleFixture(
  overrides: Partial<BarberScheduleEntity> = {},
): BarberScheduleEntity {
  const workdays: readonly Weekday[] = [
    Weekday.Mon,
    Weekday.Tue,
    Weekday.Wed,
    Weekday.Thu,
    Weekday.Fri,
  ];
  const version: ScheduleVersion = {
    seq: 1,
    effectiveFromDayKey: DayKey.of('2026-01-01'),
    effectiveToDayKey: null,
    segments: workdays.map((day) =>
      ShiftSegment.of(day, FIXTURE_IDS.location, 9 * 60, 18 * 60),
    ),
  };
  return {
    id: FIXTURE_IDS.barber,
    turnaroundMinutes: 0,
    versions: [version],
    ...overrides,
  };
}

/** Ivan's busy day today: the fixture seat's 10:00–10:30 block. */
export function barberBusyDayFixture(
  overrides: Partial<BarberBusyDayEntity> = {},
): BarberBusyDayEntity {
  return {
    id: BarberBusyDayId.of(BusyKey.of(FIXTURE_IDS.barber, FIXTURE_TODAY)),
    barberId: FIXTURE_IDS.barber,
    dayKey: FIXTURE_TODAY,
    zone: FIXTURE_ZONE,
    blocks: [MinuteBlock.of(10 * 60, 10 * 60 + 30, BlockKind.Busy)],
    ...overrides,
  };
}

/** Ivan off for the whole of today — the public effect only (§9 D16(b)). */
export function scheduleExceptionFixture(
  overrides: Partial<ScheduleExceptionEntity> = {},
): ScheduleExceptionEntity {
  return {
    id: ScheduleExceptionId.of('exc-1'),
    barberId: FIXTURE_IDS.barber,
    dayKey: FIXTURE_TODAY,
    zone: FIXTURE_ZONE,
    locationId: FIXTURE_IDS.location,
    effect: ExceptionEffect.closed(),
    ...overrides,
  };
}
