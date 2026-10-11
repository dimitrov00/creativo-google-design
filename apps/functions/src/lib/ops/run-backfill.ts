import { randomBytes } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  FieldPath,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import { UserId } from '@creativo/domain/accounts';
import {
  type ClientStatsPolicy,
  computeClientMoneyStats,
  computeClientStats,
} from '@creativo/domain/scheduling';
import {
  CLIENT_STATS_COLLECTION,
  type PersistedDocument,
  clientMoneyContent,
  clientMoneyFromDocument,
  clientStatsContent,
  clientStatsFromDocument,
  subjectUserIdsFromDocument,
} from '@creativo/application/booking';
import { AUDIT_LOG_COLLECTION } from '@creativo/application/shared';
import type { Actor } from '@creativo/domain/governance';
import {
  BackfillPhase,
  type BackfillPageWalk,
  BackfillPlanSystem,
} from '@creativo/ecs-core';
import { adminFirestore } from '../firebase-admin';
import { type AuditInput, appendAudit } from '../booking/audit';
import { callerActor, callerRoles } from '../booking/caller-roles';
import { failureCode } from '../trigger-attempts';
import {
  CALLABLE_CLIENT_TIMEOUT_SECONDS,
  type WorkBudget,
  callableBudgetMs,
  timeBudget,
  walkWithin,
} from './work-budget';
import {
  canonicalJson,
  placementsFrom,
} from '../clients/client-stats-projection';
import {
  appointmentsFrom,
  clientStatsRefs,
  historyQuery,
  loadClientStatsPolicy,
  recomputeClientStats,
} from '../clients/recompute-client-stats';
import {
  BACKFILL_CHUNK_SIZE,
  BACKFILL_JOBS_COLLECTION,
  BACKFILL_PAGE_SIZE,
  type BackfillJob,
  type BackfillRequest,
  backfillJobNameOf,
  inferPlacement,
  lacksPlacement,
  mayLackMirrors,
  mirrorPatch,
  positionOf,
  toBackfillRequest,
} from './backfill-plan';

/** 20 stored clients recomputed from scratch at the end of a stats run (§12.5.3). */
export interface SampleDiff {
  readonly checked: number;
  /** Clients whose stored answer differs from a fresh one — must be empty. */
  readonly mismatched: readonly string[];
}

export interface BackfillPageResult {
  readonly job: BackfillJob;
  /** Pass back to continue (opaque); `null` once the job is done. */
  readonly cursor: string | null;
  readonly done: boolean;
  /** This call's page: appointments walked. */
  readonly processed: number;
  /** This call's page: stored `clientStats` documents walked. */
  readonly storedClients: number;
  readonly stamped: number;
  readonly recomputed: number;
  /** Appointments walked by the whole run so far, across calls. */
  readonly total: number;
  /** When the run this page belongs to started — a call from the top starts a new one. */
  readonly runStartedAt: string;
  /** The cursor this page started after, as resolved (a resuming call's comes from the progress document). */
  readonly startedFrom: string | null;
  readonly sample: SampleDiff | null;
  /**
   * This call stopped taking work because its time budget ran out — inside
   * a page, or before the closing sample. Nothing is lost: `cursor` is where
   * the next call picks up.
   */
  readonly budgetSpent: boolean;
}

export interface BackfillDeps {
  readonly clockMs: () => number;
  readonly loadPolicy: (db: Firestore) => Promise<ClientStatsPolicy>;
  readonly pageSize: number;
  /** Rows handled between two looks at the budget. */
  readonly chunkSize: number;
  readonly sampleSize: number;
  /** Where the sample starts in the id space — random in production. */
  readonly samplePivot: () => string;
  /** This call's time allowance, started as the call starts. */
  readonly startBudget: () => WorkBudget;
}

/**
 * The callable's platform timeout — kept long on purpose: it is the reserve
 * the chunk in hand, the closing sample and the audit row are never killed
 * inside. It is not what bounds the call; the budget is.
 */
export const RUN_BACKFILL_TIMEOUT_SECONDS = 540;

