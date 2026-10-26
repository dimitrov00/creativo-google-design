import {
  FieldPath,
  FieldValue,
  type Firestore,
} from 'firebase-admin/firestore';
import type { Result } from '@core/primitives';
import type { RepositoryError } from '@core/errors';
import type { DocPath, WriteOp } from '@core/components';
import type { CommitPlan, QuerySpec, ReadTx } from '@core/ports';
import { firestoreCommitPlan } from '../adapters/firestore-tx.adapter';

/**
 * An in-memory double for the slice of the Admin Firestore SDK the client
 * projections, the backfill and the transaction adapter use: documents by
 * PATH (subcollections included), `db.doc(path)`, queries with the whole
 * `QueryOp` vocabulary over ROOT fields (a dotted path is refused, Law 5),
 * `orderBy` (a root field, either direction, or the document id), `limit` /
 * `startAfter` / `select`, batched reads by reference (`getAll`),
 * transactions and batches.
 *
 * Every transaction runs once — contention and retries are the emulator
 * suite's business — and is ATOMIC like the SDK's: its writes are staged
 * and applied together when the callback resolves, or not at all when it
 * throws. `create` — in a transaction or a batch — is the Admin SDK's: it
 * fails with ALREADY_EXISTS (gRPC 6) when the path is taken, and the
 * transaction or batch holding it writes nothing at all, which is what the
 * audit writer's exactly-once rows rest on. A `FieldPath` update
 * (`update(ref, path, value, …)`) writes ROOT fields only — a
 * multi-segment path is refused (Law 5: never dot paths), a
 * `FieldValue.delete()` value removes that root field (how a variant
 * transition's `deleteFields` reach the store, Law 6) — and of an absent
 * document fails with NOT_FOUND (gRPC 5), as the SDK's does. It is the one
 * update form the transaction adapter writes, so the object form
 * (`update(ref, patch)`) is not modelled: it is refused. `failHistoryOf`
 * makes the history read of one subject reject, which is how a spec gets
 * one person's recompute to fail while everybody else's succeeds.
 *
 * It is also the `CommitPlan` double of the pipeline specs (blueprint §7):
 * `commit` is the production transaction adapter (`firestore-tx.adapter.ts`)
 * over this store — it hands the read callback a `ReadTx` only, and
 * `plans` records every APPLIED `WriteOp[]` plan (a refusal or an
 * ALREADY_EXISTS conflict adds none) while `transactions` records each
 * attempt's read set, so a spec asserts the plan and the reads, never this
 * double's internals.
 */
type Data = Record<string, unknown>;

interface Snapshot {
  readonly id: string;
  readonly exists: boolean;
  readonly ref: DocRef;
  data(): Data | undefined;
  get(field: string): unknown;
}

interface DocRef {
  readonly kind: 'doc';
  readonly path: string;
  readonly id: string;
  collection(name: string): CollectionRef;
  get(): Promise<Snapshot>;
  set(data: Data): Promise<void>;
  /** Refuses with ALREADY_EXISTS when the document is already there. */
  create(data: Data): Promise<void>;
}

interface Ordering {
  /** A field name or `FieldPath`, or `FieldPath.documentId()`. */
  readonly field: unknown;
  readonly descending: boolean;
}

interface QueryState {
  readonly path: string;
  readonly filters: readonly ((id: string, data: Data) => boolean)[];
  readonly orders: readonly Ordering[];
  readonly limit: number | null;
  readonly after: string | null;
  /** The `array-contains` value, when there is one — a subject's history. */
  readonly contains: string | null;
}

interface Query {
  readonly kind: 'query';
  readonly state: QueryState;
  where(field: unknown, op: string, value: unknown): Query;
  orderBy(field: unknown, direction?: 'asc' | 'desc'): Query;
  limit(n: number): Query;
  startAfter(id: string): Query;
  select(): Query;
  get(): Promise<{ docs: Snapshot[]; size: number; empty: boolean }>;
}

interface CollectionRef extends Query {
  doc(id: string): DocRef;
}

