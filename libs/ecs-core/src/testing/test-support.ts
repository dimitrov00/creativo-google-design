/**
 * Test support only, reached through `@core/testing` (`testing/index.ts`,
 * Law 8) — specs import it, production code never may (the root
 * `no-restricted-imports` testing-entry-point guard). Inside the testing
 * folder, siblings import this file as `./test-support`.
 *
 * Five families, each a plain function — no classes, no module state:
 *
 * - the purity contract's {@link deepFreeze} (`ecs-systems.md` spec contract);
 * - the pinned impure primitives a pipeline hands its systems — `nowUtcMs`,
 *   `nextId`, `hash` (`tx.port.ts`) — the one `FIXTURE_TODAY` pin
 *   (blueprint §7, tests Q1) and the shop's `FIXTURE_NOW` (a `ShopNow`);
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
 * - fixtures: complete, internally consistent FLAT entities (Law 6) with
 *   every field present, overridable field by field, one file per group
 *   (`testing/{booking-core,appointment,booking-flow,identity,loyalty}.fixtures.ts`,
 *   flatten-spec §8.1), plus the two loyalty JSON files
 *   (`testing/fixtures/loyalty/`) the dev seed reads by path.
 *
 * Expected instants come from `utcMs(…)` (ISO with an offset, through
 * ZonedTimeSystem), never from a date library or `Date` (§9 D5, L4).
 */
import {
  type LocalizedText,
  ShopNow,
  WriteAction,
  type DocBody,
  type DocPath,
  type WriteOp,
} from '@core/components';
import {
  Result,
  AppointmentId,
  BarberId,
  CustomerId,
  LocationId,
  SeatId,
  ServiceCategoryId,
  ServiceId,
  UserId,
  LocalDate,
  EndMinute,
  MinuteOfDay,
  type TimeZone,
  UtcEpochMs,
} from '@core/primitives';
import { RepositoryError } from '@core/errors';
import type {
  ClockPorts,
  CommitPlan,
  Hash,
  HashPorts,
  IdPorts,
  Log,
  NextId,
  NowUtcMs,
  QueryFilter,
  QuerySpec,
  ReadTx,
  TrackError,
  TxPorts,
} from '@core/ports';
import { QueryOp } from '@core/entities';
import { ZonedTimeSystem } from '@core/systems';

/* ── The purity contract ────────────────────────────────────────────────── */

/* ── The port contracts and the fixture families of their own files ────── */

/* ── Type-level helpers for the entity type-specs (flatten-spec §7, L2) ─── */

/**
 * `true` per field when it is a primitive (brands included), an array or a
 * `LocalizedText` (F-7) — nullable or optional allowed; `false` for a nested
 * struct (`Contact | null`, an object literal). An entity type-spec asserts
 * `AllTrue<NoNested<V>>` for EVERY variant of the archetype (Law 6.1).
 */
export type NoNested<E> = {
  [K in keyof E]-?: [NonNullable<E[K]>] extends [
    string | number | boolean | bigint,
  ]
    ? true
    : [NonNullable<E[K]>] extends [readonly unknown[]]
      ? true
      : [NonNullable<E[K]>] extends [LocalizedText]
        ? true
        : false;
};

/** `true` when every member of `T` is `true`. */
export type AllTrue<T> = T[keyof T] extends true ? true : false;

/** `keyof` of a union is only the shared keys; this is every variant's keys. */
export type KeysOfUnion<T> = T extends unknown ? keyof T : never;

/** `true` when two slices share no field name (Law 6.3). */
export type Disjoint<A, B> = [KeysOfUnion<A> & KeysOfUnion<B>] extends [never]
  ? true
  : false;

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

/* ── Branded literals (test-only: a bad literal is a broken fixture) ───── */

/** A `LocalDate` literal — `localDate('2026-10-07')`; throws on a non-day. */
export function localDate(raw: string): LocalDate {
  return unwrapOk(LocalDate.parse(raw));
}

/** A `MinuteOfDay` literal — `minute(600)` is 10:00; throws outside `[0, 1440)`. */
export function minute(raw: number): MinuteOfDay {
  return unwrapOk(MinuteOfDay.of(raw));
}

/** An `EndMinute` literal — `endMinute(1440)` is the closing midnight; throws outside `(0, 1440]`. */
export function endMinute(raw: number): EndMinute {
  return unwrapOk(EndMinute.of(raw));
}