/**
 * How long a call takes new work: a share of the client's wait, not the
 * platform's (`callableBudgetMs`) — 49 s, so the answer lands inside the
 * Firebase callable SDK's default 70 s, and far inside `fetch`'s 300 s
 * (undici's `headersTimeout`). The runners that loop it
 * (`tools/verify/p0/verify-p0.mjs`) wait longer than the platform's timeout,
 * so they never walk away from a call still running; one whose answer is
 * lost anyway calls again WITHOUT a cursor and continues from the progress
 * document. A smaller budget costs only more calls (and rows) per run.
 */
export const RUN_BACKFILL_BUDGET_MS = callableBudgetMs(
  RUN_BACKFILL_TIMEOUT_SECONDS,
  CALLABLE_CLIENT_TIMEOUT_SECONDS,
);

const LIVE: BackfillDeps = {
  clockMs: Date.now,
  loadPolicy: loadClientStatsPolicy,
  pageSize: BACKFILL_PAGE_SIZE,
  chunkSize: BACKFILL_CHUNK_SIZE,
  sampleSize: 20,
  samplePivot: () => randomBytes(10).toString('hex'),
  startBudget: () => timeBudget(Date.now, RUN_BACKFILL_BUDGET_MS),
};

/** `backfillJobs/{job}` — one per job, rewritten by every call. */
interface StoredProgress {
  readonly cursor: string | null;
  readonly processed: number;
  readonly storedClients: number;
  readonly stamped: number;
  readonly recomputed: number;
  readonly startedAt: string;
  readonly finishedAt: string | null;
}

function progressFrom(
  data: PersistedDocument | undefined,
): StoredProgress | null {
  if (data === undefined) return null;
  const fields = new Map(Object.entries(data));
  const n = (key: string): number => {
    const value = fields.get(key);
    return typeof value === 'number' ? value : 0;
  };
  return {
    cursor: typeof data['cursor'] === 'string' ? data['cursor'] : null,
    processed: n('processed'),
    storedClients: n('storedClients'),
    stamped: n('stamped'),
    recomputed: n('recomputed'),
    startedAt: typeof data['startedAt'] === 'string' ? data['startedAt'] : '',
    finishedAt:
      typeof data['finishedAt'] === 'string' ? data['finishedAt'] : null,
  };
}

/** Run `work` over `items`, `width` at a time — bounded fan-out, in order of batches. */
async function inBatches<T, R>(
  items: readonly T[],
  width: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += width) {
    results.push(
      ...(await Promise.all(items.slice(start, start + width).map(work))),
    );
  }
  return results;
}

/**
 * The audit actions filed against each appointment id — the commit's row is
 * what says who placed a booking. `in` takes 30 values a query, and an
 * equality filter needs no composite index.
 */
async function auditActionsFor(
  db: Firestore,
  appointmentIds: readonly string[],
): Promise<ReadonlyMap<string, readonly string[]>> {
  const actions = new Map<string, string[]>();
  for (let start = 0; start < appointmentIds.length; start += 30) {
    const chunk = appointmentIds.slice(start, start + 30);
    const rows = await db
      .collection(AUDIT_LOG_COLLECTION)
      .where('resourceId', 'in', chunk)
      .get();
    for (const row of rows.docs) {
      const resourceId = String(row.get('resourceId') ?? '');
      const list = actions.get(resourceId) ?? [];
      list.push(String(row.get('action') ?? ''));
      actions.set(resourceId, list);
    }
  }
  return actions;
}

/**
 * Stamp one appointment's missing mirrors, re-reading it in a transaction
 * first: the page was read outside one, and a staff edit since then has
 * already written fresher mirrors that a stale patch must not replace.
 */
async function stampMirrors(
  db: Firestore,
  doc: QueryDocumentSnapshot,
  auditActions: readonly string[],
): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const fresh = await tx.get(doc.ref);
    const data = fresh.data();
    if (data === undefined) return false;
    const patch = mirrorPatch(data, inferPlacement(auditActions));
    if (patch === null) return false;
    tx.update(doc.ref, patch);
    return true;
  });
}

/**
 * Recompute a sample of stored clients from scratch WITHOUT writing, at each
 * document's own `updatedAt` so time alone cannot count as drift. A
 * mismatch means the projection and its writer disagree — a bug, not a
 * backlog — and is reported, never silently repaired here.
 */
