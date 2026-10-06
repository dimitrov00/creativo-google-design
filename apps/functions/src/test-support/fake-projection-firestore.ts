/**
 * An in-memory double for the slice of the Admin Firestore SDK the client
 * projections and the backfill use: documents by PATH (subcollections
 * included), queries ordered by document id with `limit` / `startAfter` /
 * `select`, the `==`, `in`, `array-contains` and document-id `>=` filters,
 * batched reads by reference (`getAll`), transactions and batches.
 *
 * Every transaction runs once and writes through at once — contention and
 * retries are the emulator suite's business. `create` — on a document or in
 * a batch — is the Admin SDK's: it fails with ALREADY_EXISTS (gRPC 6) when
 * the path is taken, and a batch holding such a create writes nothing at
 * all, which is what the audit writer's exactly-once rows rest on.
 * `failHistoryOf` makes the history read of one subject reject, which is how
 * a spec gets one person's recompute to fail while everybody else's
 * succeeds.
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
  update(patch: Data): Promise<void>;
}

interface QueryState {
  readonly path: string;
  readonly filters: readonly ((id: string, data: Data) => boolean)[];
  readonly limit: number | null;
  readonly after: string | null;
  /** The `array-contains` value, when there is one — a subject's history. */
  readonly contains: string | null;
}

interface Query {
  readonly kind: 'query';
  readonly state: QueryState;
  where(field: unknown, op: string, value: unknown): Query;
  orderBy(field: unknown): Query;
  limit(n: number): Query;
  startAfter(id: string): Query;
  select(): Query;
  get(): Promise<{ docs: Snapshot[]; size: number; empty: boolean }>;
}

interface CollectionRef extends Query {
  doc(id: string): DocRef;
}

const lastSegment = (path: string): string => path.split('/').pop() ?? '';

/** The Admin SDK's refusal of a `create()` onto an existing document. */
function alreadyExists(path: string): Error {
  return Object.assign(new Error(`6 ALREADY_EXISTS: ${path}`), { code: 6 });
}
const parentOf = (path: string): string =>
  path.split('/').slice(0, -1).join('/');

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
      update: async (patch) => write(path, { ...docs.get(path), ...patch }),
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
        const fieldOf = (data: Data): unknown =>
          new Map(Object.entries(data)).get(String(field));
        let keep: (id: string, data: Data) => boolean;
        if (typeof field !== 'string') {
          // `FieldPath.documentId()` — the only non-string field used here.
          if (op !== '>=') throw new Error(`unsupported id filter ${op}`);
          keep = (id) => id >= String(value);
        } else if (op === 'array-contains') {
          keep = (_id, data) => {
            const list = fieldOf(data);
            return Array.isArray(list) && list.includes(value);
          };
        } else if (op === 'in') {
          keep = (_id, data) =>
            Array.isArray(value) && value.includes(fieldOf(data));
        } else if (op === '==') {
          keep = (_id, data) => fieldOf(data) === value;
        } else {
          throw new Error(`unsupported operator ${op}`);
        }
        return query({
          ...state,
          filters: [...state.filters, keep],
          contains: op === 'array-contains' ? String(value) : state.contains,
        });
      },
      // Every query here orders by document id, which `run` always does.
      orderBy: () => query(state),
      limit: (n) => query({ ...state, limit: n }),
      startAfter: (id) => query({ ...state, after: id }),
      select: () => query(state),
      get: async () => run(state),
    };
  }

  function collectionRef(path: string): CollectionRef {
    return {
      ...query({ path, filters: [], limit: null, after: null, contains: null }),
      doc: (id) => docRef(`${path}/${id}`),
    };
  }

  const tx = {
    async get(target: DocRef | Query) {
      return target.kind === 'doc' ? snapshot(target.path) : run(target.state);
    },
    async getAll(...refs: DocRef[]) {
      return refs.map((ref) => snapshot(ref.path));
    },
    set(ref: DocRef, data: Data) {
      write(ref.path, data);
    },
    update(ref: DocRef, patch: Data) {
      write(ref.path, { ...docs.get(ref.path), ...patch });
    },
  };

  const db = {
    collection: collectionRef,
    /**
     * The Admin SDK's `Firestore.getAll(...refs)` — the same documents the
     * transaction's `getAll` reads, by path, in the order asked. The day
     * loader and the waitlist's catalogue read batch their reads through it.
     */
    async getAll(...refs: DocRef[]) {
      return refs.map((ref) => snapshot(ref.path));
    },
    runTransaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
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

  return {
    db,
    docs,
    writes,
    /** Make `userId`'s history read reject with `error` from now on. */
    failHistoryOf(userId: string, error: unknown): void {
      failing.set(userId, error);
    },
  };
}