/**
 * A `UtcEpochMs` literal from ISO-8601 WITH an offset —
 * `utcMs('2026-09-28T09:00:00+03:00')`; throws on an offset-less string.
 * The way a spec names an instant without `Date.parse` (L4).
 */
export function utcMs(isoWithOffset: string): UtcEpochMs {
  return unwrapOk(ZonedTimeSystem.parseOffsetIso(isoWithOffset));
}

/* ── Pinned impure primitives ───────────────────────────────────────────── */

/** The zone every fixture shop lives in — the centre shop's `timeZone`. */
export const FIXTURE_TIME_ZONE: TimeZone = unwrapOk(
  ZonedTimeSystem.checkZone('Europe/Sofia'),
);

/**
 * The one "today" pin of the fixtures (blueprint §7, tests Q1 — the
 * `today: '2026-09-28'` of the legacy fixtures). A Monday in Sofia, summer
 * time (UTC+3), weeks clear of either DST switch. Keeps its name for the
 * frozen consumers (flatten-spec §0.1); typed `LocalDate`, still a `string`.
 */
export const FIXTURE_TODAY: LocalDate = localDate('2026-09-28');

/** The pinned clock: 2026-09-28 09:00 EEST = 2026-09-28T06:00:00Z. */
export const FIXTURE_NOW_UTC_MS: UtcEpochMs = utcMs(
  '2026-09-28T09:00:00.000+03:00',
);

/**
 * The pinned "now" as the fixture shop sees it — {@link FIXTURE_TODAY} at
 * 09:00 (`currentMinute: 540`), the instant {@link FIXTURE_NOW_UTC_MS}.
 */
export const FIXTURE_NOW: ShopNow = ZonedTimeSystem.shopNow(
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
);

/** A {@link NowUtcMs} that always answers the same instant. */
export function pinnedNowUtcMs(
  utcEpochMs: UtcEpochMs = FIXTURE_NOW_UTC_MS,
): NowUtcMs {
  return () => utcEpochMs;
}

/**
 * A {@link NowUtcMs} that advances by `stepMs` on every read — for a pipeline
 * that stamps "started" and "finished" separately. The first read answers
 * `startUtcMs`.
 */