export async function sampleDiff(
  db: Firestore,
  policy: ClientStatsPolicy,
  size: number,
  pivot: string,
): Promise<SampleDiff> {
  const collection = db.collection(CLIENT_STATS_COLLECTION);
  const byId = FieldPath.documentId();
  const first = await collection
    .where(byId, '>=', pivot)
    .orderBy(byId)
    .limit(size)
    .get();
  const rest =
    first.size < size
      ? await collection
          .orderBy(byId)
          .limit(size - first.size)
          .get()
      : null;
  const docs = [
    ...first.docs,
    ...(rest?.docs.filter((doc) => doc.id < pivot) ?? []),
  ];

  const mismatched: string[] = [];
  for (const doc of docs) {
    const stored = clientStatsFromDocument(doc.id, doc.data());
    const subject = UserId.create(doc.id);
    const moneySnap = await clientStatsRefs(db, doc.id).money.get();
    const storedMoney = clientMoneyFromDocument(doc.id, moneySnap.data());
    if (stored === null || storedMoney === null || subject.isFailure()) {
      mismatched.push(doc.id);
      continue;
    }
    const history = await historyQuery(db, doc.id).get();
    const appointments = appointmentsFrom(doc.id, history.docs);
    const fresh = computeClientStats(
      subject.value,
      appointments,
      stored.updatedAtMs,
      policy,
      placementsFrom(history.docs),
    );
    const money = computeClientMoneyStats(subject.value, appointments);
    if (
      canonicalJson(clientStatsContent(fresh)) !==
        canonicalJson(clientStatsContent(stored)) ||
      canonicalJson(clientMoneyContent(money)) !==
        canonicalJson(clientMoneyContent(storedMoney))
    ) {
      mismatched.push(doc.id);
    }
  }
  return { checked: docs.length, mismatched };
}

/**
 * One page's work, before the progress document records it: the walk as
 * `BackfillPlanSystem.pageWalk` judged it (`next`, `exhausted`,
 * `stoppedEarly`), and its counts.
 */
interface PageOutcome extends BackfillPageWalk {
  readonly processed: number;
  readonly storedClients: number;
  readonly stamped: number;
  readonly recomputed: number;
}

/** What one call reads once and shares: its budget and the stats policy. */
interface CallContext {
  readonly deps: BackfillDeps;
  readonly budget: WorkBudget;
  /** Loaded on first use, once per call — a mirror-only page never reads it. */
  readonly policy: () => Promise<ClientStatsPolicy>;
}

function once<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => (pending ??= load());
}

/** Recompute `userIds` (5 at a time); how many answers were new. */
async function recomputeAll(
  db: Firestore,
  userIds: readonly string[],
  call: CallContext,
): Promise<number> {
  if (userIds.length === 0) return 0;
  const policy = await call.policy();
  const outcomes = await inBatches(userIds, 5, (userId) =>
    recomputeClientStats(db, userId, { policy, clockMs: call.deps.clockMs }),
  );
  return outcomes.filter((outcome) => outcome === 'written').length;
}

/**
 * Stamp what these rows lack. A row that may lack a mirror is re-read and
 * stamped; only one with no placement of either kind needs the audit trail
 * read to infer one — and a row the trail says nothing about keeps none
 * (§12.5.1).
 */
async function stampRows(
  db: Firestore,
  rows: readonly QueryDocumentSnapshot[],
): Promise<number> {
  const stale = rows.filter((doc) => mayLackMirrors(doc.data()));
  const actions = await auditActionsFor(
    db,
    stale.filter((doc) => lacksPlacement(doc.data())).map((doc) => doc.id),
  );
  return (
    await inBatches(stale, 10, (doc) =>
      stampMirrors(db, doc, actions.get(doc.id) ?? []),
    )
  ).filter(Boolean).length;
}

const sum = (values: readonly number[]): number =>
  values.reduce((a, b) => a + b, 0);

/**
 * A page of appointments, a chunk at a time until the budget is spent:
 * stamp what lacks a mirror, then (stats job) recompute the chunk's people.
 * A person on several chunks of the page is recomputed once.
 */
