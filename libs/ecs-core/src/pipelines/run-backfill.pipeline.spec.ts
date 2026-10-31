import { describe, expect, it } from 'vitest';
import {
  Actor,
  AuditAction,
  AuditContext,
  AuditTargetRef,
  BackfillJobName,
  BackfillOutcome,
  BackfillStart,
  BookingLifecycle,
  BookingPolicy,
  Placement,
  Role,
  SeatOccupant,
  SeatOutcome,
  SubjectRelationship,
  WriteAction,
  WriteOp,
} from '@core/components';
import {
  AppointmentId,
  AuditEntryId,
  AuditResourceId,
  type CustomerId,
  CustomerId as CustomerIds,
  OperationId,
  Result,
  SeatId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import { RepositoryError, RunBackfillRefusalCode } from '@core/errors';
import {
  type Appointment,
  type AuditEntry,
  type BackfillJob,
  Collections,
} from '@core/entities';
import type { CommitPlan } from '@core/ports';
import { AuditSystem, type BackfillRequest } from '@core/systems';
import {
  bodyOf,
  appointmentFixture,
  customerOf,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  fixtureHash,
  localDate,
  locationFixture,
  memoryDefaultLocationPorts,
  memoryStore,
  type MemoryStore,
  memoryTxPorts,
  recordingTelemetry,
  seatFixture,
  sequentialIds,
  auditResource,
} from '@core/testing';
import type { StepBudget } from './continue-policy-recompute.pipeline';
import { clientStatsPaths } from './project-client-stats.pipeline';
import {
  BACKFILL_JOB_DOC,
  runBackfill,
  type RunBackfillSizes,
} from './run-backfill.pipeline';

/*
 * The ops backfill (`run-backfill.ts`, `backfill-plan.ts`): one page of one
 * job per call — mirrors stamped on rows written before them (both subject
 * mirrors, D29, and an inferred placement from the commit's audit row
 * alone), the stats job's recomputes and its walk over the STORED clients,
 * the closing sample, the progress document, and ONE audit row per call
 * however it ended. Where a run goes on is `BackfillPlanSystem`'s spec; the
 * statistics are `ClientStatsSystem`'s. This one asserts what each call
 * read, wrote and answered.
 */

const ANA = UserId.of('u-ana');
const BOB = UserId.of('u-bob');
const SYSADMIN = UserId.of('u-sysadmin');
const ACTOR = Actor.forCaller(SYSADMIN, [Role.Sysadmin]);
const WORKED_AT = UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, -86_400_000);
const unbounded: StepBudget = { spent: () => false };

/** A worked visit of `who`; `legacy` leaves the mirrors and the placement out, as a row written before them. */
function visitOf(id: string, who: UserId, legacy = false): Appointment {
  const customer = customerOf(who);
  return appointmentFixture({
    id: AppointmentId.of(id),
    localDate: localDate('2026-09-21'),
    ownerUserId: who,
    ownerCustomerId: customer,
    subjectUserIds: legacy ? [] : [who],
    subjectCustomerIds: legacy ? [] : [customer],
    placement: legacy ? null : Placement.Self,
    seats: [
      seatFixture({
        seatId: SeatId.of(`${id}-s1`),
        occupant: SeatOccupant.account(who, customer, SubjectRelationship.Self),
        outcome: SeatOutcome.worked(WORKED_AT),
      }),
    ],
    lifecycle: BookingLifecycle.complete(WORKED_AT),
  });
}

/** The commit's own audit row for an appointment — what says who placed it. */
function commitRow(
  appointmentId: string,
  auditAction: AuditAction,
): AuditEntry {
  return {
    id: AuditEntryId.of(`row-${appointmentId}`),
    recordedAtUtcMs: WORKED_AT,
    resourceId: AuditResourceId.forAppointment(AppointmentId.of(appointmentId)),
    auditOperationId: null,
    ...Actor.user(ANA),
    ...AuditContext.placement(
      auditAction as typeof AuditAction.BookingCommitted,
      FIXTURE_IDS.location,
    ),
    ...AuditTargetRef.none(),
  };
}

type Options = {
  readonly roles?: readonly Role[];
  readonly auditTrail?: readonly AuditEntry[];
  readonly sizes?: RunBackfillSizes;
  readonly commit?: CommitPlan;
  readonly failJobRead?: boolean;
  /** The default location's read fails (`unavailable`). */
  readonly failZone?: boolean;
};

