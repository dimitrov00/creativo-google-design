/**
 * A FIRESTORE THAT FITS IN A SPEC: documents by path, and the handful of
 * `firebase/firestore` functions the read adapters call, which really
 * filter, order, page and notify. A spec that mocks the SDK with it
 * asserts what a query RETURNS, not which functions were called to build
 * it, so an adapter that pages wrongly fails here and not in production.
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
 * and hand a `FakeFirestore` over as `FIREBASE_FIRESTORE`. Test support:
 * excluded from `tsconfig.lib.json`, never part of the lib's public API.
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
  exists(): boolean;
  data(): Fields | undefined;
}

interface QueryDocument {
  readonly id: string;
  data(): Fields;
}

interface Listener {
  readonly path: string;
  readonly next: (snapshot: DocumentSnapshot) => void;
  readonly error: (error: unknown) => void;
}

/** One read the fake answered: what a spec asserts was (or was not) asked for. */
export interface FakeRead {
  readonly kind: 'document' | 'query' | 'listen';
  readonly path: string;
  /** The constraints of a query, in the order given; empty for a document. */
  readonly constraints: readonly string[];
}

export class FakeFirestore {
  /** Every read, in order. */
  readonly reads: FakeRead[] = [];
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

  /** Every read rejects with this until `recover()`; a listener hears it as its error. */
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
    return this.snapshotOf(ref.path);
  }

  /** @internal */
  run(ref: CollectionRef): { readonly docs: readonly QueryDocument[] } {
    this.reads.push({
      kind: 'query',
      path: ref.path,
      constraints: ref.constraints.map(describe),
    });
    if (this.failure !== null) throw this.failure;
    return { docs: evaluate(this.childrenOf(ref.path), ref.constraints) };
  }

  /** @internal */
  listen(
    ref: DocumentRef,
    next: Listener['next'],
    error: Listener['error'],
  ): () => void {
    this.reads.push({ kind: 'listen', path: ref.path, constraints: [] });
    const listener: Listener = { path: ref.path, next, error };
    this.listeners.add(listener);
    if (this.failure !== null) error(this.failure);
    else next(this.snapshotOf(ref.path));
    return () => {
      this.listeners.delete(listener);
    };
  }

  private told(path: string): this {
    for (const listener of [...this.listeners]) {
      if (listener.path === path) listener.next(this.snapshotOf(path));
    }
    return this;
  }

  private snapshotOf(path: string): DocumentSnapshot {
    const data = this.documents.get(path);
    return {
      id: lastSegment(path),
      exists: () => data !== undefined,
      data: () => data,
    };
  }

  /** The documents DIRECTLY under a collection: a subcollection's are not its own. */
  private childrenOf(collectionPath: string): QueryDocument[] {
    const prefix = `${collectionPath}/`;
    return [...this.documents]
      .filter(
        ([path]) =>
          path.startsWith(prefix) && !path.slice(prefix.length).includes('/'),
      )
      .map(([path, data]) => ({ id: lastSegment(path), data: () => data }));
  }
}

/** The mocked `firebase/firestore`: exactly the functions the read adapters and the path helpers import. */
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
    getDocs: async (
      ref: CollectionRef,
    ): Promise<{ readonly docs: readonly QueryDocument[] }> => ref.db.run(ref),
    onSnapshot: (
      ref: DocumentRef,
      next: Listener['next'],
      error: Listener['error'],
    ): (() => void) => ref.db.listen(ref, next, error),
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
    default:
      throw new Error(`FakeFirestore does not know "${constraint.op}"`);
  }
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

function lastSegment(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