async function appointmentsPage(
  db: Firestore,
  job: BackfillJob,
  after: string | null,
  call: CallContext,
): Promise<PageOutcome> {
  let query = db
    .collection('appointments')
    .orderBy(FieldPath.documentId())
    .limit(call.deps.pageSize);
  if (after !== null) query = query.startAfter(after);
  const page = await query.get();

  const seen = new Set<string>();
  const walk = await walkWithin(
    page.docs,
    call.deps.chunkSize,
    call.budget,
    async (chunk) => {
      const stamped = await stampRows(db, chunk);
      if (job !== 'clientStats') return { stamped, recomputed: 0 };
      const subjects = [
        ...new Set(
          chunk.flatMap((doc) => subjectUserIdsFromDocument(doc.data())),
        ),
      ]
        .filter((uid) => !seen.has(uid))
        .sort();
      for (const uid of subjects) seen.add(uid);
      return { stamped, recomputed: await recomputeAll(db, subjects, call) };
    },
  );

  return {
    ...BackfillPlanSystem.pageWalk(
      BackfillPhase.Appointments,
      page.docs.map((doc) => doc.id),
      walk.handled,
      after,
      call.deps.pageSize,
    ),
    processed: walk.handled,
    storedClients: 0,
    stamped: sum(walk.results.map((r) => r.stamped)),
    recomputed: sum(walk.results.map((r) => r.recomputed)),
  };
}

/**
 * A page of STORED clients, each recomputed from their own history, a
 * chunk at a time until the budget is spent. The appointment walk reaches
 * only people some appointment still names; a stored document whose person
 * is on none — removed from a party while the trigger's event was dropped —
 * is rewritten to the empty answer here, and nowhere else.
 */
async function storedClientsPage(
  db: Firestore,
  after: string | null,
  call: CallContext,
): Promise<PageOutcome> {
  let query = db
    .collection(CLIENT_STATS_COLLECTION)
    .orderBy(FieldPath.documentId())
    .limit(call.deps.pageSize);
  if (after !== null) query = query.startAfter(after);
  const page = await query.select().get();
  const ids = page.docs.map((doc) => doc.id);
  const walk = await walkWithin(
    ids,
    call.deps.chunkSize,
    call.budget,
    (chunk) => recomputeAll(db, chunk, call),
  );
  return {
    ...BackfillPlanSystem.pageWalk(
      BackfillPhase.StoredClients,
      ids,
      walk.handled,
      after,
      call.deps.pageSize,
    ),
    processed: 0,
    storedClients: walk.handled,
    stamped: 0,
    recomputed: sum(walk.results),
  };
}

/**
 * One page of one job — the whole backfill, callable in a loop (§12.5.3).
 *
 * Idempotent and resumable: every write is state-based (a mirror is patched
 * only when it disagrees, a client's stats only when the recomputed answer
 * differs), so a page run twice, a run restarted from the top, or a run
 * racing the live trigger all land on the same bytes. Progress lives in
 * `backfillJobs/{job}`, so a runner that lost its cursor calls again without
 * one and continues where the last call stopped.
 *
 * Bounded by its own budget, never by the platform's timeout: the page is
 * walked a chunk at a time, and once the budget is spent the call takes no
 * new chunk — nor the closing sample — and returns the cursor of the last
 * row it finished. A partial page is an ordinary stop: the next call
 * continues from that row.
 *
 * The `clientStats` job walks the appointments, then the stored clients
 * (`BackfillPhase`); the cursor says which, and the run is done only when
 * both are.
 */