function rig(appointments: readonly Appointment[], options: Options = {}) {
  const store: MemoryStore = memoryStore(
    appointments.map((appointment) => ({
      path: [Collections.Appointments, appointment.id],
      body: bodyOf(appointment),
    })),
  );
  const tx = memoryTxPorts(store);
  const telemetry = recordingTelemetry();
  const audit: AuditEntry[] = [];
  const reads = { pages: 0, roles: 0, locations: 0 };
  const idsUnder = (collection: string) =>
    [...store.keys()]
      .filter((key) => key.split('/').length === 2)
      .filter((key) => key.startsWith(`${collection}/`))
      .map((key) => key.split('/')[1] ?? '')
      .sort();
  const ports = {
    ...tx,
    ...(options.commit === undefined ? {} : { commit: options.commit }),
    ...telemetry,
    nextId: sequentialIds('rnd'),
    // The shop's clock: the default location's (F-4), the fixture shop.
    ...memoryDefaultLocationPorts(),
    loadLocation: async (id: string) => {
      reads.locations += 1;
      return options.failZone === true
        ? Result.err(
            RepositoryError.readFailed(`locations/${id}`, 'unavailable'),
          )
        : Result.ok(id === FIXTURE_IDS.location ? locationFixture() : null);
    },
    loadPolicy: async () => Result.ok(BookingPolicy.DEFAULT),
    loadCallerRoles: async () => {
      reads.roles += 1;
      return Result.ok(options.roles ?? [Role.Sysadmin]);
    },
    loadBackfillJob: async (id: string) => {
      if (options.failJobRead === true) {
        return Result.err(
          RepositoryError.readFailed(`backfillJobs/${id}`, 'unavailable'),
        );
      }
      const body = store.get(`${Collections.BackfillJobs}/${id}`);
      return Result.ok(
        body === undefined ? null : ({ id, ...body } as BackfillJob),
      );
    },
    writeBackfillJob: async (job: BackfillJob) => {
      store.set(`${Collections.BackfillJobs}/${job.id}`, bodyOf(job));
      return Result.ok(undefined);
    },
    pageAppointments: async (after: AppointmentId | null, limit: number) => {
      reads.pages += 1;
      return Result.ok(
        idsUnder(Collections.Appointments)
          .filter((id) => after === null || id > after)
          .slice(0, limit)
          .map(
            (id) =>
              ({
                id,
                ...store.get(`${Collections.Appointments}/${id}`),
              }) as Appointment,
          ),
      );
    },
    pageClients: async (after: CustomerId | null, limit: number) =>
      Result.ok(
        idsUnder(Collections.ClientStats)
          .filter((id) => after === null || id > after)
          .slice(0, limit)
          .map((id) => CustomerIds.of(id)),
      ),
    auditActionsFor: async (ids: readonly AppointmentId[]) =>
      Result.ok(
        (options.auditTrail ?? []).filter((row) =>
          ids.includes(row.resourceId as unknown as AppointmentId),
        ),
      ),
    appendAudit: async (rows: readonly AuditEntry[]) => {
      audit.push(...rows);
    },
  };
  const run = runBackfill(
    ports,
    options.sizes ?? { pageSize: 200, chunkSize: 25, sampleSize: 20 },
  );
  return { store, tx, telemetry, audit, reads, run };
}

const command = (request: BackfillRequest | null) => ({
  callerUserId: SYSADMIN,
  actor: ACTOR,
  request,
});
const resume = (backfillJobName: BackfillJobName): BackfillRequest => ({
  backfillJobName,
  start: { backfillStart: BackfillStart.Resume },
});
const after = (
  backfillJobName: BackfillJobName,
  cursor: string,
): BackfillRequest => ({
  backfillJobName,
  start: { backfillStart: BackfillStart.After, cursor },
});

const jobBody = (store: MemoryStore, name: BackfillJobName) =>
  store.get(`${Collections.BackfillJobs}/${BACKFILL_JOB_DOC[name]}`);