/** One write a transaction staged, applied with the rest when it resolves. */
type Staged =
  | { readonly stagedWrite: 'SET'; readonly path: string; readonly data: Data }
  | {
      readonly stagedWrite: 'CREATE';
      readonly path: string;
      readonly data: Data;
    }
  /** The SDK's `update(ref, fieldPath, value, …)`: the document must exist. */
  | {
      readonly stagedWrite: 'UPDATE';
      readonly path: string;
      readonly fields: readonly (readonly [readonly string[], unknown])[];
    }
  | { readonly stagedWrite: 'DELETE'; readonly path: string };

/** A `ReadTx` that also records what it was asked, in order. */
export type RecordedReadTx = ReadTx & {
  /** Every path read by `get`/`getAll` (absent documents too). */
  readonly reads: readonly DocPath[];
  /** Every query asked. */
  readonly queries: readonly QuerySpec[];
};

const lastSegment = (path: string): string => path.split('/').pop() ?? '';

/**
 * The Admin SDK's refusal of a `create()` onto an existing document, in the
 * emulator's own words — so the transaction adapter names the document from
 * this double exactly as it does from the emulator.
 */
function alreadyExists(path: string): Error {
  return Object.assign(
    new Error(
      `6 ALREADY_EXISTS: entity already exists: EntityRef[partitionRef=fake, path=/${path}]`,
    ),
    { code: 6 },
  );
}

/** The Admin SDK's refusal of an `update()` of an absent document. */
function notFound(path: string): Error {
  return Object.assign(
    new Error(`5 NOT_FOUND: No document to update: ${path}`),
    {
      code: 5,
    },
  );
}

const parentOf = (path: string): string =>
  path.split('/').slice(0, -1).join('/');

const isDocumentId = (field: unknown): boolean =>
  field instanceof FieldPath && field.isEqual(FieldPath.documentId());

/** A `FieldPath`'s segments — read off the SDK object, loudly if its shape ever changes. */
function segmentsOf(path: FieldPath): readonly string[] {
  const segments: unknown = Reflect.get(path, 'segments');
  if (
    Array.isArray(segments) &&
    segments.every((segment) => typeof segment === 'string')
  ) {
    return segments;
  }
  throw new Error('FakeProjectionFirestore: a FieldPath without segments');
}

/** A field reference as segments: a string is dotted, a `FieldPath` is already split. */
function segmentsOfField(field: unknown): readonly string[] {
  return field instanceof FieldPath
    ? segmentsOf(field)
    : String(field).split('.');
}

/**
 * The value a filter or an ordering reads: a ROOT field of the document
 * (Law 5, `QueryFilter`). A dotted path — a string the SDK would walk into a
 * nested map, or a multi-segment `FieldPath` — is refused loudly, as a
 * nested write is, rather than modelled.
 */
function valueAt(data: Data, field: unknown): unknown {
  const segments = segmentsOfField(field);
  const [name, ...nested] = segments;
  if (name === undefined || nested.length > 0) {
    throw new Error(
      `FakeProjectionFirestore: a query on '${segments.join('.')}' — queries read root fields, never dot paths (Law 5)`,
    );
  }
  return new Map<string, unknown>(Object.entries(data)).get(name);
}

/** Firestore's ordering for the scalars a spec stores: numbers, then strings. */
function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const rank = (v: unknown): number =>
    v === undefined || v === null ? 0 : typeof v === 'number' ? 1 : 2;
  return rank(a) - rank(b);
}

const comparable = (a: unknown, b: unknown): boolean =>
  (typeof a === 'number' && typeof b === 'number') ||
  (typeof a === 'string' && typeof b === 'string');