export async function runBackfillPage(
  db: Firestore,
  request: BackfillRequest,
  deps: BackfillDeps = LIVE,
): Promise<BackfillPageResult> {
  const call: CallContext = {
    deps,
    budget: deps.startBudget(),
    policy: once(() => deps.loadPolicy(db)),
  };
  const progressRef = db.collection(BACKFILL_JOBS_COLLECTION).doc(request.job);
  const previous = progressFrom((await progressRef.get()).data());
  const nowIso = new Date(deps.clockMs()).toISOString();

  const resuming = previous !== null && previous.finishedAt === null;
  const cursor =
    request.cursor === undefined
      ? resuming
        ? previous.cursor
        : null
      : request.cursor;
  // Counts carry over only while continuing an unfinished run.
  const carried =
    resuming && cursor !== null
      ? previous
      : {
          processed: 0,
          storedClients: 0,
          stamped: 0,
          recomputed: 0,
          startedAt: nowIso,
        };

  const position = positionOf(cursor);
  const outcome =
    position.phase === 'storedClients' && request.job === 'clientStats'
      ? await storedClientsPage(db, position.after, call)
      : await appointmentsPage(
          db,
          request.job,
          position.phase === 'appointments' ? position.after : null,
          call,
        );

  // How the run goes on (`BackfillPlanSystem.nextPage`): the appointments
  // ran out → the stats job goes on to the stored clients, every other job
  // is finished; the closing sample waits for the next call when the budget
  // is spent (it is new work too), never twice.
  const verdict = BackfillPlanSystem.nextPage(
    backfillJobNameOf(request.job),
    outcome,
    outcome,
    () => call.budget.spent(),
  );
  const { done, sampleDeferred } = verdict;
  const nextCursor = verdict.cursor;
  const sample = verdict.takeSample
    ? await sampleDiff(
        db,
        await call.policy(),
        deps.sampleSize,
        deps.samplePivot(),
      )
    : null;

  const total = carried.processed + outcome.processed;
  await progressRef.set({
    job: request.job,
    cursor: nextCursor,
    processed: total,
    storedClients: carried.storedClients + outcome.storedClients,
    stamped: carried.stamped + outcome.stamped,
    recomputed: carried.recomputed + outcome.recomputed,
    startedAt: carried.startedAt,
    finishedAt: done ? nowIso : null,
    updatedAt: nowIso,
    sample,
  });

  return {
    job: request.job,
    cursor: done ? null : nextCursor,
    done,
    processed: outcome.processed,
    storedClients: outcome.storedClients,
    stamped: outcome.stamped,
    recomputed: outcome.recomputed,
    total,
    runStartedAt: carried.startedAt,
    startedFrom: cursor,
    sample,
    budgetSpent: outcome.stoppedEarly || sampleDeferred,
  };
}

/** The audit row's context for how a call ended — ids, counts and codes only (T5). */
export function backfillAuditContext(
  ended:
    | { readonly kind: 'returned'; readonly result: BackfillPageResult }
    | { readonly kind: 'threw'; readonly error: unknown },
): Readonly<Record<string, string>> {
  if (ended.kind === 'threw') {
    return { outcome: 'failed', code: failureCode(ended.error) };
  }
  const { result } = ended;
  return {
    outcome: result.done ? 'complete' : 'partial',
    processed: String(result.processed),
    storedClients: String(result.storedClients),
    done: String(result.done),
    budgetSpent: String(result.budgetSpent),
    ...(result.cursor === null ? {} : { cursor: result.cursor }),
  };
}

/** Who ran a page, for its change key: the person, or the process. */
function actorKey(actor: Actor): readonly string[] {
  switch (actor.kind) {
    case 'system':
      return [actor.kind, actor.source];
    case 'user':
    case 'staff':
      return [actor.kind, actor.userId.value];
    case 'admin':
    case 'impersonator':
      return [actor.kind, actor.adminUserId.value];
  }
}

/**
 * What makes one returned page ONE logical change for the audit log
 * (`AuditInput.changeKey`): the same person walking the same stretch of the
 * same run to the same end. A replay of that call — a runner re-sending a
 * request whose answer it lost, with the same cursor — derives the same key
 * and its row is not written twice. Everything else is a different change
 * and keeps its own row: a resume without a cursor walks the next stretch,
 * a replay that got further (or less far) ended elsewhere, another sysadmin
 * is another person, and a call from the top starts a new run
 * (`runStartedAt`) — so replaying a run's FIRST call, or the one that
 * finished it, reads as the new run it in fact begins.
 *
 * Only for a page that returned: a failed call's row stays random, since
 * every failed attempt may have committed part of its page and each one is
 * its own entry.
 */
export function backfillChangeKey(
  job: BackfillJob,
  result: BackfillPageResult,
  actor: Actor,
): string {
  return JSON.stringify([
    'ops.backfill/v1',
    job,
    result.runStartedAt,
    result.startedFrom,
    result.cursor,
    result.done,
    ...actorKey(actor),
  ]);
}

