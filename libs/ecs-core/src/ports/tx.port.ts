import type { Result, UtcEpochMs } from '@core/primitives';
import type { RepositoryError } from '@core/errors';
import type { DocPath, WriteOp } from '@core/components';
import type { QueryOp } from '@core/entities';

/**
 * The transactional sandwich (Law 4), split by direction (blueprint §4,
 * §6 Phase 1). A pipeline's read callback receives a {@link ReadTx} and
 * NOTHING that writes; its pure decision returns one write plan
 * (`readonly writes: WriteOp[]`); the single {@link CommitPlan} port applies
 * that plan atomically. `set`/`create`/`update`/`delete` exist only inside
 * the adapter that applies a `WriteOp[]`, so a read half can never write
 * mid-transaction.
 *
 * `CommitPlan` is the ONE commit port. The pipeline table's
 * `txCommitPlan`, `txCommitBooking`, `txUpdateAppointment` and the
 * backfill's per-row `writePage` (§4.1) are all this port: voucher
 * restores, busy merges, grant burns, waitlist notifications and an act's
 * audit rows (audit-hardening WS-1) are entries of the one plan, never a
 * second write port. The one write after a commit is the backfill's
 * `appendAudit` (`governance.port.ts`, one row per CALL — L2); task
 * enqueueing joins it when a task port exists.
 */

/**
 * A collection path as alternating collection names and ids — odd length:
 * `['appointments']`, `['users', uid, 'notifications']`. Names come from
 * `entities/collections.ts`, never a literal at the call site.
 */
export type CollectionPath = readonly string[];

/**
 * One `where` clause. `field` is a ROOT field of the flat document
 * (`bookingStatus`, `utcEpochMs` — Laws 5 and 6), never a dotted component
 * path: every collection is flat, and the in-memory doubles read the root
 * key and nothing deeper.
 */
export type QueryFilter = {
  readonly field: string;
  /** Firestore's own filter vocabulary, verbatim — the `QueryOp` dictionary (`entities/collections.ts`). */
  readonly op: QueryOp;
  /** A scalar, or an array for `in` / `not-in` / `array-contains-any`. */
  readonly value: unknown;
};

/** One `orderBy` clause on a ROOT field, as {@link QueryFilter}; `descending: false` is ascending. */
export type QueryOrder = {
  readonly field: string;
  readonly descending: boolean;
};

/**
 * A query as data — what a transaction's `query` reads, so a pipeline spec
 * can assert the read set it asked for. Every composite it implies is
 * declared in `firestore.indexes.json` in the same change (Law 5).
 */
export type QuerySpec = {
  readonly collection: CollectionPath;
  readonly where: readonly QueryFilter[];
  readonly orderBy: readonly QueryOrder[];
  /** `null` reads every match. */
  readonly limit: number | null;
};

/**
 * One document inside the transaction: the entity (`{ id, ...data }` — the
 * document body IS the entity minus `id`, Law 5), or `null` when absent. An
 * absent read still enters the conflict set, which is why busy and
 * exception keys are read even when nothing is stored there.
 */
export type TxGet = <E>(path: DocPath) => Promise<E | null>;

/**
 * Several documents in one round trip, positions preserved: `out[i]` is the
 * document at `paths[i]`, `null` when absent.
 */
export type TxGetAll = <E>(
  paths: readonly DocPath[],
) => Promise<readonly (E | null)[]>;

/** Every document a query matches, as entities, in the query's order. */
export type TxQuery = <E>(query: QuerySpec) => Promise<readonly E[]>;

/**
 * The read half of a transaction — the only thing a pipeline's read
 * callback receives. Plain function members, never methods; nothing here
 * writes.
 */
export type ReadTx = {
  readonly get: TxGet;
  readonly getAll: TxGetAll;
  readonly query: TxQuery;
};

