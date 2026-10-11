import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { FieldPath, type Firestore } from 'firebase-admin/firestore';
import type { ClientStatsPolicy } from '@creativo/domain/scheduling';
import { WorkBudgetSystem } from '@core/systems';
import {
  BOOKING_POLICY_DOC,
  CLIENT_STATS_COLLECTION,
  type PersistedDocument,
  SETTINGS_COLLECTION,
  policyFromDocument,
} from '@creativo/application/booking';
import { adminFirestore } from '../firebase-admin';
import {
  type AttemptFailure,
  attemptFailure,
  decisiveFailure,
  failureCode,
  logAttempt,
  reportAttempt,
} from '../trigger-attempts';
import { BACKFILL_JOBS_COLLECTION } from '../ops/backfill-plan';
import { TENANT_ZONE } from '../booking/tenant-zone';
import { type WorkBudget, budgetMsFor, timeBudget } from '../ops/work-budget';
import { loadClientStatsPolicy, recomputeEach } from './recompute-client-stats';
import {
  type LivePolicyLine,
  POLICY_RECOMPUTE_JOB,
  POLICY_RECOMPUTE_PATH,
  type PolicyRecomputeJob,
  type PolicyStep,
  advancePolicyJob,
  planPolicyCatchUp,
  planPolicyJobNudge,
  planPolicyJobStart,
  policyJobFromDocument,
  policyJobToDocument,
  sameStep,
  stallPolicyJob,
  timestampIso,
} from './policy-recompute-plan';

const START_FN = 'recomputeClientStatsOnPolicyChange';
const STEP_FN = 'continueClientStatsPolicyRecompute';
const SWEEP_FN = 'sweepClientStatsPolicyDaily';

/** One step's platform timeout; the step stops taking pages at a share of it. */
export const POLICY_STEP_TIMEOUT_SECONDS = 540;

/** Stored clients per page, and how many recompute at once. */
const PAGE_SIZE = 100;
const WIDTH = 5;

/** The slice of a `settings/{docId}` write event the handler reads. */
export interface SettingsWriteEvent {
  readonly id: string;
  readonly time: string;
  readonly params: { readonly docId?: string };
  readonly data?: {
    readonly before?: { data(): PersistedDocument | undefined };
    readonly after?: { data(): PersistedDocument | undefined };
  };
}

/** The slice of a `backfillJobs/clientStatsPolicy` write event a step reads. */
export interface PolicyJobWriteEvent {
  readonly id: string;
  readonly time: string;
  readonly data?: {
    readonly after?: { data(): PersistedDocument | undefined };
  };
}

export interface PolicyChangeDeps {
  readonly clockMs: () => number;
  readonly loadPolicy: (db: Firestore) => Promise<ClientStatsPolicy>;
  /** The policy document's line and update time, for the sweep's catch-up. */
  readonly readPolicyLine: (db: Firestore) => Promise<LivePolicyLine>;
  readonly pageSize: number;
  /** One step's time allowance, started as the step starts. */
  readonly startBudget: () => WorkBudget;
}

/**
 * The booking policy as the sweep compares it with the job: its window, and
 * the document's own `updateTime` — the instant of the last write, at the
 * precision the settings trigger's event time carries. A plain read, like
 * every policy read.
 */
export async function readPolicyLine(db: Firestore): Promise<LivePolicyLine> {
  const snap = await db
    .collection(SETTINGS_COLLECTION)
    .doc(BOOKING_POLICY_DOC)
    .get();
  return {
    updatedAt: snap.updateTime ? timestampIso(snap.updateTime) : null,
    windowHours: policyFromDocument(snap.data()).cancellationWindowHours,
  };
}

const LIVE: PolicyChangeDeps = {
  clockMs: Date.now,
  loadPolicy: loadClientStatsPolicy,
  readPolicyLine,
  pageSize: PAGE_SIZE,
  startBudget: () =>
    timeBudget(Date.now, budgetMsFor(POLICY_STEP_TIMEOUT_SECONDS)),
};

/**
 * Did this settings write move the line between a free and a late cancel?
 *
 * A cancellation is judged by the window stamped on it when it was made
 * (2026-09-25), so a stamped one never moves whatever this pass does. The
 * LIVE window (§11.2 #11) still decides every cancellation recorded before
 * the stamp, and `clientStats` is a projection of it for those, so the pass
 * stays. Every other policy field — the horizon, the lead time, the party
 * size — is nothing a client's stats read.
 */