/**
 * One call's page and its ONE audit row (§12.5.3), whatever became of it.
 *
 * The page commits as it goes — mirror stamps, then stats, each its own
 * transaction — so a call that throws halfway has still changed the book.
 * The row is written in `finally`, so every way out leaves one: `complete`
 * when the job is done, `partial` with the continuation cursor when it is
 * not (a page boundary, or the budget spent), `failed` with the code when
 * the call threw — and the error goes on to the caller. A row written only
 * on success would leave a privileged caller's partial writes with no name
 * on them. The row is awaited, and a failed audit write is logged by
 * `appendAudit`, never thrown over the answer.
 *
 * The platform timeout can no longer take the row with it: the page stops
 * taking work at `RUN_BACKFILL_BUDGET_MS`, well inside it, and returns. A
 * returned page's row carries `backfillChangeKey`, so a replayed call logs
 * once.
 */
export async function backfillWithAudit(
  db: Firestore,
  input: BackfillRequest,
  actor: Actor | null,
  deps: BackfillDeps = LIVE,
  audit: (row: AuditInput, db?: Firestore) => Promise<void> = appendAudit,
): Promise<BackfillPageResult> {
  let ended: Parameters<typeof backfillAuditContext>[0] | null = null;
  try {
    const result = await runBackfillPage(db, input, deps);
    ended = { kind: 'returned', result };
    return result;
  } catch (error) {
    ended = { kind: 'threw', error };
    throw error;
  } finally {
    await audit(
      {
        actor,
        action: 'ops.backfill',
        resourceId: `${BACKFILL_JOBS_COLLECTION}/${input.job}`,
        subjects: [],
        atIso: new Date(deps.clockMs()).toISOString(),
        context: {
          job: input.job,
          ...backfillAuditContext(
            ended ?? { kind: 'threw', error: new Error('unknown') },
          ),
        },
        ...(ended?.kind === 'returned' && actor !== null
          ? { changeKey: backfillChangeKey(input.job, ended.result, actor) }
          : {}),
      },
      db,
    );
  }
}

/**
 * The caller must be a sysadmin by BOTH the token and the user document
 * (F3): a demoted sysadmin keeps the claim until the token refreshes, and
 * this job rewrites every appointment in the book.
 */
async function assertSysadmin(
  db: Firestore,
  uid: string,
  tokenRoles: readonly string[],
): Promise<void> {
  const forbidden = () =>
    new HttpsError('permission-denied', 'Sysadmin only', {
      code: 'ops.backfill.forbidden',
    });
  if (!tokenRoles.includes('sysadmin')) throw forbidden();
  const roles = (await db.collection('users').doc(uid).get()).get('roles');
  if (!Array.isArray(roles) || !roles.includes('sysadmin')) throw forbidden();
}

/**
 * `runBackfill({job, cursor?})` — `ops.backfill` (R46), sysadmin only.
 * Loop it until `done`, passing back each call's `cursor`; each call writes
 * one audit row naming the job (a replayed call, one), and answers within
 * `RUN_BACKFILL_BUDGET_MS` plus the chunk in hand — inside the callable
 * SDK's default wait. It is also the repair for everything the live
 * projections drop: a client a permanent failure skipped, and a
 * policy-change pass that never started (`startPolicyRecompute`).
 *
 * App Check is not enforced yet: it lands with P1's first new callables,
 * after the emulator spike (§12.4 P1). Until then the role check re-read
 * from the user document is the gate.
 */
export const runBackfill = onCall(
  { timeoutSeconds: RUN_BACKFILL_TIMEOUT_SECONDS, memory: '512MiB' },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Sign in first', {
        code: 'ops.backfill.unauthenticated',
      });
    }
    const db = adminFirestore();
    await assertSysadmin(db, uid, callerRoles(request));

    const input = toBackfillRequest(request.data);
    if (input === null) {
      throw new HttpsError('invalid-argument', 'Unknown backfill job', {
        code: 'ops.backfill.invalid_input',
      });
    }

    return backfillWithAudit(db, input, callerActor(request));
  },
);
