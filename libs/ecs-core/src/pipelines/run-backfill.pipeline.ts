import {
  AppointmentId,
  AuditEntryId,
  AuditResourceId,
  BackfillJobId,
  CustomerId,
  LogEvent,
  Result,
  type TimeZone,
  type UserId,
} from '@core/primitives';
import {
  RepositoryError,
  type RunBackfillRefusal,
  RunBackfillRefusalCode,
} from '@core/errors';
import {
  type Actor,
  type AuditAction,
  AuditContext,
  type BackfillCall,
  BackfillCallEnd,
  BackfillJobName,
  BackfillOutcome,
  BackfillPhase,
  ClientStatsPolicy,
  Role,
  WriteOp,
} from '@core/components';
import {
  type Appointment,
  type AuditEntry,
  type BackfillJob,
  Collections,
} from '@core/entities';
import type {
  AuditAppendPorts,
  AuditQueryPorts,
  BackfillJobPorts,
  CallerRolesPorts,
  ClientPagePorts,
  DefaultLocationPorts,
  LocationLoadPorts,
  LogPorts,
  PolicyReadPorts,
  TxPorts,
} from '@core/ports';
import {
  AppointmentIndexSystem,
  AuditSystem,
  type BackfillCounts,
  type BackfillPageWalk,
  BackfillPlanSystem,
  type BackfillRequest,
  ClientStatsSystem,
  TriggerAttemptSystem,
  WorkBudgetSystem,
  ZonedTimeSystem,
} from '@core/systems';
import type { StepBudget } from './continue-policy-recompute.pipeline';
import {
  type ClientStatsRecomputePorts,
  clientStatsOf,
  readClientStats,
  recomputeClients,
} from './project-client-stats.pipeline';
import { readShopZone } from './shop-zone-read.pipeline';

/**
 * `runBackfill` — one page of one ops backfill job, callable in a loop
 * (`run-backfill.ts`, `backfill-plan.ts`, blueprint §4.1, §12.5.3), sysadmin
 * only: by the token (the edge's decoder) AND by the stored roles
 * (`loadCallerRoles` here — a demoted sysadmin keeps the claim until the
 * token refreshes, and this job rewrites every appointment in the book).
 *
 * - `SUBJECT_MIRROR` re-reads, in its own transaction, each appointment of
 *   the page that may lack a mirror, and stamps what it lacks: both subject
 *   mirrors (`subjectUserIds` beside `subjectCustomerIds`, D29) re-derived
 *   from the seats, and an inferred placement from the commit's audit row
 *   (`auditActionsFor`) — never the commit's own `placement`.
 * - `CLIENT_STATS` does the same, then recomputes every client record on the
 *   page (each once), then walks the STORED clients — a record no
 *   appointment names any more is reachable only from its own document —
 *   and closes with a sample of 20 stored clients recomputed from scratch
 *   WITHOUT writing (a read-only plan), each at its own `updatedAtUtcMs`.
 *
 * Idempotent and resumable: every write is state-based, and progress lives in
 * `backfillJobs/{job}`, so a runner that lost its cursor calls again without
 * one. Bounded by the edge's work budget, a chunk at a time — the chunk in
 * hand always finishes. Every call leaves ONE audit row however it ended
 * (`appendAudit`, never fatal): `COMPLETE`/`PARTIAL` with a change key that
 * makes a replayed call log once, `FAILED` with the failure's code.
 */

export type RunBackfillCommand = {
  /** The verified caller whose STORED roles must hold `sysadmin`. */
  readonly callerUserId: UserId;
  /** Who the audit row says ran it (`Actor.forCaller` over the token's roles). */
  readonly actor: Actor;
  /** The validated payload (`BackfillPlanSystem.requestOf`); `null` refuses. */
  readonly request: BackfillRequest | null;
};

export type RunBackfillPorts = ClientStatsRecomputePorts &
  LocationLoadPorts &
  DefaultLocationPorts &
  TxPorts &
  AuditAppendPorts &
  AuditQueryPorts &
  BackfillJobPorts &
  PolicyReadPorts &
  ClientPagePorts &
  CallerRolesPorts &
  LogPorts;

