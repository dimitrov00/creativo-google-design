import {
  type DocumentData,
  type DocumentReference,
  type Query,
  getDoc,
  getDocs,
  onSnapshot,
} from 'firebase/firestore';
import type { Observable } from 'rxjs';
import { RepositoryError, Result } from '@core/primitives';
import { subscribeWithRetry } from './subscribe-with-retry';

/**
 * The web data layer's shared reads (flip 1, plan §3.4) — written ONCE and
 * used by every `(db) => bundle` adapter of this lib: a live document, a live
 * query, a one-shot document, a one-shot query and a guarded write. Each
 * answers the flat `Result<X, RepositoryError>` of the ECS ports.
 *
 * Zero mapping (Law 5): a document body IS the entity minus `id`, so an
 * entity is `{ id, ...snap.data() }` — {@link entityOf}, and nothing else. No
 * field is renamed, defaulted, parsed or dropped here; a body that is not its
 * entity is a writer's defect, never a reader's to repair.
 *
 * The live reads go through `subscribeWithRetry` — the one place reconnect
 * behaviour is defined (a healable code re-listens on the backoff schedule,
 * a rule denial or a missing index surfaces once and stops) — and turn its
 * failure into `RepositoryError.readFailed(path, reason)`, the reason being
 * Firestore's own code (`permission-denied`, `failed-precondition`).
 */

/**
 * A document as its entity: the body spread beside its id. The one cast of
 * the web data layer — Firestore types a body `DocumentData`, and the
 * archetype is exactly that body plus its id (as `firestoreReadTx` does on
 * the server).
 */
export function entityOf<E>(id: string, data: DocumentData): E {
  return { id, ...data } as E;
}

/** The store's own reason for a failure: Firestore's `code`, else the message. */
export function reasonOf(cause: unknown): string | null {
  if (typeof cause === 'object' && cause !== null) {
    const code = (cause as { readonly code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return cause instanceof Error ? cause.message : null;
}

/** A refused or failed read of `path`. */
export function readFailed(path: string, cause: unknown): RepositoryError {
  return RepositoryError.readFailed(path, reasonOf(cause));
}

/** A refused or failed write of `path`. */
export function writeFailed(path: string, cause: unknown): RepositoryError {
  return RepositoryError.writeFailed(path, reasonOf(cause));
}

/** A live read through `subscribeWithRetry`, its failure naming `path`. */
function live<T>(
  path: string,
  subscribe: Parameters<typeof subscribeWithRetry<T>>[0],
): Observable<Result<T, RepositoryError>> {
  return subscribeWithRetry<T>(subscribe, (cause) => readFailed(path, cause));
}

/** One document, live — its entity, or `null` while there is no document. */
export function observeDoc<E>(
  ref: DocumentReference,
): Observable<Result<E | null, RepositoryError>> {
  return live<E | null>(ref.path, (next, error) =>
    onSnapshot(
      ref,
      (snap) => {
        const data = snap.data();
        next(data === undefined ? null : entityOf<E>(snap.id, data));
      },
      error,
    ),
  );
}

/** One query, live — its entities in the query's own order. `path` names the collection it reads. */
export function observeQuery<E>(
  query: Query,
  path: string,
): Observable<Result<readonly E[], RepositoryError>> {
  return live<readonly E[]>(path, (next, error) =>
    onSnapshot(
      query,
      (snap) => next(snap.docs.map((doc) => entityOf<E>(doc.id, doc.data()))),
      error,
    ),
  );
}

/** One document, once — its entity, or `null` when there is none. */
export async function readDoc<E>(
  ref: DocumentReference,
): Promise<Result<E | null, RepositoryError>> {
  try {
    const snap = await getDoc(ref);
    const data = snap.data();
    return Result.ok(data === undefined ? null : entityOf<E>(snap.id, data));
  } catch (cause) {
    return Result.err(readFailed(ref.path, cause));
  }
}

/** One query, once — its entities in the query's own order. `path` names the collection it reads. */
export async function readQuery<E>(
  query: Query,
  path: string,
): Promise<Result<readonly E[], RepositoryError>> {
  try {
    const snap = await getDocs(query);
    return Result.ok(snap.docs.map((doc) => entityOf<E>(doc.id, doc.data())));
  } catch (cause) {
    return Result.err(readFailed(path, cause));
  }
}

/** A write of `path` as a `Result`: the SDK's rejection becomes `RepositoryError.writeFailed`. */
export async function attemptWrite(
  path: string,
  write: () => Promise<unknown>,
): Promise<Result<void, RepositoryError>> {
  try {
    await write();
    return Result.ok(undefined);
  } catch (cause) {
    return Result.err(writeFailed(path, cause));
  }
}
