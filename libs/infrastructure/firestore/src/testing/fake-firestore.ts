/**
 * A FIRESTORE THAT FITS IN A SPEC: documents by path, and the handful of
 * `firebase/firestore` functions the adapters call, which really filter,
 * order, page, notify and write. A spec that mocks the SDK with it asserts
 * what a query RETURNS (and what a write LEAVES), not which functions were
 * called to build it, so an adapter that pages wrongly fails here and not in
 * production.
 *
 * It is NOT the emulator: it knows no rules and no indexes, and only the
 * operators listed in `matches`. What a rule lets through, and what the
 * real SDK accepts as a query, is the integration specs' to say.
 *
 * Use (the factory is hoisted above the imports, hence the dynamic import):
 *
 * ```ts
 * vi.mock('firebase/firestore', async () =>
 *   (await import('../testing/fake-firestore')).fakeFirestoreModule(),
 * );
 * ```
 *
 * and hand a `FakeFirestore` over as the adapter's `Firestore` (or as
 * `FIREBASE_FIRESTORE`). Test support: excluded from `tsconfig.lib.json`,
 * never part of the lib's public API.
 */

/** A document's data: any object. A typed wire document has no index signature, and needs none here. */
type Fields = object;

const DOCUMENT_ID = Symbol('documentId');
type FieldRef = string | typeof DOCUMENT_ID;

type Constraint =
  | {
      readonly kind: 'where';
      readonly field: FieldRef;
      readonly op: string;
      readonly value: unknown;
    }
  | {
      readonly kind: 'orderBy';
      readonly field: FieldRef;
      readonly direction: 'asc' | 'desc';
    }
  | { readonly kind: 'startAfter'; readonly value: unknown }
  | { readonly kind: 'limit'; readonly count: number };

interface DocumentRef {
  readonly kind: 'document';
  readonly db: FakeFirestore;
  readonly path: string;
  readonly id: string;
}

interface CollectionRef {
  readonly kind: 'collection';
  readonly db: FakeFirestore;
  readonly path: string;
  readonly constraints: readonly Constraint[];
}

interface DocumentSnapshot {
  readonly id: string;
  readonly ref: DocumentRef;
  exists(): boolean;
  data(): Fields | undefined;
}

interface QueryDocument {
  readonly id: string;
  readonly ref: DocumentRef;
  data(): Fields;
}

interface QuerySnapshot {
  readonly docs: readonly QueryDocument[];
  readonly empty: boolean;
  readonly size: number;
}

interface Listener {
  readonly ref: DocumentRef | CollectionRef;
  readonly next: (snapshot: DocumentSnapshot | QuerySnapshot) => void;
  readonly error: (error: unknown) => void;
}

/** One read the fake answered: what a spec asserts was (or was not) asked for. */
export interface FakeRead {
  readonly kind: 'document' | 'query' | 'listen';
  readonly path: string;
  /** The constraints of a query, in the order given; empty for a document. */
  readonly constraints: readonly string[];
}

/** One write the fake applied: what a spec asserts was (or was not) written. */
export interface FakeWrite {
  readonly kind: 'set' | 'update' | 'delete';
  readonly path: string;
  /** The fields written; `null` for a delete. */
  readonly data: Fields | null;
}

/** A write waiting for its batch or transaction to commit. */
type PendingWrite =
  | {
      readonly kind: 'set' | 'update';
      readonly ref: DocumentRef;
      readonly data: Fields;
    }
  | { readonly kind: 'delete'; readonly ref: DocumentRef };

export class FakeFirestore {
  /** Every read, in order. */
  readonly reads: FakeRead[] = [];
  /** Every write an adapter made through the SDK functions, in order (not `set`/`delete` seeding). */
  readonly writes: FakeWrite[] = [];
  private readonly documents = new Map<string, Fields>();
  private readonly listeners = new Set<Listener>();
  private failure: unknown = null;

  /** Documents by path (`collection/id`, `collection/id/sub/id`). */
  constructor(
    documents:
      Readonly<Record<string, Fields>> | ReadonlyMap<string, Fields> = {},
  ) {
    const entries =
      documents instanceof Map ? documents : Object.entries(documents);
    for (const [path, data] of entries) this.documents.set(path, data);
  }