/** One `where` clause as a keep-predicate over a document's data. */
function keepFor(
  read: (data: Data) => unknown,
  op: string,
  value: unknown,
): (id: string, data: Data) => boolean {
  switch (op) {
    case '==':
      return (_id, data) => read(data) === value;
    case '!=':
      return (_id, data) => {
        const actual = read(data);
        return actual !== undefined && actual !== value;
      };
    case '<':
    case '<=':
    case '>':
    case '>=':
      return (_id, data) => {
        const actual = read(data);
        if (!comparable(actual, value)) return false;
        const c = compare(actual, value);
        return op === '<'
          ? c < 0
          : op === '<='
            ? c <= 0
            : op === '>'
              ? c > 0
              : c >= 0;
      };
    case 'array-contains':
      return (_id, data) => {
        const list = read(data);
        return Array.isArray(list) && list.includes(value);
      };
    case 'array-contains-any':
      return (_id, data) => {
        const list = read(data);
        return (
          Array.isArray(list) &&
          Array.isArray(value) &&
          value.some((wanted) => list.includes(wanted))
        );
      };
    case 'in':
      return (_id, data) => Array.isArray(value) && value.includes(read(data));
    case 'not-in':
      return (_id, data) => {
        const actual = read(data);
        return (
          actual !== undefined &&
          Array.isArray(value) &&
          !value.includes(actual)
        );
      };
    default:
      throw new Error(`unsupported operator ${op}`);
  }
}

/** The SDK's delete sentinel — `FieldValue.delete()` — as the value of an update pair. */
const isDeleteSentinel = (value: unknown): boolean =>
  value instanceof FieldValue && value.isEqual(FieldValue.delete());

/**
 * `fields` merged into `base` at the ROOT. Law 5: writes target root fields,
 * never dot paths — the transaction adapter passes each key as a
 * single-segment `FieldPath` — so a multi-segment path (a nested-map write)
 * is refused loudly here rather than modelled. A `FieldValue.delete()` value
 * removes the root field, as the SDK does (Law 6: a variant transition
 * leaves the document exactly one variant).
 */
function withFields(
  base: Data,
  fields: readonly (readonly [readonly string[], unknown])[],
): Data {
  const next = new Map<string, unknown>(Object.entries(base));
  for (const [segments, value] of fields) {
    const [field, ...nested] = segments;
    if (field === undefined || nested.length > 0) {
      throw new Error(
        `FakeProjectionFirestore: update of '${segments.join('.')}' — writes target root fields, never dot paths (Law 5)`,
      );
    }
    if (isDeleteSentinel(value)) next.delete(field);
    else next.set(field, value);
  }
  return Object.fromEntries(next);
}

/** `update(ref, path, value, path, value, …)` as segment/value pairs. */
function fieldPairs(
  args: readonly unknown[],
): readonly (readonly [readonly string[], unknown])[] {
  const pairs: (readonly [readonly string[], unknown])[] = [];
  for (let i = 0; i + 1 < args.length; i += 2) {
    pairs.push([segmentsOfField(args.at(i)), args.at(i + 1)]);
  }
  return pairs;
}