/**
 * Each job's progress document id — the job's legacy name, kept as the
 * stored key (`backfillJobs/clientStats`, OQ-9; `verify:p0` reads it).
 * Its home is beside `POLICY_RECOMPUTE_DOC` in the collection registry
 * (reported to the integrator).
 */
export const BACKFILL_JOB_DOC: {
  readonly [K in BackfillJobName]: BackfillJobId;
} = {
  [BackfillJobName.SubjectMirror]: BackfillJobId.of('subjectMirror'),
  [BackfillJobName.ClientStats]: BackfillJobId.of('clientStats'),
};

/** Stored clients the closing sample recomputes. */
export const BACKFILL_SAMPLE_SIZE = 20;
/** Clients recomputed at once. */
const RECOMPUTE_WIDTH = 5;
/** Appointments re-read and stamped at once. */
const STAMP_WIDTH = 10;

/** What one chunk of a page did. */
type ChunkCounts = { readonly stamped: number; readonly recomputed: number };

/** One page's work, before the progress document records it. */
type PageOutcome = {
  readonly walk: BackfillPageWalk;
  readonly counts: BackfillCounts;
};

/**
 * What a stats page recomputes against, loaded on first use, once per call:
 * the policy, and the shop's clock — the default location's (F-4: a stats
 * record names no shop).
 */
type StatsContext = {
  readonly policy: ClientStatsPolicy;
  readonly timeZone: TimeZone;
};

/** What the closing sample found. */
type SampleDiff = {
  readonly checked: number;
  readonly mismatched: readonly CustomerId[];
};

/** How a call ended, for its audit row — tagged by `BackfillCallEnd` (a component). */
type Ended =
  | {
      readonly backfillCallEnd: typeof BackfillCallEnd.Returned;
      readonly result: BackfillCall.Page;
    }
  | {
      readonly backfillCallEnd: typeof BackfillCallEnd.Failed;
      readonly failureCode: string;
    };

/** The audit context of how a call ended — ids, counts and codes only (T5). */
function backfillContext(
  backfillJobName: BackfillJobName,
  ended: Ended,
): AuditContext {
  if (ended.backfillCallEnd === BackfillCallEnd.Failed) {
    return AuditContext.backfill({
      backfillJobName,
      backfillOutcome: BackfillOutcome.Failed,
      backfillFailureCode: ended.failureCode,
      backfillProcessed: null,
      backfillStoredClients: null,
      backfillDone: null,
      backfillBudgetSpent: null,
      backfillCursor: null,
    });
  }
  const { result } = ended;
  return AuditContext.backfill({
    backfillJobName,
    backfillOutcome: BackfillPlanSystem.outcomeOf(result),
    backfillFailureCode: null,
    backfillProcessed: result.processed,
    backfillStoredClients: result.storedClients,
    backfillDone: result.done,
    backfillBudgetSpent: result.budgetSpent,
    backfillCursor: result.cursor,
  });
}

/** A failure's canonical code, for the `FAILED` row — a port's by its reason, a throw by its own. */
function failureCodeOf(failure: unknown): string {
  return TriggerAttemptSystem.attemptFailure(failure).failureCode;
}

/** How much one call takes at once — the runbook's sizes; a spec walks a small book with small ones. */
export type RunBackfillSizes = {
  /** Appointments (or stored clients) per page — one page read per call. */
  readonly pageSize: number;
  /** Rows handled between two looks at the budget. */
  readonly chunkSize: number;
  /** Stored clients the closing sample recomputes. */
  readonly sampleSize: number;
};

export const BACKFILL_SIZES: RunBackfillSizes = {
  pageSize: BackfillPlanSystem.PAGE_SIZE,
  chunkSize: BackfillPlanSystem.CHUNK_SIZE,
  sampleSize: BACKFILL_SAMPLE_SIZE,
};