describe('runBackfill — the caller and the payload', () => {
  it('refuses a caller whose STORED roles hold no sysadmin — nothing read, no row', async () => {
    const { reads, audit, run } = rig([visitOf('a1', ANA)], {
      roles: [Role.Admin],
    });
    expect(
      await run(command(resume(BackfillJobName.SubjectMirror)), unbounded),
    ).toEqual({
      ok: false,
      error: { errorCode: RunBackfillRefusalCode.Forbidden },
    });
    expect(reads.pages).toBe(0);
    expect(audit).toEqual([]);
  });

  it('refuses a payload that names no job — after the stored roles, as today', async () => {
    const { reads, audit, run } = rig([]);
    expect(await run(command(null), unbounded)).toEqual({
      ok: false,
      error: { errorCode: RunBackfillRefusalCode.InvalidInput },
    });
    expect(reads.roles).toBe(1);
    expect(audit).toEqual([]);
  });
});

describe('runBackfill — the subject mirror job', () => {
  it('stamps both mirrors on a row written before them, the placement as an inference from the commit row alone, and ends with the appointments', async () => {
    const legacy = visitOf('a1', ANA, true);
    const { tx, store, run } = rig([legacy, visitOf('a2', BOB)], {
      auditTrail: [commitRow('a1', AuditAction.BookingCommitted)],
    });
    const answer = await run(
      command(resume(BackfillJobName.SubjectMirror)),
      unbounded,
    );
    expect(answer).toEqual({
      ok: true,
      value: {
        backfillJobName: BackfillJobName.SubjectMirror,
        cursor: null,
        done: true,
        processed: 2,
        storedClients: 0,
        stamped: 1,
        recomputed: 0,
        total: 2,
        runStartedAtUtcMs: FIXTURE_NOW_UTC_MS,
        startedFrom: null,
        sampleChecked: null,
        sampleMismatched: [],
        budgetSpent: false,
      },
    });
    expect(tx.plans).toEqual([
      [
        WriteOp.update([Collections.Appointments, 'a1'], {
          subjectUserIds: [ANA],
          subjectCustomerIds: [customerOf(ANA)],
          inferredPlacement: Placement.Self,
        }),
      ],
    ]);
    // The commit's own `placement` is never written.
    expect(
      store.get(`${Collections.Appointments}/a1`)?.['placement'],
    ).toBeNull();
    expect(jobBody(store, BackfillJobName.SubjectMirror)).toMatchObject({
      backfillJobName: BackfillJobName.SubjectMirror,
      cursor: 'a2',
      processed: 2,
      stamped: 1,
      finishedAtUtcMs: FIXTURE_NOW_UTC_MS,
      sampleChecked: null,
    });
  });

  it('records no inference for a row the audit trail says nothing about', async () => {
    const { tx, run } = rig([visitOf('a1', ANA, true)]);
    await run(command(resume(BackfillJobName.SubjectMirror)), unbounded);
    expect(tx.plans).toEqual([
      [
        WriteOp.update([Collections.Appointments, 'a1'], {
          subjectUserIds: [ANA],
          subjectCustomerIds: [customerOf(ANA)],
        }),
      ],
    ]);
  });

  it('reads a staff commit row as a staff placement — an inference, nothing more', async () => {
    const { tx, run } = rig([visitOf('a1', ANA, true)], {
      auditTrail: [commitRow('a1', AuditAction.BookingStaffCreated)],
    });
    await run(command(resume(BackfillJobName.SubjectMirror)), unbounded);
    expect(tx.plans[0]?.[0]).toMatchObject({
      fields: { inferredPlacement: Placement.Staff },
    });
  });

  it('writes nothing on a complete book — a second run is a no-op', async () => {
    const { tx, run } = rig([visitOf('a1', ANA), visitOf('a2', BOB)]);
    await run(command(resume(BackfillJobName.SubjectMirror)), unbounded);
    expect(tx.transactions).toEqual([]);
  });

  it('leaves the write provenance as it was — a mirror stamp neither sets nor clears it (RU-29)', async () => {
    const booked = OperationId.of('op-book-a1');
    const { tx, store, run } = rig([
      { ...visitOf('a1', ANA, true), writeOperationId: booked },
      visitOf('a2', BOB, true),
    ]);
    await run(command(resume(BackfillJobName.SubjectMirror)), unbounded);
    expect(tx.plans).toHaveLength(2);
    for (const plan of tx.plans) {
      expect(plan).toHaveLength(1);
      expect(plan[0]).toMatchObject({ fields: {} });
      expect(
        Object.hasOwn(
          (plan[0] as { readonly fields: object }).fields,
          'writeOperationId',
        ),
      ).toBe(false);
    }
    expect(
      store.get(`${Collections.Appointments}/a1`)?.['writeOperationId'],
    ).toBe(booked);
    expect(
      store.get(`${Collections.Appointments}/a2`)?.['writeOperationId'],
    ).toBeNull();
  });
});