export function lateLineMoved(
  docId: string | undefined,
  before: PersistedDocument | undefined,
  after: PersistedDocument | undefined,
): boolean {
  if (docId !== BOOKING_POLICY_DOC) return false;
  return (
    policyFromDocument(before).cancellationWindowHours !==
    policyFromDocument(after).cancellationWindowHours
  );
}

const jobRef = (db: Firestore) =>
  db.collection(BACKFILL_JOBS_COLLECTION).doc(POLICY_RECOMPUTE_JOB);

const isoAt = (ms: number): string => new Date(ms).toISOString();

/** How a settings write left the recompute job. */
export type PolicyStartOutcome =
  /** The write moved no late line: nothing to re-judge. */
  | 'unmoved'
  /** A pass (re)started from the top. */
  | 'started'
  /** This change's pass, or a newer one's, already owns the job. */
  | 'unchanged'
  /** The job could not be written and retrying cannot help: logged, and left to the repair. */
  | 'dropped';

/**
 * A settings write that moved the late-cancel line starts a pass over every
 * stored client — or restarts the one running, when this change is newer
 * (`planPolicyJobStart`). It recomputes nobody itself: one transaction on
 * the job document, whose write sets the steps going
 * (`continuePolicyRecompute`).
 *
 * Without the pass only the clients whose appointments happened to be
 * written next were judged by the new window, and the book mixed two
 * definitions of "late" — two clients with the same history showing
 * different counts — until somebody ran the backfill by hand.
 *
 * Idempotent under redelivery (the same event finds its own generation) and
 * under reordering (an older change never restarts a newer pass). A
 * transient failure is rethrown for redelivery. A permanent one DROPS the
 * start — there is no job document to record it on, and a redelivery would
 * fail the same way — so it leaves the attempt line (`fn:
 * recomputeClientStatsOnPolicyChange`, `outcome: permanent`) and the
 * repair is the daily sweep (`sweepPolicyRecompute`), which finds the
 * policy document newer than the job and its window not the job's, and
 * starts the pass itself (`planPolicyCatchUp`); `runBackfill('clientStats')`
 * remains the manual one. Until then each client is re-judged on their next
 * appointment write (`dispatchClientProjections` reads the live policy).
 */
export async function startPolicyRecompute(
  event: SettingsWriteEvent,
  db: Firestore,
  deps: PolicyChangeDeps = LIVE,
): Promise<PolicyStartOutcome> {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  if (!lateLineMoved(event.params.docId, before, after)) return 'unmoved';

  const ref = jobRef(db);
  try {
    return await db.runTransaction(async (tx) => {
      const current = policyJobFromDocument((await tx.get(ref)).data());
      const next = planPolicyJobStart(
        current,
        {
          eventId: event.id,
          atIso: event.time,
          // The line this pass draws, for the sweep to compare the live
          // policy with (`planPolicyCatchUp`).
          windowHours: policyFromDocument(after).cancellationWindowHours,
        },
        isoAt(deps.clockMs()),
      );
      if (next === null) return 'unchanged';
      tx.set(ref, policyJobToDocument(next));
      return 'started';
    });
  } catch (error) {
    reportAttempt(START_FN, event, attemptFailure(error), deps.clockMs());
    return 'dropped';
  }
}

/** What one step's walk got through, and what went wrong on the way. */
interface Walk {
  /** `null` when not one page was finished. */
  readonly step: PolicyStep | null;
  readonly failure: AttemptFailure | null;
  /** The job moved on without this step: it stopped before its next page. */
  readonly superseded: boolean;
}

/**
 * Walk the stored clients after the fired step's cursor, a page at a time,
 * until the budget is spent — always the first page, so a step never
 * stands still. Each client is recomputed on its own against the policy as
 * it is NOW (read once per step, so a pass that outlives a second change
 * converges on it).
 *
 * Before EVERY page the job document is read again (one cheap get): a newer
 * change that restarted the pass, or another delivery's step that moved the
 * cursor, fails `sameStep`, and the walk stops there. A superseded step
 * therefore judges at most the page it has in hand under the policy it
 * loaded — never the rest of its budget's worth.
 *
 * And within that page a NEWER pass always has the last word (closed
 * 2026-09-25, round 3): every client is recomputed under this pass's stamp
 * (`PolicyPass`), and a recompute that finds a newer pass's stamp on the
 * client writes nothing — compared inside the client's own transaction, so
 * the store serialises the two writes. Before that, a new pass reaching
 * the same clients while the old page ran could have its answers
 * overwritten by the old line. The cost is one small stamp write per stored
 * client per pass (a newer pass stamps even an unchanged answer), paid only
 * when the owner moves the late line. What the stamp does not guard is the
 * appointment trigger's own read of the policy: it is not a pass, and
 * carries whatever stamp it finds.
 *
 * A page with a TRANSIENT failure is not finished: the walk stops before
 * it, and its clients are retried by the next step (the ones that did
 * succeed write nothing the second time). A page with only permanent
 * failures is finished — those clients would fail the same way on every
 * retry — and they are counted and left to `runBackfill('clientStats')`.
 *
 * Never throws: a read every client depends on (the job, the policy, a
 * page) that fails ends the walk, and the pages finished before it count.
 */
