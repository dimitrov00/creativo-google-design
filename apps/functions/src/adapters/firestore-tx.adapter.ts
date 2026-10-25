import {
  type DocumentData,
  type DocumentReference,
  FieldPath,
  FieldValue,
  type Firestore,
  type Query,
  type Transaction,
} from 'firebase-admin/firestore';
import { Result } from '@core/primitives';
import { RepositoryError } from '@core/errors';
import {
  type DocBody,
  type DocPath,
  WriteAction,
  type WriteOp,
} from '@core/components';
import {
  type CollectionPath,
  type CommitPlan,
  type Log,
  type QuerySpec,
  type ReadTx,
} from '@core/ports';
import {
  type StoredDocument,
  StoredDocumentSystem,
  type StoredGuardOf,
  TriggerAttemptSystem,
} from '@core/systems';
import { withPurgeAt } from './firestore-ttl.adapter';

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
 * - A plan whose `Update` both sets and deletes one key comes back as a
 *   VALUE too — `RepositoryError.writeFailed(path, 'field-set-and-deleted')`
 *   — and nothing of it is applied (the doubles answer the same).
 * - Every other failure (retries exhausted, the store unreachable, an
 *   `Update` of an absent document) rejects: infrastructure, mapped once by
 *   the edge.
 * - Every `Set` and `Create` of a TTL group carries its root `purgeAt`
 *   (flip 1, F1-7): the one stamp of `firestore-ttl.adapter.ts`
 *   (`purgeAtFor`), added here beside the entity body — the plan never
 *   carries it, so no pipeline or system ever sees a `Timestamp`.
 * - A read of a MALFORMED document of a guarded collection refuses the
 *   whole commit (edge hardening D-3): built with
 *   `StoredDocumentSystem.guardOf` (the composition root's
 *   `firestorePorts`), the read half runs each top-level `appointments` /
 *   `customers` / `barberBusy` document through its stored-document guard
 *   — an admitted one is THE SAME OBJECT `{ id, ...data }` it always was;
 *   a refused one reads as `null` (a query leaves it out) so the pipeline's
 *   read callback can finish without touching it, and the FIRST refusal is
 *   recorded. After `read` and before `decide`, a recorded refusal answers
 *   `RepositoryError.malformed(path, field)` and nothing is written; it is
 *   logged ONCE per commit (`'malformed document refused'`, `{ path, field }`
 *   — the edge's wire projection drops both, so the refusal logs itself).
 *   Each contention attempt starts with a clean record. A bare
 *   `firestoreCommitPlan(db)` guards nothing (the mechanics specs' partial
 *   bodies, the seed and the integration specs; DEP-11).
 *
 * An `Update` key is ONE root field (Laws 5 and 6: writes target root
 * fields, never dot paths). Each `fields` key goes to the SDK as a
 * single-segment `FieldPath`, so the SDK's field-path grammar never parses
 * it: a `.` (or a `/`, `~`, `*`) in a key is just a character of the
 * field's name, never a way into a nested map. Each `deleteFields` key goes
 * the same way with `FieldValue.delete()` — how a variant transition removes
 * the old variant's fields (`WriteOp.transition`). An `Update` with no
 * fields and no deletes writes nothing.
 */

/** The reason a plan that sets and deletes one key is refused with (the doubles use the same). */
export const FIELD_SET_AND_DELETED = 'field-set-and-deleted';

/** Firestore's canonical name for gRPC 6, as `TriggerAttemptSystem.failureCode` reads it. */
const ALREADY_EXISTS = 'already-exists';

/**
 * The line every functions read site logs a refused document under (edge
 * hardening D-4) — the schedule and job adapters (through
 * {@link admitStored}) and the trigger decoders' root binding log through
 * {@link logRefusal} too, so an operator searches one phrase.
 */
export const MALFORMED_DOCUMENT_REFUSED = 'malformed document refused';

/** Logs one refusal: `'malformed document refused'`, `{ path, field }` (`field` = the error's `reason`). */
export function logRefusal(log: Log, error: RepositoryError): void {
  log('error', MALFORMED_DOCUMENT_REFUSED, {
    path: error.path,
    field: error.reason,
  });
}

/** No log — the default of a bare factory. */
const NO_LOG: Log = () => undefined;

/** No refusal handler — the default of a bare read half. */
const IGNORE_REFUSAL: (error: RepositoryError) => void = () => undefined;

/**
 * A stored document read OUTSIDE a transaction, through its collection's
 * guard (`StoredDocumentSystem.admit`, the one dispatch rule): `Result.ok`
 * with the same object when admitted or unguarded, or the refusal —
 * logged once ({@link logRefusal}). `collection` is `null` for a
 * subcollection, which is never guarded. The schedule and job adapters'
 * single and walk reads answer through it.
 */
export function admitStored<E>(
  guardOf: StoredGuardOf,
  collection: string | null,
  doc: StoredDocument,
  log: Log,
): Result<E, RepositoryError> {
  const verdict = StoredDocumentSystem.admit(guardOf, collection, doc);
  if (!verdict.ok) logRefusal(log, verdict.error);
  // Admitted field by field (or read as stored, unguarded) — the entity.
  return verdict as unknown as Result<E, RepositoryError>;
}

/**
 * The transaction read half's form of {@link admitStored}: the same object
 * when admitted or unguarded, `null` — after telling `onRefused`, which
 * RECORDS the refusal for the commit to answer and log once — when refused.
 */
function admittedOrNull<E>(
  guardOf: StoredGuardOf,
  collection: string | null,
  doc: StoredDocument,
  onRefused: (error: RepositoryError) => void,
): E | null {
  const verdict = StoredDocumentSystem.admit(guardOf, collection, doc);
  if (verdict.ok) return verdict.value as unknown as E;
  onRefused(verdict.error);
  return null;
}

/** The top-level collection a document path names, or `null` for a nested one. */
const collectionOf = (path: DocPath): string | null =>
  path.length === 2 ? (path[0] ?? null) : null;

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
 * A top-level document of a collection `guardOf` guards passes its
 * stored-document guard first: refused, it reads as `null` (`get`,
 * `getAll` — the position kept) or is left out (`query`), and `onRefused`
 * hears the refusal; the commit refuses on it before `decide`
 * ({@link firestoreCommitPlan}).
 */
export const firestoreReadTx = (
  db: Firestore,
  tx: Transaction,
  guardOf: StoredGuardOf = StoredDocumentSystem.unguarded,
  onRefused: (error: RepositoryError) => void = IGNORE_REFUSAL,
): ReadTx => ({
  get: async <E>(path: DocPath): Promise<E | null> => {
    const snap = await tx.get(docRef(db, path));
    return snap.exists
      ? admittedOrNull<E>(
          guardOf,
          collectionOf(path),
          { id: snap.id, ...snap.data() },
          onRefused,
        )
      : null;
  },
  getAll: async <E>(
    paths: readonly DocPath[],
  ): Promise<readonly (E | null)[]> => {
    if (paths.length === 0) return [];
    const snaps = await tx.getAll(...paths.map((path) => docRef(db, path)));
    return snaps.map((snap, i) =>
      snap.exists
        ? admittedOrNull<E>(
            guardOf,
            collectionOf(paths.at(i) ?? []),
            { id: snap.id, ...snap.data() },
            onRefused,
          )
        : null,
    );
  },
  query: async <E>(spec: QuerySpec): Promise<readonly E[]> => {
    const snap = await tx.get(toQuery(db, spec));
    const collection =
      spec.collection.length === 1 ? (spec.collection[0] ?? null) : null;
    const rows: E[] = [];
    for (const doc of snap.docs) {
      const row = admittedOrNull<E>(
        guardOf,
        collection,
        { id: doc.id, ...doc.data() },
        onRefused,
      );
      if (row !== null) rows.push(row);
    }
    return rows;
  },
});

/** A root field by its literal name — one segment, never re-parsed (Law 5). */
const fieldPathOf = (field: string): FieldPath => new FieldPath(field);

/**
 * `fields` and `deleteFields` as the SDK's
 * `update(ref, path, value, ...pathsAndValues)` — each deleted key paired
 * with `FieldValue.delete()`.
 */
function applyUpdate(
  tx: Transaction,
  ref: DocumentReference,
  fields: DocBody,
  deleteFields: readonly string[],
): void {
  const pairs: unknown[] = [];
  for (const [field, value] of Object.entries(fields)) {
    pairs.push(fieldPathOf(field), value);
  }
  for (const field of deleteFields) {
    pairs.push(fieldPathOf(field), FieldValue.delete());
  }
  const [first, value, ...rest] = pairs;
  if (first === undefined) return;
  tx.update(ref, first as FieldPath, value, ...rest);
}

/** The first `Update` that names one key in both lists — the whole plan is refused. */
function setAndDeleted(writes: readonly WriteOp[]): DocPath | null {
  for (const op of writes) {
    if (op.writeAction !== WriteAction.Update) continue;
    for (const field of op.deleteFields) {
      if (Object.hasOwn(op.fields, field)) return op.path;
    }
  }
  return null;
}

/** The plan, applied in order inside the transaction. */
function applyPlan(
  db: Firestore,
  tx: Transaction,
  writes: readonly WriteOp[],
): void {
  for (const op of writes) {
    const ref = docRef(db, op.path);
    switch (op.writeAction) {
      case WriteAction.Set:
        tx.set(ref, withPurgeAt(op.path, op.body) as DocumentData);
        break;
      case WriteAction.Create:
        tx.create(ref, withPurgeAt(op.path, op.body) as DocumentData);
        break;
      case WriteAction.Update:
        applyUpdate(tx, ref, op.fields, op.deleteFields);
        break;
      case WriteAction.Delete:
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
  (
    db: Firestore,
    guardOf: StoredGuardOf = StoredDocumentSystem.unguarded,
    log: Log = NO_LOG,
  ): CommitPlan =>
  async <S, D, E>(
    read: (tx: ReadTx) => Promise<S>,
    decide: (
      snapshot: S,
    ) => Result<D & { readonly writes: readonly WriteOp[] }, E>,
  ): Promise<Result<D, E | RepositoryError>> => {
    let creates: readonly DocPath[] = [];
    // The refusal the LAST attempt answered (at most one entry) — logged
    // once, after the transaction settles, never per contention attempt.
    const answered: RepositoryError[] = [];
    try {
      const settled = await db.runTransaction(
        async (tx): Promise<Result<D, E | RepositoryError>> => {
          answered.length = 0;
          // Each attempt records its own refusals, first one first.
          const refusals: RepositoryError[] = [];
          const snapshot = await read(
            firestoreReadTx(db, tx, guardOf, (error) => {
              refusals.push(error);
            }),
          );
          const malformed = refusals[0];
          if (malformed !== undefined) {
            answered.push(malformed);
            return Result.err(malformed);
          }
          const decision = decide(snapshot);
          if (!decision.ok) return decision;
          const { writes, ...answer } = decision.value;
          const refused = setAndDeleted(writes);
          if (refused !== null) {
            return Result.err(
              RepositoryError.writeFailed(
                slashed(refused),
                FIELD_SET_AND_DELETED,
              ),
            );
          }
          creates = writes
            .filter((op) => op.writeAction === WriteAction.Create)
            .map((op) => op.path);
          applyPlan(db, tx, writes);
          // `answer` is the decision minus its plan — `D` exactly, which the
          // spread's `Omit` cannot prove for a generic `D`.
          return Result.ok(answer as unknown as D);
        },
      );
      const refusal = answered[0];
      if (refusal !== undefined) logRefusal(log, refusal);
      return settled;
    } catch (error) {
      if (TriggerAttemptSystem.failureCode(error) !== ALREADY_EXISTS) {
        throw error;
      }
      return Result.err(
        RepositoryError.alreadyExists(conflictPath(error, creates)),
      );
    }
  };