export const runBackfill = (
  ports: RunBackfillPorts,
  sizes: RunBackfillSizes = BACKFILL_SIZES,
) => {
  /** `items` handed to `work` a chunk at a time, no new chunk once the budget is spent — but always the first. */
  async function walkWithin<T>(
    items: readonly T[],
    budget: StepBudget,
    work: (chunk: readonly T[]) => Promise<Result<ChunkCounts, unknown>>,
  ): Promise<
    Result<{ readonly handled: number; readonly counts: ChunkCounts }, unknown>
  > {
    const size = WorkBudgetSystem.chunkSize(sizes.chunkSize);
    let handled = 0;
    let stamped = 0;
    let recomputed = 0;
    for (;;) {
      const range = WorkBudgetSystem.nextChunk(items.length, size, handled);
      if (
        range === null ||
        !WorkBudgetSystem.takesChunk(handled, () => budget.spent())
      ) {
        break;
      }
      const chunk = items.slice(range.start, range.end);
      const done = await work(chunk);
      if (!done.ok) return done;
      stamped += done.value.stamped;
      recomputed += done.value.recomputed;
      handled += chunk.length;
    }
    return Result.ok({ handled, counts: { stamped, recomputed } });
  }

  /** `customerIds` recomputed, `RECOMPUTE_WIDTH` at a time; the first failure fails the chunk. */
  async function recomputeAll(
    context: StatsContext,
    customerIds: readonly CustomerId[],
  ): Promise<Result<number, unknown>> {
    if (customerIds.length === 0) return Result.ok(0);
    const report = await recomputeClients(
      ports,
      context.policy,
      customerIds,
      null,
      RECOMPUTE_WIDTH,
      context.timeZone,
    );
    const failure = report.failures[0];
    return failure === undefined
      ? Result.ok(report.written)
      : Result.err(failure);
  }

  /** Re-read one appointment in a transaction and stamp what its mirrors lack — never a stale patch over a fresher edit. */
  async function stampMirrors(
    id: AppointmentId,
    auditActions: readonly AuditAction[],
  ): Promise<Result<boolean, RepositoryError>> {
    const path = [Collections.Appointments, id];
    const committed = await ports.commit(
      (tx) => tx.get<Appointment>(path),
      (
        fresh,
      ): Result<
        { readonly stamped: boolean; readonly writes: readonly WriteOp[] },
        never
      > => {
        if (fresh === null) return Result.ok({ stamped: false, writes: [] });
        const patch = BackfillPlanSystem.mirrorPatch(
          BackfillPlanSystem.mirrorRowOf(fresh),
          BackfillPlanSystem.inferPlacement(auditActions),
        );
        if (patch === null) return Result.ok({ stamped: false, writes: [] });
        const fields: { [field: string]: unknown } = {};
        if (patch.subjectUserIds !== null) {
          fields['subjectUserIds'] = [...patch.subjectUserIds];
        }
        if (patch.subjectCustomerIds !== null) {
          fields['subjectCustomerIds'] = [...patch.subjectCustomerIds];
        }
        if (patch.inferredPlacement !== null) {
          fields['inferredPlacement'] = patch.inferredPlacement;
        }
        return Result.ok({
          stamped: true,
          writes: [WriteOp.update(path, fields)],
        });
      },
    );
    return committed.ok ? Result.ok(committed.value.stamped) : committed;
  }

  /**
   * Stamp what these rows lack: a row that may lack a mirror is re-read and
   * stamped; only one with no placement of either kind needs the audit trail.
   */
  async function stampRows(
    rows: readonly Appointment[],
  ): Promise<Result<number, unknown>> {
    const stale: Appointment[] = [];
    const lacking: AppointmentId[] = [];
    for (const row of rows) {
      if (
        !BackfillPlanSystem.mayLackMirrors(BackfillPlanSystem.mirrorRowOf(row))
      ) {
        continue;
      }
      stale.push(row);
      if (
        BackfillPlanSystem.lacksPlacement(row.placement, row.inferredPlacement)
      ) {
        lacking.push(row.id);
      }
    }
    if (stale.length === 0) return Result.ok(0);
    const actions = new Map<string, AuditAction[]>();
    if (lacking.length > 0) {
      const audited = await ports.auditActionsFor(lacking);
      if (!audited.ok) return audited;
      for (const entry of audited.value) {
        const list = actions.get(entry.resourceId) ?? [];
        list.push(entry.auditAction);
        actions.set(entry.resourceId, list);
      }
    }
    let stamped = 0;
    for (const batch of BackfillPlanSystem.chunk(stale, STAMP_WIDTH)) {
      const outcomes = await Promise.all(
        batch.map((row) => stampMirrors(row.id, actions.get(row.id) ?? [])),
      );
      for (const outcome of outcomes) {
        if (!outcome.ok) return outcome;
        if (outcome.value) stamped += 1;
      }
    }
    return Result.ok(stamped);
  }

  /** A page of appointments, a chunk at a time: stamp what lacks a mirror, then (stats job) recompute the chunk's records once each. */
  async function appointmentsPage(
    backfillJobName: BackfillJobName,
    after: string | null,
    budget: StepBudget,
    stats: () => Promise<Result<StatsContext, RepositoryError>>,
  ): Promise<Result<PageOutcome, unknown>> {
    const page = await ports.pageAppointments(
      after === null ? null : AppointmentId.of(after),
      sizes.pageSize,
    );
    if (!page.ok) return page;
    const seen = new Set<CustomerId>();
    const walked = await walkWithin(page.value, budget, async (chunk) => {
      const stamped = await stampRows(chunk);
      if (!stamped.ok) return stamped;
      if (backfillJobName !== BackfillJobName.ClientStats) {
        return Result.ok({ stamped: stamped.value, recomputed: 0 });
      }
      const subjects: CustomerId[] = [];
      for (const appointment of chunk) {
        for (const customerId of AppointmentIndexSystem.queryKeys(appointment)
          .subjectCustomerIds) {
          if (!seen.has(customerId) && !subjects.includes(customerId)) {
            subjects.push(customerId);
          }
        }
      }
      subjects.sort();
      for (const customerId of subjects) seen.add(customerId);
      if (subjects.length === 0) {
        return Result.ok({ stamped: stamped.value, recomputed: 0 });
      }
      const loaded = await stats();
      if (!loaded.ok) return loaded;
      const recomputed = await recomputeAll(loaded.value, subjects);
      return recomputed.ok
        ? Result.ok({ stamped: stamped.value, recomputed: recomputed.value })
        : recomputed;
    });
    if (!walked.ok) return walked;
    return Result.ok({
      walk: BackfillPlanSystem.pageWalk(
        BackfillPhase.Appointments,
        page.value.map((appointment) => appointment.id),
        walked.value.handled,
        after,
        sizes.pageSize,
      ),
      counts: {
        processed: walked.value.handled,
        storedClients: 0,
        stamped: walked.value.counts.stamped,
        recomputed: walked.value.counts.recomputed,
      },
    });
  }

  /**
   * A page of STORED clients, each recomputed from their own history — a
   * record no appointment names any more is rewritten to the empty answer
   * here, and nowhere else.
   */
  async function storedClientsPage(
    after: string | null,
    budget: StepBudget,
    stats: () => Promise<Result<StatsContext, RepositoryError>>,
  ): Promise<Result<PageOutcome, unknown>> {
    const page = await ports.pageClients(
      after === null ? null : CustomerId.of(after),
      sizes.pageSize,
    );
    if (!page.ok) return page;
    const walked = await walkWithin(page.value, budget, async (chunk) => {
      const loaded = await stats();
      if (!loaded.ok) return loaded;
      const recomputed = await recomputeAll(loaded.value, chunk);
      return recomputed.ok
        ? Result.ok({ stamped: 0, recomputed: recomputed.value })
        : recomputed;
    });
    if (!walked.ok) return walked;
    return Result.ok({
      walk: BackfillPlanSystem.pageWalk(
        BackfillPhase.StoredClients,
        page.value,
        walked.value.handled,
        after,
        sizes.pageSize,
      ),
      counts: {
        processed: 0,
        storedClients: walked.value.handled,
        stamped: 0,
        recomputed: walked.value.counts.recomputed,
      },
    });
  }

  /**
   * A sample of stored clients recomputed from scratch WITHOUT writing, each
   * at its own `updatedAtUtcMs` so time alone never counts as drift — a
   * read-only plan per client (its pair and its history in one snapshot). A
   * mismatch is a bug, reported, never silently repaired here.
   */
  async function sampleDiff(
    context: StatsContext,
    pivot: CustomerId,
  ): Promise<Result<SampleDiff, unknown>> {
    const first = await ports.pageClients(pivot, sizes.sampleSize);
    if (!first.ok) return first;
    const ids: CustomerId[] = [...first.value];
    if (ids.length < sizes.sampleSize) {
      const rest = await ports.pageClients(null, sizes.sampleSize - ids.length);
      if (!rest.ok) return rest;
      for (const id of rest.value) if (id < pivot) ids.push(id);
    }
    const mismatched: CustomerId[] = [];
    for (const customerId of ids) {
      const checked = await ports.commit(
        (tx) => readClientStats(tx, customerId),
        (
          snapshot,
        ): Result<
          { readonly mismatch: boolean; readonly writes: readonly WriteOp[] },
          never
        > => {
          if (snapshot.stats === null || snapshot.money === null) {
            return Result.ok({ mismatch: true, writes: [] });
          }
          const fresh = clientStatsOf(
            customerId,
            snapshot.history,
            context.policy,
            ZonedTimeSystem.shopNow(
              snapshot.stats.updatedAtUtcMs,
              context.timeZone,
            ),
          );
          return Result.ok({
            mismatch: !ClientStatsSystem.sameAnswer(
              { stats: snapshot.stats, money: snapshot.money },
              fresh,
            ),
            writes: [],
          });
        },
      );
      if (!checked.ok) return checked;
      if (checked.value.mismatch) mismatched.push(customerId);
    }
    return Result.ok({ checked: ids.length, mismatched });
  }

  /** The policy, then the default location's clock — what a stats page recomputes against. */
  async function loadStats(): Promise<Result<StatsContext, RepositoryError>> {
    const policy = await ports.loadPolicy();
    if (!policy.ok) return policy;
    const zone = await readShopZone(ports)(null);
    if (!zone.ok) return zone;
    return Result.ok({
      policy: ClientStatsPolicy.forBooking(policy.value),
      timeZone: zone.value,
    });
  }

  /** One page of one job, its progress written — the call's whole work. */
  async function page(
    request: BackfillRequest,
    budget: StepBudget,
  ): Promise<Result<BackfillCall.Page, unknown>> {
    const backfillJobName = request.backfillJobName;
    const jobId = BACKFILL_JOB_DOC[backfillJobName];
    const previous = await ports.loadBackfillJob(jobId);
    if (!previous.ok) return previous;
    const nowUtcMs = ports.nowUtcMs();
    const { cursor, carried } = BackfillPlanSystem.resume(
      request.start,
      previous.value,
      nowUtcMs,
    );

    // Loaded on first use, once per call — a mirror-only page never reads
    // them: the policy, then the default location's clock (a zone that
    // cannot be read is the call's store failure, 4A-2 (e)).
    let loadedStats: Result<StatsContext, RepositoryError> | null = null;
    const stats = async (): Promise<Result<StatsContext, RepositoryError>> => {
      loadedStats ??= await loadStats();
      return loadedStats;
    };

    const position = BackfillPlanSystem.positionOf(cursor);
    const outcome =
      position.backfillPhase === BackfillPhase.StoredClients &&
      backfillJobName === BackfillJobName.ClientStats
        ? await storedClientsPage(position.after, budget, stats)
        : await appointmentsPage(
            backfillJobName,
            position.backfillPhase === BackfillPhase.Appointments
              ? position.after
              : null,
            budget,
            stats,
          );
    if (!outcome.ok) return outcome;

    // How the run goes on: the appointments ran out → the stats job goes on
    // to the stored clients; the closing sample waits for the next call when
    // the budget is spent (it is new work too), never twice.
    const verdict = BackfillPlanSystem.nextPage(
      backfillJobName,
      outcome.value.walk,
      outcome.value.counts,
      () => budget.spent(),
    );
    let sample: SampleDiff | null = null;
    if (verdict.takeSample) {
      const loaded = await stats();
      if (!loaded.ok) return loaded;
      const taken = await sampleDiff(
        loaded.value,
        CustomerId.of(ports.nextId()),
      );
      if (!taken.ok) return taken;
      sample = taken.value;
    }

    const counts = outcome.value.counts;
    const total = carried.processed + counts.processed;
    const job: BackfillJob = {
      id: jobId,
      backfillJobName,
      cursor: verdict.cursor,
      processed: total,
      storedClients: carried.storedClients + counts.storedClients,
      stamped: carried.stamped + counts.stamped,
      recomputed: carried.recomputed + counts.recomputed,
      startedAtUtcMs: carried.startedAtUtcMs,
      finishedAtUtcMs: verdict.done ? nowUtcMs : null,
      updatedAtUtcMs: nowUtcMs,
      sampleChecked: sample === null ? null : sample.checked,
      sampleMismatched: sample === null ? [] : sample.mismatched,
    };
    const written = await ports.writeBackfillJob(job);
    if (!written.ok) return written;

    return Result.ok({
      backfillJobName,
      cursor: verdict.done ? null : verdict.cursor,
      done: verdict.done,
      processed: counts.processed,
      storedClients: counts.storedClients,
      stamped: counts.stamped,
      recomputed: counts.recomputed,
      total,
      runStartedAtUtcMs: carried.startedAtUtcMs,
      startedFrom: cursor,
      sampleChecked: job.sampleChecked,
      sampleMismatched: job.sampleMismatched,
      budgetSpent: outcome.value.walk.stoppedEarly || verdict.sampleDeferred,
    });
  }

  /** The call's ONE audit row, however it ended — never fatal. */
  async function auditCall(
    cmd: RunBackfillCommand,
    backfillJobName: BackfillJobName,
    ended: Ended,
  ): Promise<void> {
    const resourceId = AuditResourceId.parse(
      `${Collections.BackfillJobs}/${BACKFILL_JOB_DOC[backfillJobName]}`,
    );
    if (!resourceId.ok) return;
    const planned = AuditSystem.plan(
      [
        {
          resourceId: resourceId.value,
          subjects: [],
          // A RETURNED page keys its replay; a FAILED call — one row per
          // call, no result to key on — mints its key (RU-41).
          changeKey:
            ended.backfillCallEnd === BackfillCallEnd.Returned
              ? AuditSystem.backfillChangeKey(ended.result, cmd.actor)
              : AuditSystem.changeKey.backfillFailed(ports.nextId()),
          // An ops call carries no client operation id (WS-4.4).
          operationId: null,
          context: backfillContext(backfillJobName, ended),
        },
      ],
      cmd.actor,
      ports.nowUtcMs(),
    );
    if (!planned.ok) return;
    const rows: AuditEntry[] = [];
    for (const { row, idBasis } of planned.value) {
      rows.push({ id: AuditEntryId.of(ports.hash(idBasis)), ...row });
    }
    try {
      await ports.appendAudit(rows);
    } catch (error) {
      // Never fatal: a failed audit write never replaces the call's answer.
      ports.log('error', LogEvent.BackfillAuditNotWritten, {
        code: TriggerAttemptSystem.failureCode(error),
      });
    }
  }

  return async (
    cmd: RunBackfillCommand,
    budget: StepBudget,
  ): Promise<
    Result<BackfillCall.Page, RunBackfillRefusal | RepositoryError>
  > => {
    const roles = await ports.loadCallerRoles(cmd.callerUserId);
    if (!roles.ok) return roles;
    if (!roles.value.includes(Role.Sysadmin)) {
      return Result.err({ errorCode: RunBackfillRefusalCode.Forbidden });
    }
    const request = cmd.request;
    if (request === null) {
      return Result.err({ errorCode: RunBackfillRefusalCode.InvalidInput });
    }

    // The page commits as it goes, so a call that fails halfway has still
    // changed the book: the row is written whatever became of it.
    let ended: Ended | null = null;
    try {
      const paged = await page(request, budget);
      if (paged.ok) {
        ended = {
          backfillCallEnd: BackfillCallEnd.Returned,
          result: paged.value,
        };
        return paged;
      }
      ended = {
        backfillCallEnd: BackfillCallEnd.Failed,
        failureCode: failureCodeOf(paged.error),
      };
      if (RepositoryError.guard(paged.error)) return Result.err(paged.error);
      // Anything else is an infrastructure failure the walk caught: it goes
      // on to the edge, as it was thrown.
      throw paged.error;
    } catch (error) {
      ended ??= {
        backfillCallEnd: BackfillCallEnd.Failed,
        failureCode: failureCodeOf(error),
      };
      throw error;
    } finally {
      await auditCall(
        cmd,
        request.backfillJobName,
        ended ?? {
          backfillCallEnd: BackfillCallEnd.Failed,
          failureCode: TriggerAttemptSystem.UNKNOWN_CODE,
        },
      );
    }
  };
};