async function walkStoredClients(
  db: Firestore,
  fired: PolicyRecomputeJob,
  deps: PolicyChangeDeps,
  budget: WorkBudget,
): Promise<Walk> {
  const ref = jobRef(db);
  const errors: unknown[] = [];
  let cursor = fired.cursor;
  let pages = 0;
  let visited = 0;
  let recomputed = 0;
  let failed = 0;
  let exhausted = false;
  let superseded = false;
  try {
    let policy: ClientStatsPolicy | null = null;
    // Always the first page, then only while the budget lasts.
    while (WorkBudgetSystem.takesChunk(pages, () => budget.spent())) {
      const live = policyJobFromDocument((await ref.get()).data());
      if (live === null || !sameStep(live, fired)) {
        superseded = true;
        break;
      }
      policy ??= await deps.loadPolicy(db);
      let query = db
        .collection(CLIENT_STATS_COLLECTION)
        .orderBy(FieldPath.documentId())
        .limit(deps.pageSize);
      if (cursor !== null) query = query.startAfter(cursor);
      const page = await query.select().get();
      const ids = page.docs.map((doc) => doc.id);
      const report = await recomputeEach(
        db,
        ids,
        {
          policy,
          clockMs: deps.clockMs,
          pass: { generation: fired.generation, changedAt: fired.changedAt },
        },
        WIDTH,
      );
      errors.push(...report.failures);
      if (decisiveFailure(report.failures)?.outcome === 'transient') break;
      pages += 1;
      visited += ids.length;
      recomputed += report.written;
      failed += report.failures.length;
      cursor = ids.at(-1) ?? cursor;
      if (page.size < deps.pageSize) {
        exhausted = true;
        break;
      }
    }
  } catch (error) {
    errors.push(error);
  }
  return {
    step:
      pages === 0 ? null : { cursor, exhausted, visited, recomputed, failed },
    failure: decisiveFailure(errors),
    superseded,
  };
}

/**
 * Best effort: say on the job that the pass is STALLED and why — so an
 * operator (and the daily sweep) can tell a stalled pass from a slow one,
 * which `updatedAt` alone cannot. A compare-and-set on the fired step, so a
 * pass that moved on, or a newer change's, is never marked; a stall already
 * recorded with the same code is not rewritten. Its own failure is logged,
 * never thrown: the attempt's line already says what went wrong.
 */
async function recordStall(
  db: Firestore,
  fired: PolicyRecomputeJob,
  failure: AttemptFailure,
  deps: PolicyChangeDeps,
): Promise<void> {
  const ref = jobRef(db);
  try {
    await db.runTransaction(async (tx) => {
      const live = policyJobFromDocument((await tx.get(ref)).data());
      if (live === null || !sameStep(live, fired)) return;
      if (live.stalledAt !== null && live.lastFailureCode === failure.code) {
        return;
      }
      tx.set(
        ref,
        policyJobToDocument(
          stallPolicyJob(live, failure.code, isoAt(deps.clockMs())),
        ),
      );
    });
  } catch (error) {
    logger.warn('policy recompute stall not recorded', {
      code: failureCode(error),
    });
  }
}

/** How one delivery of the job's write left it. */
export type PolicyStepOutcome =
  /** No job, its pass is finished, or it is stalled and waits for the sweep: nothing to do. */
  | 'idle'
  /** The job moved on without this delivery — a newer change, or another delivery's step. */
  | 'superseded'
  /** A step taken; its write of the job document fires the next. */
  | 'advanced'
  /** The last step: every stored client is on the new line. */
  | 'finished'
  /** The step could not move the pass: rethrown when a retry can help, recorded on the job when not. */
  | 'stalled';

