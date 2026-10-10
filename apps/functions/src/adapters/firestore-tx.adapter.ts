import {
  type DocumentData,
  type DocumentReference,
  FieldPath,
  type Firestore,
  type Query,
  type Transaction,
} from 'firebase-admin/firestore';
import {
  type CollectionPath,
  type CommitPlan,
  type DocBody,
  type DocPath,
  type QuerySpec,
  type ReadTx,
  RepositoryError,
  Result,
  TriggerAttemptSystem,
  WriteKind,
  type WriteOp,
} from '@creativo/ecs-core';

/**
 * The transactional sandwich over the Admin SDK (`tx.port.ts`, blueprint §4):
 * ONE `runTransaction` runs the pipeline's read callback against a
 * {@link ReadTx} — reads only, nothing that writes — hands the snapshot to
 * the pure `decide`, and applies the returned `WriteOp[]` plan inside the
 * same transaction. `set`/`create`/`update`/`delete` exist here and nowhere
 * else. Body-free: documents are read as `{ id, ...data }` and written as
 * the plan carries them — no mapping, no business logic.
 *
 * - A refusal (`Result.err` from `decide`) writes nothing.
 * - Contention re-runs read → decide (the SDK's own retry on ABORTED), which
 *   is why `decide` must be pure.
 * - A `Create` over an existing document is Firestore's ALREADY_EXISTS: it
 *   comes back as a VALUE — `RepositoryError.alreadyExists(path)`
 *   (`repo.already_exists`) naming the document — never as a rejection, as
 *   the `CommitPlan` port says, so a pipeline can read a lost create race
 *   as "already written" (the audit row's replay, the users stub, a
 *   deterministic notification id). Nothing of the plan was applied.
 * - Every other failure (retries exhausted, the store unreachable, an
 *   `Update` of an absent document) rejects: infrastructure, mapped once by
 *   the edge.
 *
 * An `Update` key is ONE root field (Law 5: writes target root fields,
 * never dot paths). Each key goes to the SDK as a single-segment
 * `FieldPath`, so the SDK's field-path grammar never parses it: a `.` (or a
 * `/`, `~`, `*`) in a key is just a character of the field's name, never a
 * way into a nested map. An `Update` with no fields writes nothing.
 */

/** Firestore's canonical name for gRPC 6, as `TriggerAttemptSystem.failureCode` reads it. */
const ALREADY_EXISTS = 'already-exists';

const slashed = (path: DocPath | CollectionPath): string => path.join('/');

const docRef = (db: Firestore, path: DocPath): DocumentReference =>
  db.doc(slashed(path));

/** One query as data → the SDK's query, clause by clause. */
function toQuery(db: Firestore, spec: QuerySpec): Query {
  let query: Query = db.collection(slashed(spec.collection));
  for (const filter of spec.where) {
    query = query.where(filter.field, filter.op, filter.value);
  }
  for (const order of spec.orderBy) {
    query = query.orderBy(order.field, order.descending ? 'desc' : 'asc');
  }
  return spec.limit === null ? query : query.limit(spec.limit);
}

/**
 * The read half over one SDK transaction. An absent document answers
 * `null` (and still enters the conflict set); the entity is the body plus
 * its id, cast once here — the document body IS the entity minus `id`.
 */
export const firestoreReadTx = (db: Firestore, tx: Transaction): ReadTx => ({
  get: async <E>(path: DocPath): Promise<E | null> => {
    const snap = await tx.get(docRef(db, path));
    return snap.exists ? ({ id: snap.id, ...snap.data() } as E) : null;
  },
  getAll: async <E>(
    paths: readonly DocPath[],
  ): Promise<readonly (E | null)[]> => {
    if (paths.length === 0) return [];
    const snaps = await tx.getAll(...paths.map((path) => docRef(db, path)));
    return snaps.map((snap) =>
      snap.exists ? ({ id: snap.id, ...snap.data() } as E) : null,
    );
  },
  query: async <E>(spec: QuerySpec): Promise<readonly E[]> => {
    const snap = await tx.get(toQuery(db, spec));
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as E);
  },
});

/** A root field by its literal name — one segment, never re-parsed (Law 5). */
const fieldPathOf = (field: string): FieldPath => new FieldPath(field);

/** `fields` as the SDK's `update(ref, path, value, ...pathsAndValues)`. */
function applyUpdate(
  tx: Transaction,
  ref: DocumentReference,
  fields: DocBody,
): void {
  const [first, ...others] = Object.entries(fields);
  if (first === undefined) return;
  const rest: unknown[] = [];
  for (const [field, value] of others) rest.push(fieldPathOf(field), value);
  tx.update(ref, fieldPathOf(first[0]), first[1], ...rest);
}

/** The plan, applied in order inside the transaction. */
function applyPlan(
  db: Firestore,
  tx: Transaction,
  writes: readonly WriteOp[],
): void {
  for (const op of writes) {
    const ref = docRef(db, op.path);
    switch (op.kind) {
      case WriteKind.Set:
        tx.set(ref, op.body as DocumentData);
        break;
      case WriteKind.Create:
        tx.create(ref, op.body as DocumentData);
        break;
      case WriteKind.Update:
        applyUpdate(tx, ref, op.fields);
        break;
      case WriteKind.Delete:
        tx.delete(ref);
        break;
    }
  }
}

/**
 * How the store names the refused document in its message: production
 * Firestore (`Document already exists: projects/…/documents/<path>`) and
 * the emulator (`entity already exists: EntityRef[…, path=/<path>]`).
 */
const NAMED_DOCUMENT: readonly RegExp[] = [
  /\/documents\/([^\s\]]+)/,
  /\bpath=\/([^\s\]]+)/,
];

/**
 * Which document refused: the one the message names; failing that, the
 * plan's one `Create`; else unknown.
 */
function conflictPath(
  error: unknown,
  creates: readonly DocPath[],
): string | null {
  const message = error instanceof Error ? error.message : String(error);
  for (const pattern of NAMED_DOCUMENT) {
    const named = pattern.exec(message)?.[1];
    if (named !== undefined) return named;
  }
  const only = creates.length === 1 ? creates[0] : undefined;
  return only === undefined ? null : slashed(only);
}

export const firestoreCommitPlan =
  (db: Firestore): CommitPlan =>
  async <S, D, E>(
    read: (tx: ReadTx) => Promise<S>,
    decide: (
      snapshot: S,
    ) => Result<D & { readonly writes: readonly WriteOp[] }, E>,
  ): Promise<Result<D, E | RepositoryError>> => {
    let creates: readonly DocPath[] = [];
    try {
      return await db.runTransaction(
        async (tx): Promise<Result<D, E | RepositoryError>> => {
          const decision = decide(await read(firestoreReadTx(db, tx)));
          if (!decision.ok) return decision;
          const { writes, ...answer } = decision.value;
          creates = writes
            .filter((op) => op.kind === WriteKind.Create)
            .map((op) => op.path);
          applyPlan(db, tx, writes);
          // `answer` is the decision minus its plan — `D` exactly, which the
          // spread's `Omit` cannot prove for a generic `D`.
          return Result.ok(answer as unknown as D);
        },
      );
    } catch (error) {
      if (TriggerAttemptSystem.failureCode(error) !== ALREADY_EXISTS) {
        throw error;
      }
      return Result.err(
        RepositoryError.alreadyExists(conflictPath(error, creates)),
      );
    }
  };