  /** The document at `path` as it stands now: what a spec spreads to write a changed one. */
  documentAt(path: string): Fields | undefined {
    return this.documents.get(path);
  }

  /** Writes, or replaces, one document, and tells whoever watches it. */
  set(path: string, data: Fields): this {
    this.documents.set(path, data);
    return this.told(path);
  }

  /** Removes one document, and tells whoever watches it. */
  delete(path: string): this {
    this.documents.delete(path);
    return this.told(path);
  }

  /** Every read and write rejects with this until `recover()`; a listener hears it as its error. */
  failWith(error: unknown = new Error('permission-denied')): this {
    this.failure = error;
    for (const listener of [...this.listeners]) listener.error(error);
    return this;
  }

  recover(): this {
    this.failure = null;
    return this;
  }

  /** How many listeners are attached now. */
  get listening(): number {
    return this.listeners.size;
  }

  // ── What the module's functions call ──────────────────────────────────

  /** @internal */
  read(ref: DocumentRef): DocumentSnapshot {
    this.reads.push({ kind: 'document', path: ref.path, constraints: [] });
    if (this.failure !== null) throw this.failure;
    return this.snapshotOf(ref);
  }

  /** @internal */
  run(ref: CollectionRef): QuerySnapshot {
    this.reads.push({
      kind: 'query',
      path: ref.path,
      constraints: ref.constraints.map(describe),
    });
    if (this.failure !== null) throw this.failure;
    return this.queryResultOf(ref);
  }

