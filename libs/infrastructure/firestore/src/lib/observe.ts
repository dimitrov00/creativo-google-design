import {
  type DocumentData,
  type DocumentReference,
  type Query,
  getDoc,
  getDocs,
  onSnapshot,
} from 'firebase/firestore';
import { type Observable, map } from 'rxjs';
import { Result, defect } from '@core/primitives';
import { RepositoryError } from '@core/errors';
import type { Log, LogPorts } from '@core/ports';
import {
  type StoredDocument,
  StoredDocumentSystem,
  type StoredGuardOf,
} from '@core/systems';
import { subscribeWithRetry } from './subscribe-with-retry';

/**
 * The web data layer's shared reads (flip 1, plan §3.4) — written ONCE and
 * used by every `(db) => bundle` adapter of this lib: a live document, a live
 * query, a one-shot document, a one-shot query and a guarded write. Each
 * answers the flat `Result<X, RepositoryError>` of the ECS ports.
 *
 * Zero mapping (Law 5): a document body IS the entity minus `id`, so an
 * entity is `{ id, ...snap.data() }` — {@link entityOf}, and nothing else. No
 * field is renamed, defaulted or parsed here.
 *
 * The read-time guard (edge hardening D-1, D-3): every helper takes a
 * {@link ReadGuard} — the stored-document guard registry plus the log a
 * refusal is reported through. An adapter of a guarded collection takes
 * its guard as a REQUIRED parameter (OR-33, DEP-F24: a bare one no longer
 * type-checks) and hands it to every read; an adapter that reads only
 * collections the registry never guards may leave it out and reads
 * {@link AS_STORED}, which refuses — a defect, at once — to read a guarded
 * collection unguarded. The registry that guards nothing is test support
 * (`UNGUARDED`, this lib's `src/testing/unguarded.ts`). Guarded
 * (`guardedReads`, bound by the composition root for the appointment,
 * customer, scheduling and team-note bundles), a top-level `appointments` /
 * `customers` / `barberBusy` / `appointmentNotes` document passes its
 * `StoredDocumentSystem` guard first. An ADMITTED document is THE SAME OBJECT it always was (zero
 * mapping kept — validate, then the entity). A REFUSED one — a body that is
 * not its entity, a writer's defect or a hand edit — is never handed on:
 *
 * - a SINGLE read ({@link admitted}: `observeDoc`, `readDoc`, a `limit 1`
 *   lookup) answers `RepositoryError.malformed(path, field)`; live, the
 *   refusal is an emitted VALUE and the listener stays (a corrected
 *   document emits `ok` again);
 * - a LIST ({@link keepAdmitted}) DROPS the row and answers the rest — one
 *   bad document never blanks a staff day or a search — unless the read
 *   drops rows and keeps NONE (the systemic rule: a bulk drift or a stale
 *   chunk's dictionary reads as the screen's failure, never as an empty
 *   day); a strict list (`RefuseMalformed`, the client's upcoming
 *   bookings) answers the refusal on its first bad row. The staff day
 *   reads the same rule COUNTED ({@link admitCounted}): the rows and how
 *   many were dropped, so its sheet says so (OR-2).
 *
 * Each refusal is reported ONCE per document path per port call through
 * the guard's `log` (`'malformed document refused'` for a single or a
 * strict list, `'malformed document dropped'` for a dropped row,
 * `{ path, field }`); the web app's sink is `errorHandlerLogPorts`, which
 * today reaches the device console only.
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

/**
 * How the shared reads treat a stored document of a guarded collection —
 * the registry to dispatch on and the log a refusal is reported through.
 */
export type ReadGuard = {
  readonly guardOf: StoredGuardOf;
  readonly log: Log;
};

/**
 * The shared reads' guard when an adapter gives none — an adapter that
 * reads only collections the registry never guards (`locations`, `users`,
 * the catalogue, the programs, …): their documents read as stored, as they
 * always did, and nothing is reported. A GUARDED collection (`appointments`,
 * `customers`, `barberBusy`, `appointmentNotes`) read through it is a
 * programmer defect, raised at the read (a list before its first row, a
 * single read on the document it finds; OR-33): its adapter takes a
 * `ReadGuard` as a required parameter, so the next read site that forgets
 * one fails loudly instead of reading unguarded.
 */