/**
 * The single commit port (`ecs-pipelines.md`'s `CommitBooking`,
 * generalised). Runs `read` inside one transaction, hands the snapshot to
 * the pure `decide`, applies the returned `writes` atomically and answers
 * the decision without its plan. A refusal (`Result.err`) writes nothing.
 * The adapter retries the whole read → decide on contention, so `decide`
 * must be pure — it may run more than once.
 *
 * Writes touch ROOT fields only (Laws 5 and 6): an `Update` merges its
 * root `fields` and removes its root `deleteFields` (`FieldValue.delete()`),
 * so a variant transition leaves the document exactly one variant. A plan
 * naming one key in both lists is refused whole as
 * `RepositoryError.writeFailed(path, 'field-set-and-deleted')`; nothing of
 * it is applied.
 *
 * A `Create` over a document already there (Firestore's ALREADY_EXISTS) is
 * an EXPECTED outcome — a deterministic id met its replay (the audit row,
 * the users stub, a waitlist notification) or lost a create race — so it
 * answers as a value, `RepositoryError.alreadyExists(path)`
 * (`RepositoryErrorCode.AlreadyExists`), and nothing of the plan is applied; the
 * pipeline decides whether that is the replay or a refusal. Only an
 * infrastructure failure (contention retries exhausted, the store
 * unreachable, an `Update` of an absent document) rejects the promise: it
 * is not an expected outcome, and the edge maps it once.
 *
 * A read of a MALFORMED document of a guarded collection (`appointments`,
 * `customers`, `barberBusy` — `StoredDocumentSystem`, edge hardening D-3)
 * refuses the whole commit as a value: the read half answers that document
 * as `null` (a query leaves it out) so the read callback can finish, and
 * the commit answers `RepositoryError.malformed(path, field)` — the FIRST
 * refusal — before `decide` runs; nothing is written. No decision is ever
 * made on a malformed document. A contention re-run starts with a clean
 * record.
 */
export type CommitPlan = <S, D, E>(
  read: (tx: ReadTx) => Promise<S>,
  decide: (
    snapshot: S,
  ) => Result<D & { readonly writes: readonly WriteOp[] }, E>,
) => Promise<Result<D, E | RepositoryError>>;

/** A digest — sha256 hex in production — for deterministic ids (`hash(rowBasis)`). */
export type Hash = (input: string) => string;

/**
 * A KEYED digest — HMAC-SHA-256 hex under a server-held secret in
 * production — for a deterministic id whose input is a person's contact (a
 * walk-in's phone or e-mail, OR-26). A plain {@link Hash} of a phone number
 * is reversible by brute force (a country's mobile numbers are a few tens
 * of millions of candidates), and the id is readable wherever the record is
 * referenced; under a key nobody outside the server holds it reveals
 * nothing. Same key and input, same digest — so the id still dedupes and a
 * retried save still meets its own record.
 */
export type KeyedHash = (input: string) => string;

/**
 * The clock, as an absolute instant — a port so specs can pin it. The
 * boundary turns it into the shop's `ShopNow` once per request
 * (`ZonedTimeSystem.shopNow(ports.nowUtcMs(), location.timeZone)`); a
 * system receives that, or the bare instant only to stamp a lifecycle field.
 */
export type NowUtcMs = () => UtcEpochMs;

/** A fresh document id — a port so specs can pin it. */
export type NextId = () => string;

// ── Focused bundles (Law 9 — composed with `&`, never sliced) ─────────────

/** The commit port alone — a pipeline that only writes a plan. */
export type CommitPorts = {
  readonly commit: CommitPlan;
};

/** The digest for deterministic ids. */
export type HashPorts = {
  readonly hash: Hash;
};

/**
 * The keyed digest a walk-in's record id is derived with
 * (`CustomerId.forWalkIn`, OR-26) — only the server pipelines that mint
 * walk-ins (`bookAppointment`, `editAppointment`) and the admin privacy
 * pipelines that recognise them (`exportClientData`, audit-hardening
 * Phase 3, P3-RU-36) take it, and only the callables that run them hold its
 * secret (`WALKIN_ID_KEY`).
 */
export type WalkInKeyPorts = {
  readonly walkInHash: KeyedHash;
};

/** The clock — the one absolute instant a request reads. */
export type ClockPorts = {
  readonly nowUtcMs: NowUtcMs;
};

/** The id source. */
export type IdPorts = {
  readonly nextId: NextId;
};

/**
 * Wait `ms` milliseconds — the browser's timer, a port so specs run
 * immediately and record the delays asked for (`ensureSessionReady`'s
 * refresh back-off). Never a clock read.
 */
export type Delay = (ms: number) => Promise<void>;

/** The timer — `TIMER_PORTS` / `browserTimerPorts()`. */
export type TimerPorts = {
  readonly delay: Delay;
};

/**
 * The transaction bundle: the commit port plus the three impure
 * primitives every pipeline hands its systems as parameters (a system never
 * reads a clock, draws an id or hashes on its own — Law 3).
 */
export type TxPorts = CommitPorts & HashPorts & ClockPorts & IdPorts;