  /** @internal */
  listen(
    ref: DocumentRef | CollectionRef,
    next: Listener['next'],
    error: Listener['error'],
  ): () => void {
    this.reads.push({
      kind: 'listen',
      path: ref.path,
      constraints:
        ref.kind === 'collection' ? ref.constraints.map(describe) : [],
    });
    const listener: Listener = { ref, next, error };
    this.listeners.add(listener);
    if (this.failure !== null) error(this.failure);
    else next(this.answerOf(ref));
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * @internal Applies writes as ONE commit: all of them or, on a failure,
   * none. An `update` of an absent document is Firestore's `not-found`.
   */
  commit(pending: readonly PendingWrite[]): void {
    if (this.failure !== null) throw this.failure;
    for (const write of pending) {
      if (write.kind === 'update' && !this.documents.has(write.ref.path)) {
        throw Object.assign(
          new Error(`No document to update: ${write.ref.path}`),
          {
            code: 'not-found',
          },
        );
      }
    }
    for (const write of pending) {
      const path = write.ref.path;
      if (write.kind === 'delete') {
        this.writes.push({ kind: 'delete', path, data: null });
        this.delete(path);
      } else if (write.kind === 'set') {
        this.writes.push({ kind: 'set', path, data: write.data });
        this.set(path, write.data);
      } else {
        this.writes.push({ kind: 'update', path, data: write.data });
        this.set(path, { ...this.documents.get(path), ...write.data });
      }
    }
  }

  private told(path: string): this {
    for (const listener of [...this.listeners]) {
      const { ref } = listener;
      if (
        ref.kind === 'document' ? ref.path === path : isChildOf(path, ref.path)
      ) {
        listener.next(this.answerOf(ref));
      }
    }
    return this;
  }

  private answerOf(
    ref: DocumentRef | CollectionRef,
  ): DocumentSnapshot | QuerySnapshot {
    return ref.kind === 'document'
      ? this.snapshotOf(ref)
      : this.queryResultOf(ref);
  }

  private snapshotOf(ref: DocumentRef): DocumentSnapshot {
    const data = this.documents.get(ref.path);
    return {
      id: ref.id,
      ref,
      exists: () => data !== undefined,
      data: () => data,
    };
  }

  private queryResultOf(ref: CollectionRef): QuerySnapshot {
    const docs = evaluate(this.childrenOf(ref.path), ref.constraints);
    return { docs, empty: docs.length === 0, size: docs.length };
  }

  /** The documents DIRECTLY under a collection: a subcollection's are not its own. */
  private childrenOf(collectionPath: string): QueryDocument[] {
    return [...this.documents]
      .filter(([path]) => isChildOf(path, collectionPath))
      .map(([path, data]) => ({
        id: lastSegment(path),
        ref: { kind: 'document', db: this, path, id: lastSegment(path) },
        data: () => data,
      }));
  }
}

/** The mocked `firebase/firestore`: exactly the functions the adapters and the path helpers import. */
export function fakeFirestoreModule(): Record<string, unknown> {
  return {
    collection: (db: FakeFirestore, ...segments: string[]): CollectionRef => ({
      kind: 'collection',
      db,
      path: segments.join('/'),
      constraints: [],
    }),
    collectionGroup: (): never => {
      throw new Error('FakeFirestore has no collection groups');
    },
    doc: (db: FakeFirestore, ...segments: string[]): DocumentRef => {
      const path = segments.join('/');
      if (segments.some((segment) => segment.length === 0)) {
        throw new Error(`Invalid document path: "${path}"`);
      }
      return { kind: 'document', db, path, id: lastSegment(path) };
    },
    documentId: (): typeof DOCUMENT_ID => DOCUMENT_ID,
    query: (
      base: CollectionRef,
      ...constraints: Constraint[]
    ): CollectionRef => ({
      ...base,
      constraints: [...base.constraints, ...constraints],
    }),
    where: (field: FieldRef, op: string, value: unknown): Constraint => ({
      kind: 'where',
      field,
      op,
      value,
    }),
    orderBy: (
      field: FieldRef,
      direction: 'asc' | 'desc' = 'asc',
    ): Constraint => ({ kind: 'orderBy', field, direction }),
    startAfter: (value: unknown): Constraint => ({ kind: 'startAfter', value }),
    limit: (count: number): Constraint => {
      if (!Number.isInteger(count) || count < 1) {
        throw new Error(`Invalid limit: ${String(count)}`);
      }
      return { kind: 'limit', count };
    },
    getDoc: async (ref: DocumentRef): Promise<DocumentSnapshot> =>
      ref.db.read(ref),
    getDocs: async (ref: CollectionRef): Promise<QuerySnapshot> =>
      ref.db.run(ref),
    onSnapshot: (
      ref: DocumentRef | CollectionRef,
      next: Listener['next'],
      error: Listener['error'],
    ): (() => void) => ref.db.listen(ref, next, error),
    setDoc: async (ref: DocumentRef, data: Fields): Promise<void> =>
      ref.db.commit([{ kind: 'set', ref, data }]),
    updateDoc: async (ref: DocumentRef, data: Fields): Promise<void> =>
      ref.db.commit([{ kind: 'update', ref, data }]),
    deleteDoc: async (ref: DocumentRef): Promise<void> =>
      ref.db.commit([{ kind: 'delete', ref }]),
    writeBatch: (db: FakeFirestore) => {
      const pending: PendingWrite[] = [];
      const batch = {
        set: (ref: DocumentRef, data: Fields) => {
          pending.push({ kind: 'set', ref, data });
          return batch;
        },
        update: (ref: DocumentRef, data: Fields) => {
          pending.push({ kind: 'update', ref, data });
          return batch;
        },
        delete: (ref: DocumentRef) => {
          pending.push({ kind: 'delete', ref });
          return batch;
        },
        commit: async (): Promise<void> => db.commit(pending),
      };
      return batch;
    },
    /** One attempt (no contention here): reads through the fake, writes applied only when `update` resolves. */
    runTransaction: async <T>(
      db: FakeFirestore,
      update: (transaction: unknown) => Promise<T>,
    ): Promise<T> => {
      const pending: PendingWrite[] = [];
      const transaction = {
        get: async (ref: DocumentRef): Promise<DocumentSnapshot> =>
          db.read(ref),
        set: (ref: DocumentRef, data: Fields) => {
          pending.push({ kind: 'set', ref, data });
          return transaction;
        },
        update: (ref: DocumentRef, data: Fields) => {
          pending.push({ kind: 'update', ref, data });
          return transaction;
        },
        delete: (ref: DocumentRef) => {
          pending.push({ kind: 'delete', ref });
          return transaction;
        },
      };
      const answer = await update(transaction);
      db.commit(pending);
      return answer;
    },
  };
}

// ── Evaluating a query ──────────────────────────────────────────────────

function evaluate(
  documents: readonly QueryDocument[],
  constraints: readonly Constraint[],
): QueryDocument[] {
  const order: OrderBy = constraints.find(isOrderBy) ?? {
    kind: 'orderBy',
    field: DOCUMENT_ID,
    direction: 'asc',
  };
  const sign = order.direction === 'desc' ? -1 : 1;

  let rows = documents
    .filter((document) =>
      constraints.every((c) => c.kind !== 'where' || matches(document, c)),
    )
    // Firestore leaves out a document that lacks the field it orders by.
    .filter((document) => valueOf(document, order.field) !== undefined)
    .sort(
      (a, b) =>
        sign *
        (compare(valueOf(a, order.field), valueOf(b, order.field)) ||
          compare(a.id, b.id)),
    );

  for (const constraint of constraints) {
    if (constraint.kind === 'startAfter') {
      rows = rows.filter(
        (row) =>
          sign * compare(valueOf(row, order.field), constraint.value) > 0,
      );
    }
  }
  const limit = constraints.find(isLimit);
  return limit === undefined ? rows : rows.slice(0, limit.count);
}

type OrderBy = Extract<Constraint, { kind: 'orderBy' }>;
type Limit = Extract<Constraint, { kind: 'limit' }>;

const isOrderBy = (constraint: Constraint): constraint is OrderBy =>
  constraint.kind === 'orderBy';

const isLimit = (constraint: Constraint): constraint is Limit =>
  constraint.kind === 'limit';

function matches(
  document: QueryDocument,
  constraint: Extract<Constraint, { kind: 'where' }>,
): boolean {
  const value = valueOf(document, constraint.field);
  switch (constraint.op) {
    case '==':
      return value === constraint.value;
    case 'in':
      return (
        Array.isArray(constraint.value) && constraint.value.includes(value)
      );
    case 'array-contains':
      return Array.isArray(value) && value.includes(constraint.value);
    // A range compares values of one type only, as Firestore does: a
    // document whose field is absent or of another type never matches.
    case '<':
      return (
        sameType(value, constraint.value) &&
        compare(value, constraint.value) < 0
      );
    case '<=':
      return (
        sameType(value, constraint.value) &&
        compare(value, constraint.value) <= 0
      );
    case '>':
      return (
        sameType(value, constraint.value) &&
        compare(value, constraint.value) > 0
      );
    case '>=':
      return (
        sameType(value, constraint.value) &&
        compare(value, constraint.value) >= 0
      );
    default:
      throw new Error(`FakeFirestore does not know "${constraint.op}"`);
  }
}

function sameType(a: unknown, b: unknown): boolean {
  return a !== undefined && a !== null && typeof a === typeof b;
}

/** A field by its dotted path (`effect.kind`), or the document's id. */
function valueOf(document: QueryDocument, field: FieldRef): unknown {
  if (field === DOCUMENT_ID) return document.id;
  let value: unknown = document.data();
  for (const segment of field.split('.')) {
    if (typeof value !== 'object' || value === null) return undefined;
    value = new Map(Object.entries(value)).get(segment);
  }
  return value;
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const left = String(a);
  const right = String(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

function describe(constraint: Constraint): string {
  const name = (field: FieldRef): string =>
    field === DOCUMENT_ID ? '__name__' : field;
  switch (constraint.kind) {
    case 'where':
      return `${name(constraint.field)} ${constraint.op} ${JSON.stringify(constraint.value)}`;
    case 'orderBy':
      return `orderBy ${name(constraint.field)} ${constraint.direction}`;
    case 'startAfter':
      return `startAfter ${JSON.stringify(constraint.value)}`;
    case 'limit':
      return `limit ${constraint.count}`;
  }
}

/** Whether `path` is a document directly under `collectionPath`. */
function isChildOf(path: string, collectionPath: string): boolean {
  const prefix = `${collectionPath}/`;
  return path.startsWith(prefix) && !path.slice(prefix.length).includes('/');
}

function lastSegment(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