describe('runBackfill — the stats job', () => {
  it('walks the appointments, then the stored clients, before it is done — and closes with the sample', async () => {
    const { store, run } = rig([visitOf('a1', ANA), visitOf('a2', BOB)]);
    const first = await run(
      command(resume(BackfillJobName.ClientStats)),
      unbounded,
    );
    expect(first.ok && first.value).toMatchObject({
      done: false,
      cursor: '~',
      processed: 2,
      recomputed: 2,
      sampleChecked: null,
    });
    const second = await run(
      command(resume(BackfillJobName.ClientStats)),
      unbounded,
    );
    expect(second.ok && second.value).toMatchObject({
      done: true,
      cursor: null,
      processed: 0,
      storedClients: 2,
      recomputed: 0,
      total: 2,
      sampleChecked: 2,
      sampleMismatched: [],
    });
    expect(jobBody(store, BackfillJobName.ClientStats)).toMatchObject({
      finishedAtUtcMs: FIXTURE_NOW_UTC_MS,
      sampleChecked: 2,
    });
  });

  it('repairs a client no appointment names any more — rewritten to the empty answer', async () => {
    const { store, run } = rig([visitOf('a1', ANA)]);
    await run(command(resume(BackfillJobName.ClientStats)), unbounded);
    store.delete(`${Collections.Appointments}/a1`);
    const repaired = await run(
      command(after(BackfillJobName.ClientStats, '~')),
      unbounded,
    );
    expect(repaired.ok && repaired.value).toMatchObject({
      storedClients: 1,
      recomputed: 1,
    });
    expect(
      store.get(clientStatsPaths(customerOf(ANA)).stats.join('/'))?.[
        'lifetimeVisitsCompleted'
      ],
    ).toBe(0);
  });

  it('reports a stored answer that disagrees with a fresh one in the sample — never repairs it there', async () => {
    const { store, run } = rig([visitOf('a1', ANA)]);
    await run(command(resume(BackfillJobName.ClientStats)), unbounded);
    const path = clientStatsPaths(customerOf(ANA)).stats.join('/');
    store.set(path, { ...store.get(path), lifetimeVisitsCompleted: 9 });
    const closing = await run(
      command(after(BackfillJobName.ClientStats, `~${customerOf(ANA)}`)),
      unbounded,
    );
    expect(closing.ok && closing.value).toMatchObject({
      done: true,
      sampleChecked: 1,
      sampleMismatched: [customerOf(ANA)],
    });
    expect(store.get(path)?.['lifetimeVisitsCompleted']).toBe(9);
  });
});