export function createProjectionFirestore(seed: Record<string, Data> = {}) {
  const docs = new Map<string, Data>(Object.entries(seed));
  const writes: string[] = [];
  const failing = new Map<string, unknown>();

  const write = (path: string, data: Data): void => {
    docs.set(path, data);
    writes.push(path);
  };

  function snapshot(path: string): Snapshot {
    return {
      id: lastSegment(path),
      exists: docs.has(path),
      ref: docRef(path),
      data: () => docs.get(path),
      get: (field) => new Map(Object.entries(docs.get(path) ?? {})).get(field),
    };
  }

  function docRef(path: string): DocRef {
    return {
      kind: 'doc',
      path,
      id: lastSegment(path),
      collection: (name) => collectionRef(`${path}/${name}`),
      get: async () => snapshot(path),
      set: async (data) => write(path, data),
      create: async (data) => {
        if (docs.has(path)) throw alreadyExists(path);
        write(path, data);
      },
    };
  }

  function run(state: QueryState) {
    if (state.contains !== null && failing.has(state.contains)) {
      throw failing.get(state.contains);
    }
    let ids = [...docs.keys()]
      .filter((path) => parentOf(path) === state.path)
      .map(lastSegment)
      .sort()
      .filter((id) =>
        state.filters.every((keep) =>
          keep(id, docs.get(`${state.path}/${id}`) ?? {}),
        ),
      );
    if (state.orders.length > 0) {
      const dataOf = (id: string): Data =>
        docs.get(`${state.path}/${id}`) ?? {};
      ids = [...ids].sort((a, b) => {
        for (const order of state.orders) {
          const c = isDocumentId(order.field)
            ? compare(a, b)
            : compare(
                valueAt(dataOf(a), order.field),
                valueAt(dataOf(b), order.field),
              );
          if (c !== 0) return order.descending ? -c : c;
        }
        return compare(a, b);
      });
    }
    const after = state.after;
    if (after !== null) ids = ids.filter((id) => id > after);
    if (state.limit !== null) ids = ids.slice(0, state.limit);
    const found = ids.map((id) => snapshot(`${state.path}/${id}`));
    return { docs: found, size: found.length, empty: found.length === 0 };
  }

  function query(state: QueryState): Query {
    return {
      kind: 'query',
      state,
      where(field, op, value) {
        let keep: (id: string, data: Data) => boolean;
        if (typeof field !== 'string' && isDocumentId(field)) {
          // `FieldPath.documentId()` — the backfill's resumable cursor.
          if (op !== '>=') throw new Error(`unsupported id filter ${op}`);
          keep = (id) => id >= String(value);
        } else {
          keep = keepFor((data) => valueAt(data, field), op, value);
        }
        return query({
          ...state,
          filters: [...state.filters, keep],
          contains: op === 'array-contains' ? String(value) : state.contains,
        });
      },
      orderBy: (field, direction) =>
        query({
          ...state,
          orders: [
            ...state.orders,
            { field, descending: direction === 'desc' },
          ],
        }),
      limit: (n) => query({ ...state, limit: n }),
      startAfter: (id) => query({ ...state, after: id }),
      select: () => query(state),
      get: async () => run(state),
    };
  }

  function collectionRef(path: string): CollectionRef {
    return {
      ...query({
        path,
        filters: [],
        orders: [],
        limit: null,
        after: null,
        contains: null,
      }),
      doc: (id) => docRef(`${path}/${id}`),
    };
  }

  /** Applies a transaction's staged writes all-or-nothing, with the SDK's refusals. */
  function applyStaged(staged: readonly Staged[]): void {
    const next = new Map<string, Data | null>();
    const current = (path: string): Data | null =>
      next.has(path) ? (next.get(path) ?? null) : (docs.get(path) ?? null);
    for (const op of staged) {
      switch (op.stagedWrite) {
        case 'SET':
          next.set(op.path, op.data);
          break;
        case 'CREATE':
          if (current(op.path) !== null) throw alreadyExists(op.path);
          next.set(op.path, op.data);
          break;
        case 'UPDATE': {
          const base = current(op.path);
          if (base === null) throw notFound(op.path);
          next.set(op.path, withFields(base, op.fields));
          break;
        }
        case 'DELETE':
          next.set(op.path, null);
          break;
      }
    }
    for (const [path, data] of next) {
      if (data === null) {
        docs.delete(path);
        writes.push(path);
      } else {
        write(path, data);
      }
    }
  }

  function transaction(staged: Staged[]) {
    return {
      async get(target: DocRef | Query) {
        return target.kind === 'doc'
          ? snapshot(target.path)
          : run(target.state);
      },
      async getAll(...refs: DocRef[]) {
        return refs.map((ref) => snapshot(ref.path));
      },
      set(ref: DocRef, data: Data) {
        staged.push({ stagedWrite: 'SET', path: ref.path, data });
      },
      create(ref: DocRef, data: Data) {
        staged.push({ stagedWrite: 'CREATE', path: ref.path, data });
      },
      /** `update(ref, fieldPath, value, …)` only — the form the transaction adapter writes. */
      update(ref: DocRef, field: unknown, ...rest: unknown[]) {
        if (rest.length === 0) {
          throw new Error(
            'FakeProjectionFirestore: the object form update(ref, patch) is not modelled — write FieldPath/value pairs',
          );
        }
        staged.push({
          stagedWrite: 'UPDATE',
          path: ref.path,
          fields: fieldPairs([field, ...rest]),
        });
      },
      delete(ref: DocRef) {
        staged.push({ stagedWrite: 'DELETE', path: ref.path });
      },
    };
  }

  const db = {
    collection: collectionRef,
    /** `db.doc('appointments/a1')` — a document by its full path. */
    doc: (path: string) => docRef(path),
    /**
     * The Admin SDK's `Firestore.getAll(...refs)` — the same documents the
     * transaction's `getAll` reads, by path, in the order asked. The day
     * loader and the waitlist's catalogue read batch their reads through it.
     */
    async getAll(...refs: DocRef[]) {
      return refs.map((ref) => snapshot(ref.path));
    },
    runTransaction: async <T>(
      fn: (t: ReturnType<typeof transaction>) => Promise<T>,
    ): Promise<T> => {
      const staged: Staged[] = [];
      const result = await fn(transaction(staged));
      applyStaged(staged);
      return result;
    },
    batch() {
      const queued: ['set' | 'create', DocRef, Data][] = [];
      return {
        set: (ref: DocRef, data: Data) => queued.push(['set', ref, data]),
        create: (ref: DocRef, data: Data) => queued.push(['create', ref, data]),
        commit: async () => {
          // All or nothing, like the real batch: every create is checked —
          // against the store AND against the writes queued before it —
          // before a single document is written.
          const taken = new Set<string>();
          for (const [op, ref] of queued) {
            if (
              op === 'create' &&
              (docs.has(ref.path) || taken.has(ref.path))
            ) {
              throw alreadyExists(ref.path);
            }
            taken.add(ref.path);
          }
          for (const [, ref, data] of queued) write(ref.path, data);
        },
      };
    },
  };

  // ── The CommitPlan double ──────────────────────────────────────────────

  const plans: (readonly WriteOp[])[] = [];
  const transactions: RecordedReadTx[] = [];
  // A mechanics double over partial bodies: the registry that guards
  // nothing, nothing to report (OR-33 — the commit plan's registry and log
  // have no default).
  const adapterCommit = firestoreCommitPlan(
    db as unknown as Firestore,
    () => null,
    () => undefined,
  );

  const recording = (tx: ReadTx): RecordedReadTx => {
    const reads: DocPath[] = [];
    const queries: QuerySpec[] = [];
    return {
      reads,
      queries,
      get: <T>(path: DocPath) => {
        reads.push(path);
        return tx.get<T>(path);
      },
      getAll: <T>(paths: readonly DocPath[]) => {
        reads.push(...paths);
        return tx.getAll<T>(paths);
      },
      query: <T>(spec: QuerySpec) => {
        queries.push(spec);
        return tx.query<T>(spec);
      },
    };
  };

  const commit: CommitPlan = async <S, D, E>(
    read: (tx: ReadTx) => Promise<S>,
    decide: (
      snapshot: S,
    ) => Result<D & { readonly writes: readonly WriteOp[] }, E>,
  ): Promise<Result<D, E | RepositoryError>> => {
    let planned: readonly WriteOp[] | null = null;
    const result = await adapterCommit(
      (tx) => {
        const recorded = recording(tx);
        transactions.push(recorded);
        return read(recorded);
      },
      (snapshot: S) => {
        const decision = decide(snapshot);
        planned = decision.ok ? decision.value.writes : null;
        return decision;
      },
    );
    if (result.ok && planned !== null) plans.push(planned);
    return result;
  };

  return {
    db,
    docs,
    writes,
    /** The single commit port over this store — the production adapter, recorded. */
    commit,
    /** Every APPLIED plan, in commit order. */
    plans,
    /** The read set of every attempt, in order. */
    transactions,
    /** Make `userId`'s history read reject with `error` from now on. */
    failHistoryOf(userId: string, error: unknown): void {
      failing.set(userId, error);
    },
  };
}