export const AS_STORED: ReadGuard = {
  guardOf: (collection) => {
    if (StoredDocumentSystem.guardOf(collection) !== null) {
      defect(
        `${collection} read without its guard — its adapter takes the composition root's ReadGuard (OR-33)`,
      );
    }
    return null;
  },
  log: () => undefined,
};

/**
 * The guard the composition root binds (`app.config.ts`, inside the lazy
 * scope): the stored-document guard registry, refusals reported through
 * `ports.log`.
 */
export function guardedReads(ports: LogPorts): ReadGuard {
  return { guardOf: StoredDocumentSystem.guardOf, log: ports.log };
}

/** The report line of a single or a strict list's refusal. */
const REFUSED = 'malformed document refused';
/** The report line of a row a list dropped. */
const DROPPED = 'malformed document dropped';

/**
 * How a list answers a malformed row — the ONLY source of these strings (an
 * adapter-local dictionary).
 */
export const ListAdmission = {
  /** Drop and report each bad row; refuse only when rows were read and none kept. */
  DropMalformed: 'DROP_MALFORMED',
  /**
   * Drop and report each bad row, never refuse — a PART of an answer whose
   * systemic rule is judged on the whole elsewhere (a later page of the
   * client's history: the first page judged it).
   */
  DropOnly: 'DROP_ONLY',
  /** Refuse the whole answer on the first bad row (the client's upcoming bookings). */
  RefuseMalformed: 'REFUSE_MALFORMED',
} as const;
export type ListAdmission = (typeof ListAdmission)[keyof typeof ListAdmission];

/**
 * Reports one refusal through the guard's log — once per path when a
 * `reported` set is given (a live read re-emitting the same bad document
 * reports it on its first snapshot only).
 */
function report(
  guard: ReadGuard,
  line: string,
  error: RepositoryError,
  reported: Set<string> | null,
): void {
  const key = error.path ?? '';
  if (reported !== null) {
    if (reported.has(key)) return;
    reported.add(key);
  }
  guard.log('error', line, { path: error.path, field: error.reason });
}

/** The collection a document reference sits in — its path minus the last segment. */
function collectionOfRef(ref: DocumentReference): string {
  const path = ref.path;
  return path.slice(0, Math.max(0, path.lastIndexOf('/')));
}

/**
 * The SINGLE rule: a document of `collection` (or none) through the
 * guard — the same object when admitted or unguarded, `null` when absent,
 * `RepositoryError.malformed(path, field)` (reported) when refused. Never
 * read as "no document": a refused record is not an absent one.
 */
export function admitted<E>(
  doc: StoredDocument | null,
  collection: string,
  guard: ReadGuard,
  reported: Set<string> | null = null,
): Result<E | null, RepositoryError> {
  if (doc === null) return Result.ok(null);
  // The one dispatch rule every read site shares (web and functions).
  const verdict = StoredDocumentSystem.admit(guard.guardOf, collection, doc);
  if (verdict.ok) {
    // Admitted field by field (or read as stored, unguarded) — the entity.
    return verdict as unknown as Result<E | null, RepositoryError>;
  }
  report(guard, REFUSED, verdict.error, reported);
  return verdict;
}

/**
 * A list's admitted rows and how many the guard dropped from them — the
 * staff day's answer (`BarberDayRead`, OR-2) says the count beside the
 * rows, so a dropped visit never draws its time as a free gap.
 */
export type CountedRows<E> = {
  readonly kept: readonly E[];
  readonly dropped: number;
};