/**
 * One step of the pass: recompute the stored clients after the job's cursor
 * for as long as the budget lasts — stopping early the moment the job moves
 * on without it — then move the cursor: a compare-and-set on the step this
 * delivery was fired for (`sameStep`), so a duplicate delivery, a stale one,
 * or a pass a newer change superseded writes nothing. The advance is the
 * write that triggers the next step; the step that runs off the end stamps
 * `finishedAt` instead, and the chain rests.
 *
 * Bounded by its own budget, never by the platform's timeout, so a step
 * always gets to write where it stopped. Failures follow the dispatcher's
 * rule, with the same one attempt line (`reportAttempt`): a transient one
 * with no page finished is rethrown for the platform to redeliver
 * (state-based, so the redo writes only what is still wrong). A permanent
 * one with no page finished, or one that fails the advance, STALLS the
 * pass: logged, not rethrown, and recorded on the job (`stalledAt`,
 * `lastFailureCode`). That record's own write fires a delivery that rests
 * (`idle`); the daily sweep (`sweepPolicyRecompute`) nudges the pass on,
 * and `runBackfill('clientStats')` repairs the book by hand.
 */
export async function continuePolicyRecompute(
  event: PolicyJobWriteEvent,
  db: Firestore,
  deps: PolicyChangeDeps = LIVE,
): Promise<PolicyStepOutcome> {
  const fired = policyJobFromDocument(event.data?.after?.data());
  if (fired === null || fired.finishedAt !== null) return 'idle';
  // The write that recorded a stall: the pass rests until the sweep.
  if (fired.stalledAt !== null) return 'idle';

  const walk = await walkStoredClients(db, fired, deps, deps.startBudget());
  if (walk.step === null && !walk.superseded) {
    // Not one page finished, and the job is still this step's. (A walk
    // that finished no page either failed or was superseded, so the
    // fallback is never taken.)
    const failure = walk.failure ?? attemptFailure(new Error('no page'));
    if (failure.outcome === 'permanent') {
      await recordStall(db, fired, failure, deps);
    }
    reportAttempt(STEP_FN, event, failure, deps.clockMs());
    return 'stalled';
  }
  if (walk.failure !== null) {
    // Logged, never rethrown: the finished pages advance the job, and that
    // write already carries the walk on from the page that failed.
    logAttempt(STEP_FN, event, walk.failure, deps.clockMs());
  }
  const step = walk.step;
  // The job moved on mid-walk: the advance's compare-and-set would refuse.
  if (walk.superseded || step === null) return 'superseded';

  const ref = jobRef(db);
  try {
    const advanced = await db.runTransaction(async (tx) => {
      const current = policyJobFromDocument((await tx.get(ref)).data());
      if (current === null || !sameStep(current, fired)) return null;
      const next = advancePolicyJob(current, step, isoAt(deps.clockMs()));
      tx.set(ref, policyJobToDocument(next));
      return next;
    });
    if (advanced === null) return 'superseded';
    return advanced.finishedAt === null ? 'advanced' : 'finished';
  } catch (error) {
    const failure = attemptFailure(error);
    if (failure.outcome === 'permanent') {
      await recordStall(db, fired, failure, deps);
    }
    reportAttempt(STEP_FN, event, failure, deps.clockMs());
    return 'stalled';
  }
}

/** What the daily sweep did to the job. */
export type PolicySweepOutcome =
  /** No job, a finished one, or one that moved within the hour — and no dropped change: left alone. */
  | 'idle'
  /** A policy change whose start was dropped: its pass started from the top. */
  | 'started'
  /** An unfinished pass that had stopped moving: its step fired again. */
  | 'nudged'
  /** The policy or the job could not be read or written and retrying cannot help: logged; tomorrow's sweep tries again. */
  | 'failed';

/** The slice of a scheduled run the sweep reads. */
export interface SweepRun {
  readonly id: string;
  readonly time: string;
}