export function steppingNowUtcMs(
  startUtcMs: UtcEpochMs = FIXTURE_NOW_UTC_MS,
  stepMs = 1_000,
): NowUtcMs {
  let reads = 0;
  return () => UtcEpochMs.plusMs(startUtcMs, stepMs * reads++);
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

/**
 * The client record of an account, DERIVED the way the pipelines derive it
 * — `CustomerId.forUser(uid, hash)` over {@link fixtureHash} (D29) — so a
 * spec never casts a uid into a `CustomerId`.
 */
export function customerOf(userId: UserId): CustomerId {
  return CustomerId.forUser(userId, fixtureHash);
}

/**
 * The resolved-record map a booking or edit decision takes
 * (`DecideBookingContext.customerIds`, `FoldContext.customerIds`): each
 * account → {@link customerOf} it.
 */
export function resolvedCustomerIds(
  userIds: readonly UserId[],
): ReadonlyMap<UserId, CustomerId> {
  const out = new Map<UserId, CustomerId>();
  for (const userId of userIds) out.set(userId, customerOf(userId));
  return out;
}

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

/**
 * A `where`/`orderBy` field read off a body. A field is a ROOT key of the
 * flat document (`bookingStatus`, `utcEpochMs` — Laws 5 and 6), read first
 * and as is. A dotted path (`status.kind`) is walked only when the body has
 * no root key of that exact name: the legacy bridge for a collection whose
 * 3b flip has not landed yet (`tx.port.ts`), deleted with the last flip —
 * as the fake projection store's `valueAt` already says. On a flattened
 * collection a pre-flatten dotted query walks into a root SCALAR and finds
 * nothing, so query the root key there.
 */
function fieldAt(body: DocBody, field: string): unknown {
  if (Object.hasOwn(body, field)) return own(body, field);
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
 * Merges an update at the ROOT, as the transaction adapter does: each key of
 * `fields` is one root field by its literal name (Law 5: writes target root
 * fields, never dot paths — a `.` in a key is a character), and each key of
 * `deleteFields` is removed (`FieldValue.delete()`).
 */
function mergeFields(
  body: DocBody,
  fields: DocBody,
  deleteFields: readonly string[],
): DocBody {
  return Object.fromEntries(
    Object.entries({ ...body, ...fields }).filter(
      ([key]) => !deleteFields.includes(key),
    ),
  );
}

/** The first key an `Update` both sets and deletes, or `null` (one per plan is enough). */
function setAndDeleted(op: WriteOp.Update): string | null {
  for (const key of op.deleteFields) {
    if (Object.hasOwn(op.fields, key)) return key;
  }
  return null;
}

/**
 * A plan staged against a store: the bodies it would leave (`null` = deleted),
 * or the refusal of the whole plan — the first `Create` that met a document
 * already there, or an `Update` naming one key in both lists.
 */
type StagedPlan =
  | { readonly refusal: null; readonly staged: Map<string, DocBody | null> }
  | { readonly refusal: RepositoryError };

/**
 * Stages a write plan without touching the store, seeing its own earlier
 * writes. A `Create` over an existing document stops the staging as the
 * plan's refusal (Firestore's ALREADY_EXISTS → `REPOSITORY_ALREADY_EXISTS`),
 * and so does an `Update` that sets and deletes one key
 * (`writeFailed(path, 'field-set-and-deleted')`); an `Update` of an absent
 * document throws (NOT_FOUND — an infrastructure failure, never a value).
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
    switch (op.writeAction) {
      case WriteAction.Set:
        staged.set(key, op.body);
        break;
      case WriteAction.Create:
        if (current(key) !== null) {
          return { refusal: RepositoryError.alreadyExists(key) };
        }
        staged.set(key, op.body);
        break;
      case WriteAction.Update: {
        if (setAndDeleted(op) !== null) {
          return {
            refusal: RepositoryError.writeFailed(key, FIELD_SET_AND_DELETED),
          };
        }
        const existing = current(key);
        if (existing === null) {
          throw new Error(`NOT_FOUND: ${key} — the plan was not applied`);
        }
        staged.set(key, mergeFields(existing, op.fields, op.deleteFields));
        break;
      }
      case WriteAction.Delete:
        staged.set(key, null);
        break;
    }
  }
  return { refusal: null, staged };
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

/** The reason a plan that sets and deletes one key is refused with — every adapter and double. */
export const FIELD_SET_AND_DELETED = 'field-set-and-deleted';

/**
 * Applies a write plan to a store all-or-nothing, answering like the
 * `CommitPlan` port and the Firestore adapter: a `Create` over an existing
 * document is `REPOSITORY_ALREADY_EXISTS` and a key both set and deleted is
 * `writeFailed(path, 'field-set-and-deleted')` — VALUES, with the store
 * untouched. An `Update` of an absent document throws (NOT_FOUND), the way an
 * infrastructure failure rejects.
 */
export function applyWrites(
  store: MemoryStore,
  writes: readonly WriteOp[],
): Result<void, RepositoryError> {
  const plan = stageWrites(store, writes);
  if (plan.refusal !== null) return Result.err(plan.refusal);
  commitStaged(store, plan.staged);
  return Result.ok(undefined);
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
 * the `CommitPlan` port and the Firestore adapter do, and so does an
 * `Update` that sets and deletes one key (`field-set-and-deleted`); an `Update` of an
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
    if (plan.refusal !== null) return Result.err(plan.refusal);
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
  options: Partial<HashPorts & IdPorts & ClockPorts> = {},
): TxPorts & Pick<MemoryCommit, 'plans' | 'transactions'> {
  const { commit, plans, transactions } = memoryCommitPlan(store);
  return {
    commit,
    plans,
    transactions,
    nowUtcMs: options.nowUtcMs ?? pinnedNowUtcMs(),
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

/* ── Fixture builders ───────────────────────────────────────────────────── */

/** The ids every builder defaults to, so fixtures cross-reference. */
export const FIXTURE_IDS = {
  barber: BarberId.of('b-ivan'),
  location: LocationId.of('loc-center'),
  service: ServiceId.of('svc-classic-cut'),
  category: ServiceCategoryId.of('cat-cuts'),
  client: UserId.of('u-client'),
  /**
   * The client record of `client` (D29) — DERIVED the way the pipelines do
   * ({@link customerOf}), never a cast.
   */
  customer: customerOf(UserId.of('u-client')),
  appointment: AppointmentId.of('appt-1'),
  seat: SeatId.of('seat-1'),
} as const;

/** Bilingual text with both locales filled. */
export function textFixture(en: string, bg: string = en): LocalizedText {
  return { bg, en };
}