/**
 * The LIST rule over rows of `collection`, as read, COUNTED (OR-2). DROP
 * (the default): each refused row is dropped and reported once per path
 * (`reported`), the rest answered in their order — `kept` is the SAME
 * array when nothing was dropped — with `dropped` the number of rows the
 * guard refused (`0` on a clean or an unguarded read), counted in the loop
 * that drops them; when rows were read and NONE kept, the first refusal is
 * the answer (the systemic rule; an empty read is `{ kept: [], dropped: 0 }`).
 * DROP ONLY: the same drop and count, never the systemic refusal (a part of
 * a whole the caller judges). REFUSE: the first refused row is the answer.
 * Admitted rows are the same objects. An answer read in several parts (the
 * staff search's two halves) is admitted ONCE, whole, so the systemic rule
 * judges the whole answer.
 */
export function admitCounted<E>(
  docs: readonly StoredDocument[],
  collection: string,
  guard: ReadGuard,
  reported: Set<string> | null,
  admission: ListAdmission = ListAdmission.DropMalformed,
): Result<CountedRows<E>, RepositoryError> {
  const check = guard.guardOf(collection);
  if (check === null) {
    return Result.ok({ kept: docs as unknown as readonly E[], dropped: 0 });
  }
  // Allocated only once a row is dropped: a clean read answers `docs` itself.
  let kept: StoredDocument[] | null = null;
  let firstRefusal: RepositoryError | null = null;
  let seen = 0;
  let dropped = 0;
  for (const doc of docs) {
    seen++;
    const verdict = check(doc);
    if (verdict.ok) {
      if (kept !== null) kept.push(doc);
      continue;
    }
    if (admission === ListAdmission.RefuseMalformed) {
      report(guard, REFUSED, verdict.error, reported);
      return verdict;
    }
    report(guard, DROPPED, verdict.error, reported);
    dropped++;
    firstRefusal ??= verdict.error;
    // Every row before this one was admitted.
    kept ??= docs.slice(0, seen - 1);
  }
  if (kept === null) {
    return Result.ok({ kept: docs as unknown as readonly E[], dropped: 0 });
  }
  if (
    kept.length === 0 &&
    firstRefusal !== null &&
    admission === ListAdmission.DropMalformed
  ) {
    return Result.err(firstRefusal);
  }
  return Result.ok({ kept: kept as unknown as readonly E[], dropped });
}

/**
 * The LIST rule's rows alone ({@link admitCounted} without the count) —
 * what every list but the staff day answers (the search, the histories,
 * the client's upcoming bookings): the same drop, the same report, the
 * same systemic refusal, the SAME array when nothing was dropped.
 */
export function keepAdmitted<E>(
  docs: readonly StoredDocument[],
  collection: string,
  guard: ReadGuard,
  reported: Set<string> | null,
  admission: ListAdmission = ListAdmission.DropMalformed,
): Result<readonly E[], RepositoryError> {
  const counted = admitCounted<E>(docs, collection, guard, reported, admission);
  return counted.ok ? Result.ok(counted.value.kept) : counted;
}

/** A live read through `subscribeWithRetry`, its failure naming `path`. */
function live<T>(
  path: string,
  subscribe: Parameters<typeof subscribeWithRetry<T>>[0],
): Observable<Result<T, RepositoryError>> {
  return subscribeWithRetry<T>(subscribe, (cause) => readFailed(path, cause));
}

/**
 * A live read whose every snapshot already answers a `Result` (the guard's
 * verdict), flattened: a refusal is an emitted VALUE, so
 * `subscribeWithRetry` keeps the listener.
 */
function liveAnswer<T>(
  path: string,
  subscribe: Parameters<
    typeof subscribeWithRetry<Result<T, RepositoryError>>
  >[0],
): Observable<Result<T, RepositoryError>> {
  return live<Result<T, RepositoryError>>(path, subscribe).pipe(
    map((answer) => (answer.ok ? answer.value : answer)),
  );
}

/** A query snapshot's rows as stored documents — `{ id, ...data }` each. */
function rowsOf(docs: readonly QueryDocumentLike[]): StoredDocument[] {
  const rows: StoredDocument[] = [];
  for (const doc of docs)
    rows.push(entityOf<StoredDocument>(doc.id, doc.data()));
  return rows;
}

/** What a query snapshot's document offers the reads. */
type QueryDocumentLike = {
  readonly id: string;
  data(): DocumentData;
};