describe('runBackfill — bounded by its own budget, never by the timeout', () => {
  const small: RunBackfillSizes = {
    pageSize: 10,
    chunkSize: 1,
    sampleSize: 20,
  };

  it('stops taking chunks once the budget is spent: partial, with a cursor, audited', async () => {
    const { audit, run } = rig(
      [visitOf('a1', ANA, true), visitOf('a2', BOB, true)],
      { sizes: small },
    );
    const answer = await run(command(resume(BackfillJobName.SubjectMirror)), {
      spent: () => true,
    });
    expect(answer.ok && answer.value).toMatchObject({
      done: false,
      cursor: 'a1',
      processed: 1,
      budgetSpent: true,
    });
    expect(audit[0]).toMatchObject({
      backfillOutcome: BackfillOutcome.Partial,
      backfillCursor: 'a1',
      backfillBudgetSpent: true,
    });
  });

  it('says partial, and where to go on, when the page runs out first', async () => {
    const { audit, run } = rig(
      [visitOf('a1', ANA, true), visitOf('a2', BOB, true)],
      { sizes: { pageSize: 1, chunkSize: 25, sampleSize: 20 } },
    );
    const answer = await run(
      command(resume(BackfillJobName.SubjectMirror)),
      unbounded,
    );
    expect(answer.ok && answer.value).toMatchObject({
      done: false,
      cursor: 'a1',
      budgetSpent: false,
    });
    expect(audit[0]).toMatchObject({
      backfillOutcome: BackfillOutcome.Partial,
      backfillDone: false,
      backfillBudgetSpent: false,
      backfillCursor: 'a1',
    });
  });

  it('always takes the first chunk, so a spent budget still moves the walk', async () => {
    const books = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'].map((id, index) =>
      visitOf(id, index % 2 === 0 ? ANA : BOB, true),
    );
    const { run } = rig(books, {
      sizes: { pageSize: 10, chunkSize: 3, sampleSize: 20 },
    });
    const cursors: (string | null)[] = [];
    for (let call = 0; call < 5; call++) {
      const page = await run(command(resume(BackfillJobName.SubjectMirror)), {
        spent: () => true,
      });
      cursors.push(page.ok ? page.value.cursor : 'refused');
      if (page.ok && page.value.done) break;
    }
    expect(cursors).toEqual(['a3', 'a6', null]);
  });

  it('resumes from its progress document without a cursor, and lands where an unhurried run does', async () => {
    const hurried = rig([visitOf('a1', ANA, true), visitOf('a2', BOB, true)], {
      sizes: small,
    });
    const spent = { spent: () => true };
    const outcomes: boolean[] = [];
    for (let call = 0; call < 5; call++) {
      const page = await hurried.run(
        command(resume(BackfillJobName.SubjectMirror)),
        spent,
      );
      outcomes.push(page.ok && page.value.done);
      if (page.ok && page.value.done) break;
    }
    expect(outcomes).toEqual([false, true]);
    const calm = rig([visitOf('a1', ANA, true), visitOf('a2', BOB, true)]);
    await calm.run(command(resume(BackfillJobName.SubjectMirror)), unbounded);
    for (const id of ['a1', 'a2']) {
      expect(hurried.store.get(`${Collections.Appointments}/${id}`)).toEqual(
        calm.store.get(`${Collections.Appointments}/${id}`),
      );
    }
    expect(jobBody(hurried.store, BackfillJobName.SubjectMirror)).toMatchObject(
      {
        processed: 2,
        stamped: 2,
      },
    );
  });

  it('defers the closing sample past a spent budget, then takes it on the next call', async () => {
    const { run } = rig([visitOf('a1', ANA)], { sizes: small });
    await run(command(resume(BackfillJobName.ClientStats)), unbounded);
    const deferred = await run(command(resume(BackfillJobName.ClientStats)), {
      spent: () => true,
    });
    expect(deferred.ok && deferred.value).toMatchObject({
      done: false,
      sampleChecked: null,
      budgetSpent: true,
    });
    const taken = await run(command(resume(BackfillJobName.ClientStats)), {
      spent: () => true,
    });
    expect(taken.ok && taken.value).toMatchObject({
      done: true,
      sampleChecked: 1,
    });
  });
});