/**
 * The pass's only automatic restart, and the repair for a start that never
 * happened.
 *
 * FIRST, A DROPPED START (2026-09-25, round 3). A settings write whose
 * start failed for good (`startPolicyRecompute` → `dropped`) left the job
 * where it was, and nothing noticed. The sweep reads the policy document
 * (a plain get) and, when it changed after the change the job answers and
 * its window is not the job's, starts that pass itself
 * (`planPolicyCatchUp`) — the first-ever change included, when there is no
 * job and the live window is not the default. A horizon or lead-time edit
 * leaves the window where the job drew it, and starts nothing.
 *
 * OTHERWISE, A STALLED PASS. A pass whose step stalled on a permanent
 * failure, or ran out the platform's 24 h of transient retries, has
 * nothing left to fire its next step — and the clients past its cursor
 * keep counts and pause suggestions from the old policy, which is wrong
 * advice to staff for as long as nobody notices. An unfinished pass that
 * has not moved for an hour is nudged (`planPolicyJobNudge`): one
 * transaction whose write fires the step again from where it stopped.
 *
 * Idempotent: a started pass records the document's update time as its
 * change, so tomorrow's sweep finds them equal; the nudge keeps the step's
 * key, so it is one more delivery of that step under the same
 * compare-and-set, and a second sweep inside the hour finds `updatedAt`
 * fresh and writes nothing. A permanent stall is retried once a day this
 * way, which is also how the pass resumes on its own once whatever stalled
 * it (a policy document, a deploy) is fixed.
 */
export async function sweepPolicyRecompute(
  run: SweepRun,
  db: Firestore,
  deps: Pick<PolicyChangeDeps, 'clockMs' | 'readPolicyLine'> = LIVE,
): Promise<PolicySweepOutcome> {
  const ref = jobRef(db);
  try {
    // Outside the transaction, like every policy read: tuning data must not
    // widen the job's conflict set.
    const live = await deps.readPolicyLine(db);
    const swept = await db.runTransaction(async (tx) => {
      const job = policyJobFromDocument((await tx.get(ref)).data());
      const nowIso = isoAt(deps.clockMs());
      const owed = planPolicyCatchUp(job, live, nowIso);
      if (owed !== null) {
        tx.set(ref, policyJobToDocument(owed));
        return { kind: 'started' as const, job: owed };
      }
      const next = planPolicyJobNudge(job, nowIso);
      if (next === null || job === null) return null;
      tx.set(ref, policyJobToDocument(next));
      return { kind: 'nudged' as const, job };
    });
    if (swept === null) return 'idle';
    if (swept.kind === 'started') {
      logger.warn('policy recompute started by the sweep: a dropped start', {
        generation: swept.job.generation,
        changedAt: swept.job.changedAt,
        windowHours: swept.job.windowHours,
      });
      return 'started';
    }
    logger.info('policy recompute nudged', {
      generation: swept.job.generation,
      cursor: swept.job.cursor,
      lastFailureCode: swept.job.lastFailureCode,
    });
    return 'nudged';
  } catch (error) {
    reportAttempt(SWEEP_FN, run, attemptFailure(error), deps.clockMs());
    return 'failed';
  }
}

/**
 * `clientStats` follows the booking policy's free-cancellation window, not
 * only the appointments (§11.2 #11) — for the cancellations recorded before
 * the window was stamped on them; a stamped one keeps its verdict through
 * every pass (`ClientStatsPolicy.isLateCancellation`). This trigger only (re)starts the pass —
 * one transaction, so the default timeout is plenty. Never flagged: the
 * projection only states facts (R41).
 */
export const recomputeClientStatsOnPolicyChange = onDocumentWritten(
  { document: 'settings/{docId}', retry: true },
  async (event) => {
    await startPolicyRecompute(event, adminFirestore());
  },
);

/**
 * The pass itself, a budgeted step per write of its job document. `retry:
 * true` for the dispatcher's reason (L3); the step's own budget keeps it
 * inside `POLICY_STEP_TIMEOUT_SECONDS`, so a step is never killed before it
 * says where it stopped.
 */
export const continueClientStatsPolicyRecompute = onDocumentWritten(
  {
    document: POLICY_RECOMPUTE_PATH,
    retry: true,
    timeoutSeconds: POLICY_STEP_TIMEOUT_SECONDS,
    memory: '512MiB',
  },
  async (event) => {
    await continuePolicyRecompute(event, adminFirestore());
  },
);

/**
 * Starts a pass whose start was dropped, or nudges one that stopped moving
 * (`sweepPolicyRecompute`), once a day at night, after the capacity sweep. `retryCount` for the capacity sweep's
 * reason: a transient failure at 03:30 must not cost the day. Never fires
 * in the emulator (scheduled functions do not run there).
 */
export const sweepClientStatsPolicyDaily = onSchedule(
  {
    schedule: 'every day 03:30',
    timeZone: TENANT_ZONE,
    retryCount: 3,
  },
  async (event) => {
    await sweepPolicyRecompute(
      {
        id: `${event.jobName ?? SWEEP_FN}@${event.scheduleTime}`,
        time: event.scheduleTime,
      },
      adminFirestore(),
    );
  },
);