/**
 * One document, live — its entity, or `null` while there is no document;
 * guarded, a malformed one emits the SINGLE rule's refusal and the listener
 * stays.
 */
export function observeDoc<E>(
  ref: DocumentReference,
  guard: ReadGuard = AS_STORED,
): Observable<Result<E | null, RepositoryError>> {
  const collection = collectionOfRef(ref);
  const reported = new Set<string>();
  return liveAnswer<E | null>(ref.path, (next, error) =>
    onSnapshot(
      ref,
      (snap) => {
        const data = snap.data();
        next(
          admitted<E>(
            data === undefined ? null : entityOf<StoredDocument>(snap.id, data),
            collection,
            guard,
            reported,
          ),
        );
      },
      error,
    ),
  );
}

/**
 * One query, live — its entities in the query's own order. `path` names the
 * collection it reads; guarded, every snapshot answers the LIST rule
 * (`admission`, drop by default), each bad row reported once per call.
 */
export function observeQuery<E>(
  query: Query,
  path: string,
  guard: ReadGuard = AS_STORED,
  admission: ListAdmission = ListAdmission.DropMalformed,
): Observable<Result<readonly E[], RepositoryError>> {
  const reported = new Set<string>();
  return liveAnswer<readonly E[]>(path, (next, error) =>
    onSnapshot(
      query,
      (snap) =>
        next(
          keepAdmitted<E>(rowsOf(snap.docs), path, guard, reported, admission),
        ),
      error,
    ),
  );
}

/**
 * One query, live, COUNTED — {@link observeQuery}'s rows with the number
 * each snapshot's guard dropped beside them (`admitCounted`, drop by
 * default): the staff day's read, whose sheet words the count (OR-2).
 */
export function observeCountedQuery<E>(
  query: Query,
  path: string,
  guard: ReadGuard,
): Observable<Result<CountedRows<E>, RepositoryError>> {
  const reported = new Set<string>();
  return liveAnswer<CountedRows<E>>(path, (next, error) =>
    onSnapshot(
      query,
      (snap) => next(admitCounted<E>(rowsOf(snap.docs), path, guard, reported)),
      error,
    ),
  );
}

/** One document, once — its entity, or `null` when there is none; guarded, the SINGLE rule. */
export async function readDoc<E>(
  ref: DocumentReference,
  guard: ReadGuard = AS_STORED,
): Promise<Result<E | null, RepositoryError>> {
  let data: DocumentData | undefined;
  let id: string;
  try {
    const snap = await getDoc(ref);
    data = snap.data();
    id = snap.id;
  } catch (cause) {
    return Result.err(readFailed(ref.path, cause));
  }
  return admitted<E>(
    data === undefined ? null : entityOf<StoredDocument>(id, data),
    collectionOfRef(ref),
    guard,
  );
}

/**
 * One query, once, RAW — its rows as stored (`{ id, ...data }` each), in
 * the query's own order, through NO guard: for a read that cuts its rows
 * BEFORE they are admitted (a history page and its cursor, the staff
 * search's two halves judged as one answer, a `limit 1` lookup answering
 * the SINGLE rule), whose adapter then hands them to {@link admitted} or
 * {@link keepAdmitted} with its guard. Never a port's answer by itself:
 * its rows are stored documents, not entities.
 */
export async function readRawQuery(
  query: Query,
  path: string,
): Promise<Result<readonly StoredDocument[], RepositoryError>> {
  try {
    return Result.ok(rowsOf((await getDocs(query)).docs));
  } catch (cause) {
    return Result.err(readFailed(path, cause));
  }
}

/**
 * One query, once — its entities in the query's own order. `path` names the
 * collection it reads; guarded, the LIST rule (drop, systemic refusal).
 */
export async function readQuery<E>(
  query: Query,
  path: string,
  guard: ReadGuard = AS_STORED,
): Promise<Result<readonly E[], RepositoryError>> {
  const rows = await readRawQuery(query, path);
  return rows.ok ? keepAdmitted<E>(rows.value, path, guard, null) : rows;
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