describe('runBackfill — one audit row per call', () => {
  it('names the job and how the page went, untargeted, by the caller', async () => {
    const { audit, run } = rig([visitOf('a1', ANA)]);
    await run(command(resume(BackfillJobName.SubjectMirror)), unbounded);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      recordedAtUtcMs: FIXTURE_NOW_UTC_MS,
      resourceId: 'backfillJobs/subjectMirror',
      // An ops call carries no client operation id (WS-4.4).
      auditOperationId: null,
      ...ACTOR,
      ...AuditContext.backfill({
        backfillJobName: BackfillJobName.SubjectMirror,
        backfillOutcome: BackfillOutcome.Complete,
        backfillFailureCode: null,
        backfillProcessed: 1,
        backfillStoredClients: 0,
        backfillDone: true,
        backfillBudgetSpent: false,
        backfillCursor: null,
      }),
      ...AuditTargetRef.none(),
    });
  });

  it('keys a returned page as one change: a replayed call logs once, another stretch on its own', async () => {
    const books = [visitOf('a1', ANA, true), visitOf('a2', BOB, true)];
    const small: RunBackfillSizes = {
      pageSize: 1,
      chunkSize: 1,
      sampleSize: 1,
    };
    const first = rig(books, { sizes: small });
    await first.run(
      command(after(BackfillJobName.SubjectMirror, 'a1')),
      unbounded,
    );
    await first.run(
      command(after(BackfillJobName.SubjectMirror, 'a1')),
      unbounded,
    );
    expect(first.audit[0]?.id).toBe(first.audit[1]?.id);
    const other = rig(books, { sizes: small });
    await other.run(command(resume(BackfillJobName.SubjectMirror)), unbounded);
    expect(other.audit[0]?.id).not.toBe(first.audit[0]?.id);
  });

  it('writes the row for a page that failed after writing, then lets the failure go on', async () => {
    const outage = Object.assign(new Error('13 INTERNAL'), { code: 13 });
    const books = [visitOf('a1', ANA, true), visitOf('a2', BOB, true)];
    const store = memoryStore();
    const tx = memoryTxPorts(store);
    let commits = 0;
    const { audit, run } = rig(books, {
      sizes: { pageSize: 10, chunkSize: 1, sampleSize: 1 },
      commit: async (read, decide) => {
        commits += 1;
        if (commits === 2) throw outage;
        return tx.commit(read, decide);
      },
    });
    await expect(
      run(command(resume(BackfillJobName.SubjectMirror)), unbounded),
    ).rejects.toBe(outage);
    expect(audit).toHaveLength(1);
    // A FAILED call keys its row by a minted id (RU-41) — hashed like every
    // other row, never the raw mint (`nextId` no longer names a row).
    expect(audit[0]).toMatchObject({
      id: fixtureHash(
        AuditSystem.rowBasis(
          AuditAction.OpsBackfill,
          auditResource('backfillJobs/subjectMirror'),
          null,
          AuditSystem.changeKey.backfillFailed('rnd-1'),
        ),
      ),
      auditOperationId: null,
      backfillOutcome: BackfillOutcome.Failed,
      backfillFailureCode: 'internal',
      backfillProcessed: null,
    });
  });

  it('writes a FAILED row for a port that refused, and answers the refusal', async () => {
    const { audit, run } = rig([visitOf('a1', ANA)], { failJobRead: true });
    const answer = await run(
      command(resume(BackfillJobName.SubjectMirror)),
      unbounded,
    );
    expect(answer.ok).toBe(false);
    expect(audit[0]).toMatchObject({
      backfillOutcome: BackfillOutcome.Failed,
      backfillFailureCode: 'unavailable',
    });
  });

  it('keys every FAILED call apart — no result to key on, each call its own act (RU-41)', async () => {
    const { audit, run } = rig([visitOf('a1', ANA)], { failJobRead: true });
    await run(command(resume(BackfillJobName.SubjectMirror)), unbounded);
    await run(command(resume(BackfillJobName.SubjectMirror)), unbounded);
    expect(audit).toHaveLength(2);
    expect(audit[0]?.id).not.toBe(audit[1]?.id);
  });

  it('reads no zone for a mirror-only page — the clock is a stats page’s, loaded on first use', async () => {
    const { reads, run } = rig([visitOf('a1', ANA)]);
    await run(command(resume(BackfillJobName.SubjectMirror)), unbounded);
    expect(reads.locations).toBe(0);
  });

  it('writes a FAILED row when a stats page cannot read the zone, and answers the store failure (4A-2 (e))', async () => {
    const { audit, run } = rig([visitOf('a1', ANA)], { failZone: true });
    const answer = await run(
      command(resume(BackfillJobName.ClientStats)),
      unbounded,
    );
    expect(answer).toEqual(
      Result.err(
        RepositoryError.readFailed(
          `locations/${FIXTURE_IDS.location}`,
          'unavailable',
        ),
      ),
    );
    expect(audit[0]).toMatchObject({
      backfillOutcome: BackfillOutcome.Failed,
      backfillFailureCode: 'unavailable',
    });
  });

  it('stamps nothing under the commit’s own placement: a stamped row is left alone', async () => {
    const stamped = {
      ...visitOf('a1', ANA),
      subjectUserIds: [],
      subjectCustomerIds: [],
    };
    const { tx, run } = rig([stamped], {
      auditTrail: [commitRow('a1', AuditAction.BookingStaffCreated)],
    });
    await run(command(resume(BackfillJobName.SubjectMirror)), unbounded);
    expect(tx.plans).toEqual([
      [
        WriteOp.update([Collections.Appointments, 'a1'], {
          subjectUserIds: [ANA],
          subjectCustomerIds: [customerOf(ANA)],
        }),
      ],
    ]);
    expect(tx.plans[0]?.[0]?.writeAction).toBe(WriteAction.Update);
  });
});
