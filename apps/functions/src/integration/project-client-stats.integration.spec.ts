import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import admin from 'firebase-admin';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import {
  Actor,
  AuditAction,
  AuditContext,
  AuditTargetRef,
  BackfillJobName,
  BarberPreference,
  BookingLifecycle,
  BookingPolicy,
  CancellationReason,
  CancelledBy,
  Placement,
  PreciseInstant,
  Role,
  type Seat,
  SeatLabel,
  SeatOccupant,
  SeatOutcome,
  SubjectRelationship,
  SystemSource,
} from '@core/components';
import {
  AppointmentId,
  BarberId,
  RepositoryError,
  Result,
  SeatId,
  ServiceId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import {
  type Appointment,
  type BackfillJob,
  CLIENT_MONEY_DOC,
  Collections,
  POLICY_RECOMPUTE_DOC,
  type PolicyRecomputeJob,
  Subcollections,
} from '@core/entities';
import {
  AppointmentIndexSystem,
  BackfillStart,
  type BackfillRequest,
  ZonedTimeSystem,
} from '@core/systems';
import type { LoadPolicy } from '@core/ports';
import {
  continuePolicyRecompute,
  PolicyStepOutcome,
  PolicySweepOutcome,
  projectClientStats,
  runBackfill,
  startPolicyRecompute,
  sweepPolicyRecompute,
} from '@core/pipelines';
import {
  appointmentFixture,
  customerOf,
  FIXTURE_IDS,
  FIXTURE_TIME_ZONE,
  recordingTelemetry,
  seatFixture,
  sequentialIds,
  termsFixture,
  utcMs,
} from '@core/testing';
import { sha256Hex } from '../adapters/crypto.adapter';
import { firestoreAuditPorts } from '../adapters/firestore-audit.adapter';
import { firestoreClientStatsPorts } from '../adapters/firestore-client-stats.adapter';
import { firestoreJobPorts } from '../adapters/firestore-jobs.adapter';
import { firestoreCommitPlan } from '../adapters/firestore-tx.adapter';
import {
  decodeDispatchProjectionsEvent,
  preciseInstantOf,
} from '../wire/triggers.wire';

/**
 * The client-stats projection against the REAL Firestore emulator (the
 * successor of `client-projections.integration.spec.ts`): the trigger and
 * the backfill agree on every fixture, a second backfill changes no byte but
 * `updatedAtUtcMs`, the spend lands in its own admin-only document, the
 * mirrors stamp, a run resumes and a budget-bound run lands where an
 * unhurried one does, and the policy pass — started, stepped, stalled,
 * swept — re-judges every stored client. Transactions over an
 * `array-contains` query and a re-read-then-stamp of legacy rows are exactly
 * what a fake would flatter. Everything runs over the production adapters,
 * as the composition root wires them.
 *
 * Emulator-only by construction: refuses to run without a local
 * `FIRESTORE_EMULATOR_HOST`, on a demo project of its own.
 */
const PROJECT_ID = 'demo-functions-client-stats';

const EMULATOR = (process.env['FIRESTORE_EMULATOR_HOST'] ??= '127.0.0.1:8080');
if (!EMULATOR.includes('127.0.0.1')) {
  throw new Error('Refusing to run outside the local emulators.');
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = utcMs('2026-09-25T08:00:00.000Z');
const SYSADMIN = UserId.of('u-sys');

const ANA = UserId.of('ana');
const BOB = UserId.of('bob');
const MIRA = UserId.of('mira');
const ZORA = UserId.of('zora');
const SUBJECTS = [ANA, BOB, MIRA, ZORA];

type Outcome =
  | 'WORKED'
  | 'NO_SHOW'
  | 'SCHEDULED'
  | {
      readonly by: CancelledBy;
      readonly reason: CancellationReason;
      readonly leadHours: number;
      /** The window stamped when it was called off; absent is a row stored before the stamp. */
      readonly windowHours?: number;
    };

type SeatSpec = {
  readonly who: UserId | null;
  readonly outcome: Outcome;
  readonly barber?: string;
  readonly service?: string;
  readonly pref?: 'ANY';
};

function outcomeAt(outcome: Outcome, start: UtcEpochMs): SeatOutcome {
  if (outcome === 'WORKED')
    return SeatOutcome.worked(UtcEpochMs.plusMs(start, HOUR / 2));
  if (outcome === 'NO_SHOW')
    return SeatOutcome.noShow(UtcEpochMs.plusMs(start, HOUR / 4));
  if (outcome === 'SCHEDULED') return SeatOutcome.scheduled();
  return SeatOutcome.cancelled(
    UtcEpochMs.plusMs(start, -outcome.leadHours * HOUR),
    outcome.by,
    outcome.reason,
    outcome.windowHours ?? null,
  );
}

/** A stored appointment, as the commit writes one: mirrors from its seats, placed by its first person. */
function visit(
  id: string,
  start: UtcEpochMs,
  seats: readonly SeatSpec[],
): Appointment {
  const wall = ZonedTimeSystem.toLocal(start, FIXTURE_TIME_ZONE);
  const terms = termsFixture(2500, 30);
  const built: Seat[] = seats.map((spec, index) => {
    const barberId = BarberId.of(spec.barber ?? `barber-${index}`);
    const occupant =
      spec.who === null
        ? SeatOccupant.anonymous(SeatLabel.of('Гост'))
        : SeatOccupant.account(
            spec.who,
            customerOf(spec.who),
            spec.who === seats[0]?.who
              ? SubjectRelationship.Self
              : SubjectRelationship.Companion,
          );
    return seatFixture({
      seatId: SeatId.of(`${id}-s${index}`),
      serviceId: ServiceId.of(spec.service ?? 'cut'),
      barberId,
      barberPreference:
        spec.pref === 'ANY' ? BarberPreference.Any : BarberPreference.Specific,
      startMinutes: wall.minute + index * 45,
      terms: {
        ...terms,
        catalogPriceCents: null,
        catalogDurationMinutes: null,
      },
      occupant,
      outcome: outcomeAt(spec.outcome, start),
    } as Parameters<typeof seatFixture>[0]);
  });
  const confirmedAtUtcMs = UtcEpochMs.plusMs(start, -10 * DAY);
  const draft = appointmentFixture({
    id: AppointmentId.of(id),
    localDate: wall.localDate,
    startMinutes: wall.minute,
    utcEpochMs: start,
    seats: built,
    placement: seats[0]?.who === null ? Placement.Staff : Placement.Self,
    bookedAtUtcMs: confirmedAtUtcMs,
    lifecycle: SeatOutcome.summarize(
      built,
      BookingLifecycle.confirm(confirmedAtUtcMs),
      start,
    ),
  });
  return { ...draft, ...AppointmentIndexSystem.queryKeys(draft) };
}

/** One of every state the stats can show, across four people and a guest. */
const FIXTURES: readonly Appointment[] = [
  visit('ana-1', UtcEpochMs.plusMs(NOW, -120 * DAY), [
    { who: ANA, outcome: 'WORKED', barber: 'ivan' },
  ]),
  visit('ana-2', UtcEpochMs.plusMs(NOW, -90 * DAY), [
    { who: ANA, outcome: 'WORKED', barber: 'ivan' },
  ]),
  visit('ana-3', UtcEpochMs.plusMs(NOW, -60 * DAY), [
    { who: ANA, outcome: 'WORKED', barber: 'ivan' },
    { who: BOB, outcome: 'WORKED', barber: 'petar', service: 'kids' },
  ]),
  visit('ana-late', UtcEpochMs.plusMs(NOW, -40 * DAY), [
    {
      who: ANA,
      outcome: {
        by: CancelledBy.Client,
        reason: CancellationReason.Unspecified,
        leadHours: 2,
      },
    },
  ]),
  visit('ana-shop', UtcEpochMs.plusMs(NOW, -20 * DAY), [
    {
      who: ANA,
      outcome: {
        by: CancelledBy.Staff,
        reason: CancellationReason.StaffBarberAbsence,
        leadHours: 30,
      },
    },
  ]),
  visit('ana-4', UtcEpochMs.plusMs(NOW, -10 * DAY), [
    { who: ANA, outcome: 'WORKED', barber: 'ivan', service: 'cut' },
    { who: ANA, outcome: 'WORKED', barber: 'ivan', service: 'beard' },
  ]),
  visit('ana-next', UtcEpochMs.plusMs(NOW, 14 * DAY), [
    { who: ANA, outcome: 'SCHEDULED' },
  ]),
  visit('zora-1', UtcEpochMs.plusMs(NOW, -50 * DAY), [
    { who: ZORA, outcome: 'NO_SHOW' },
  ]),
  visit('zora-2', UtcEpochMs.plusMs(NOW, -30 * DAY), [
    { who: ZORA, outcome: 'NO_SHOW' },
  ]),
  visit('zora-3', UtcEpochMs.plusMs(NOW, -5 * DAY), [
    { who: ZORA, outcome: 'NO_SHOW' },
    { who: null, outcome: 'WORKED' },
  ]),
  visit('walk-in', UtcEpochMs.plusMs(NOW, -2 * DAY), [
    { who: null, outcome: 'WORKED' },
  ]),
  visit('old-1', UtcEpochMs.plusMs(NOW, -500 * DAY), [
    { who: MIRA, outcome: 'WORKED', pref: 'ANY' },
  ]),
];

function bodyOf(entity: { readonly id: string }): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entity).filter(([key]) => key !== 'id'),
  );
}

const policyAt = (windowHours: number): BookingPolicy => ({
  ...BookingPolicy.DEFAULT,
  cancellationWindowHours: windowHours,
});

/** The bookkeeping a comparison of answers leaves out. */
const BOOKKEEPING = new Set([
  'version',
  'updatedAtUtcMs',
  'policyPassGeneration',
  'policyPassChangedAtSeconds',
  'policyPassChangedAtNanos',
]);

describe('client stats projection (emulator)', () => {
  let db: Firestore;

  beforeAll(() => {
    const app =
      admin.apps.find((a) => a?.name === PROJECT_ID) ??
      admin.initializeApp({ projectId: PROJECT_ID }, PROJECT_ID);
    db = app.firestore();
  });

  afterAll(async () => {
    await Promise.all(admin.apps.map((app) => app?.delete()));
  });

  beforeEach(async () => {
    await fetch(
      `http://${EMULATOR}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
      { method: 'DELETE' },
    );
    await db
      .collection(Collections.Users)
      .doc(SYSADMIN)
      .set({ roles: ['sysadmin'] });
  });

  /** The ports the composition root wires, at a pinned clock and a live window. */
  function portsAt(
    clockUtcMs: UtcEpochMs = NOW,
    loadPolicy: LoadPolicy = async () => Result.ok(policyAt(24)),
  ) {
    const telemetry = recordingTelemetry();
    return {
      commit: firestoreCommitPlan(db),
      nowUtcMs: () => clockUtcMs,
      nextId: sequentialIds('0'),
      hash: sha256Hex,
      tenantTimeZone: FIXTURE_TIME_ZONE,
      ...telemetry,
      loadPolicy,
      ...firestoreClientStatsPorts(db),
      ...firestoreJobPorts(db),
      ...firestoreAuditPorts(db, telemetry),
    };
  }

  async function seed(fixtures: readonly Appointment[] = FIXTURES) {
    const batch = db.batch();
    for (const appointment of fixtures) {
      batch.set(
        db.collection(Collections.Appointments).doc(appointment.id),
        bodyOf(appointment),
      );
    }
    await batch.commit();
  }

  const statsRef = (who: UserId) =>
    db.collection(Collections.ClientStats).doc(customerOf(who));
  const moneyRef = (who: UserId) =>
    statsRef(who).collection(Subcollections.Restricted).doc(CLIENT_MONEY_DOC);

  async function clearStats() {
    for (const who of SUBJECTS) {
      await moneyRef(who).delete();
      await statsRef(who).delete();
    }
  }

  async function readAll() {
    const out = new Map<string, Record<string, unknown> | undefined>();
    for (const who of SUBJECTS) {
      out.set(who, (await statsRef(who).get()).data());
      out.set(`${who}/money`, (await moneyRef(who).get()).data());
    }
    return Object.fromEntries(out);
  }

  function content(docs: Record<string, Record<string, unknown> | undefined>) {
    return Object.fromEntries(
      Object.entries(docs).map(([key, data]) => [
        key,
        data === undefined
          ? undefined
          : Object.fromEntries(
              Object.entries(data).filter(([field]) => !BOOKKEEPING.has(field)),
            ),
      ]),
    );
  }

  /** The dispatch trigger, replayed: each fixture's create as its own delivery. */
  async function replayTrigger() {
    const project = projectClientStats(portsAt());
    for (const appointment of FIXTURES) {
      const command = decodeDispatchProjectionsEvent({
        id: `create-${appointment.id}`,
        time: '2026-09-25T08:00:00.000Z',
        params: { appointmentId: appointment.id },
        data: {
          before: { exists: false, data: () => undefined },
          after: { exists: true, data: () => bodyOf(appointment) },
        },
      });
      const answer = await project(command);
      expect(answer.ok && answer.value.failures).toEqual([]);
    }
  }

  /** A whole run, a call at a time — from the top, then resuming from its progress. */
  async function backfill(
    backfillJobName: BackfillJobName,
    pageSize = 5,
    spent: () => boolean = () => false,
  ) {
    const call = runBackfill(portsAt(), {
      pageSize,
      chunkSize: 2,
      sampleSize: 20,
    });
    const command = (request: BackfillRequest) => ({
      callerUserId: SYSADMIN,
      actor: Actor.forCaller(SYSADMIN, [Role.Sysadmin]),
      request,
    });
    let result = await call(
      command({ backfillJobName, start: { backfillStart: BackfillStart.Top } }),
      { spent },
    );
    let calls = 1;
    while (result.ok && !result.value.done) {
      result = await call(
        command({
          backfillJobName,
          start: { backfillStart: BackfillStart.Resume },
        }),
        { spent },
      );
      calls += 1;
      if (calls > 60) throw new Error('backfill did not finish');
    }
    if (!result.ok)
      throw new Error(`backfill failed: ${JSON.stringify(result.error)}`);
    return { result: result.value, calls };
  }

  it('trigger and backfill agree on every fixture', async () => {
    await seed();
    await replayTrigger();
    const fromTrigger = await readAll();

    await clearStats();
    const { result, calls } = await backfill(BackfillJobName.ClientStats, 5);
    const fromBackfill = await readAll();

    // 12 appointments, 5 a page, then the 4 stored clients on one page.
    expect(calls).toBe(4);
    expect(result.total).toBe(FIXTURES.length);
    expect(content(fromBackfill)).toEqual(content(fromTrigger));
    expect(result.sampleChecked).toBe(4);
    expect(result.sampleMismatched).toEqual([]);

    // Spot-check the facts themselves, not only the agreement.
    expect(fromBackfill[ANA]).toMatchObject({
      customerId: customerOf(ANA),
      lifetimeVisitsCompleted: 4,
      lifetimeNoShows: 0,
      lifetimeLateCancels: 1,
      lifetimeClientCancels: 1,
      nextVisitAppointmentId: 'ana-next',
    });
    expect(fromBackfill[BOB]).toMatchObject({ lifetimeVisitsCompleted: 1 });
    expect(fromBackfill[ZORA]?.['pauseSuggestionBasis']).toEqual([
      'zora-1',
      'zora-2',
      'zora-3',
    ]);
  });

  it('a second backfill changes no byte but updatedAtUtcMs', async () => {
    await seed();
    await backfill(BackfillJobName.ClientStats);
    const first = await readAll();
    await backfill(BackfillJobName.ClientStats);
    const second = await readAll();
    const withoutUpdatedAt = (docs: typeof first) =>
      Object.fromEntries(
        Object.entries(docs).map(([key, data]) => [
          key,
          data === undefined
            ? undefined
            : Object.fromEntries(
                Object.entries(data).filter(
                  ([field]) => field !== 'updatedAtUtcMs',
                ),
              ),
        ]),
      );
    expect(withoutUpdatedAt(second)).toEqual(withoutUpdatedAt(first));
  });

  it('writes the spend to restricted/money alone, at the stats version', async () => {
    await seed();
    await backfill(BackfillJobName.ClientStats);
    const docs = await readAll();
    expect(JSON.stringify(docs[ANA])).not.toMatch(/spend/i);
    expect(docs[`${ANA}/money`]).toMatchObject({
      customerId: customerOf(ANA),
      lifetimeSpendCents: 5 * 2500, // four visits, one of them two services
      currency: 'EUR',
      version: docs[ANA]?.['version'],
    });
  });

  it('stamps both mirrors on legacy rows, then lands on the same stats but the preferred barber', async () => {
    await seed();
    await replayTrigger();
    const fromTrigger = content(await readAll());
    await clearStats();

    // Strip the mirrors and the commit's stamp, as a row written before them.
    for (const appointment of FIXTURES) {
      await db.collection(Collections.Appointments).doc(appointment.id).update({
        subjectUserIds: FieldValue.delete(),
        subjectCustomerIds: FieldValue.delete(),
        placement: null,
      });
    }
    // The commit rows of Ana's worked visits — the only evidence a placement
    // may be rebuilt from.
    const commits: readonly (readonly [string, AuditAction])[] = [
      ['ana-1', AuditAction.BookingCommitted],
      ['ana-2', AuditAction.BookingCommitted],
      ['ana-3', AuditAction.BookingStaffCreated],
      ['ana-4', AuditAction.BookingCommitted],
    ];
    for (const [resourceId, action] of commits) {
      await db
        .collection(Collections.AuditLog)
        .doc(`row-${resourceId}`)
        .set({
          recordedAtUtcMs: NOW,
          resourceId,
          ...Actor.system(SystemSource.Fixture),
          ...AuditContext.placement(
            action as typeof AuditAction.BookingCommitted,
            FIXTURE_IDS.location,
          ),
          ...AuditTargetRef.none(),
        });
    }

    const mirror = await backfill(BackfillJobName.SubjectMirror);
    expect(mirror.result.sampleChecked).toBeNull();
    const rows = (await db.collection(Collections.Appointments).get()).docs;
    const inferred = Object.fromEntries(
      rows.map((doc) => [doc.id, doc.get('inferredPlacement')]),
    );
    expect(inferred['ana-3']).toBe(Placement.Staff);
    expect(inferred['ana-1']).toBe(Placement.Self);
    expect(inferred['walk-in']).toBeNull();
    expect(inferred['old-1']).toBeNull();
    expect(rows.every((doc) => doc.get('placement') === null)).toBe(true);
    const party = (
      await db.collection(Collections.Appointments).doc('ana-3').get()
    ).data();
    expect(party?.['subjectUserIds']).toEqual([ANA, BOB].sort());
    expect(party?.['subjectCustomerIds']).toEqual(
      [customerOf(ANA), customerOf(BOB)].sort(),
    );

    await backfill(BackfillJobName.ClientStats);
    // Everything the trigger said, except «asks for Ivan»: an inferred
    // placement is no evidence of a request.
    const trigger = fromTrigger[ANA] as Record<string, unknown>;
    expect(trigger['preferredBarberId']).toBe('ivan');
    expect(content(await readAll())).toEqual({
      ...fromTrigger,
      [ANA]: { ...trigger, preferredBarberId: null },
    });
  });

  it('resumes from its progress document when called without a cursor', async () => {
    await seed();
    const call = runBackfill(portsAt(), {
      pageSize: 4,
      chunkSize: 4,
      sampleSize: 20,
    });
    const command = (start: BackfillRequest['start']) => ({
      callerUserId: SYSADMIN,
      actor: Actor.forCaller(SYSADMIN, [Role.Sysadmin]),
      request: { backfillJobName: BackfillJobName.SubjectMirror, start },
    });
    const first = await call(command({ backfillStart: BackfillStart.Top }), {
      spent: () => false,
    });
    expect(first.ok && first.value).toMatchObject({
      done: false,
      processed: 4,
      total: 4,
    });
    const progress = (
      await db.collection(Collections.BackfillJobs).doc('subjectMirror').get()
    ).data() as Omit<BackfillJob, 'id'>;
    expect(progress).toMatchObject({
      cursor: first.ok ? first.value.cursor : null,
      processed: 4,
      finishedAtUtcMs: null,
    });
    const second = await call(
      command({ backfillStart: BackfillStart.Resume }),
      {
        spent: () => false,
      },
    );
    expect(second.ok && second.value).toMatchObject({ processed: 4, total: 8 });
  });

  it('a budget-bound backfill lands where an unhurried one does', async () => {
    await seed();
    await backfill(BackfillJobName.ClientStats);
    const unhurried = content(await readAll());
    await clearStats();
    const { calls } = await backfill(
      BackfillJobName.ClientStats,
      5,
      () => true,
    );
    expect(calls).toBeGreaterThan(4);
    expect(content(await readAll())).toEqual(unhurried);
  });

  /** The settings trigger's start, for a move of the free window from 24 h to `windowHours`. */
  async function startPass(windowHours: number) {
    return startPolicyRecompute(portsAt())({
      settingsDocId: 'bookingPolicy',
      before: policyAt(24),
      after: policyAt(windowHours),
      generation: 'evt-policy',
      changedAt: PreciseInstant.fromEpochMs(UtcEpochMs.plusMs(NOW, -1_000)),
    });
  }

  async function jobNow(): Promise<PolicyRecomputeJob | null> {
    const snap = await db
      .collection(Collections.BackfillJobs)
      .doc(POLICY_RECOMPUTE_DOC)
      .get();
    return snap.exists
      ? ({ id: snap.id, ...snap.data() } as PolicyRecomputeJob)
      : null;
  }

  /** Each job write fires the next step, one stored client a step, until the chain rests. */
  async function stepsUntilRest(
    windowHours: number,
    clockUtcMs: UtcEpochMs = NOW,
  ) {
    const step = continuePolicyRecompute(
      portsAt(clockUtcMs, async () => Result.ok(policyAt(windowHours))),
      1,
    );
    const outcomes: PolicyStepOutcome[] = [];
    for (let guard = 0; guard < 20; guard++) {
      const report = await step(
        { fired: await jobNow() },
        { spent: () => true },
      );
      const outcome = report.ok ? report.value.policyStepOutcome : null;
      if (outcome === null) break;
      outcomes.push(outcome);
      if (outcome !== PolicyStepOutcome.Advanced) break;
    }
    return outcomes;
  }

  const lateCancelsOf = (stats: Record<string, unknown> | undefined) =>
    stats?.['lifetimeLateCancels'];

  it('a policy change re-judges every stored client through the job, a budgeted step at a time', async () => {
    await seed();
    await backfill(BackfillJobName.ClientStats);
    expect(lateCancelsOf((await readAll())[ANA])).toBe(1);
    // The owner shortens the free window to 1 h: Ana's 2 h cancel — stored
    // before cancellations were stamped — is judged by it, and is free now.
    expect(await startPass(1)).toMatchObject({ ok: true });
    expect(await stepsUntilRest(1)).toEqual([
      PolicyStepOutcome.Advanced,
      PolicyStepOutcome.Advanced,
      PolicyStepOutcome.Advanced,
      PolicyStepOutcome.Advanced,
      PolicyStepOutcome.Finished,
    ]);
    expect(await jobNow()).toMatchObject({
      storedClients: SUBJECTS.length,
      failed: 0,
    });
    expect(lateCancelsOf((await readAll())[ANA])).toBe(0);
  });

  it('a policy change leaves a stamped cancellation where the rule of its day put it', async () => {
    const lateBy = (who: UserId, windowHours?: number) =>
      visit(`${who}-late`, UtcEpochMs.plusMs(NOW, -40 * DAY), [
        {
          who,
          outcome: {
            by: CancelledBy.Client,
            reason: CancellationReason.Unspecified,
            leadHours: 2,
            ...(windowHours === undefined ? {} : { windowHours }),
          },
        },
      ]);
    await seed([lateBy(ANA), lateBy(BOB, 24)]);
    await backfill(BackfillJobName.ClientStats);
    const before = await readAll();
    expect([lateCancelsOf(before[ANA]), lateCancelsOf(before[BOB])]).toEqual([
      1, 1,
    ]);
    await startPass(1);
    expect((await stepsUntilRest(1)).at(-1)).toBe(PolicyStepOutcome.Finished);
    const after = await readAll();
    expect([lateCancelsOf(after[ANA]), lateCancelsOf(after[BOB])]).toEqual([
      0, 1,
    ]);
  });

  it('a pass that stalls says so on its job, rests, and the daily sweep carries it on', async () => {
    await seed();
    await backfill(BackfillJobName.ClientStats);
    await startPass(1);
    // A permanent failure before the first page: stalled, and recorded.
    const broken = continuePolicyRecompute(
      portsAt(NOW, async () =>
        Result.err(
          RepositoryError.readFailed('settings/bookingPolicy', 'internal'),
        ),
      ),
      1,
    );
    const stalled = await broken(
      { fired: await jobNow() },
      { spent: () => true },
    );
    expect(stalled.ok && stalled.value.policyStepOutcome).toBe(
      PolicyStepOutcome.Stalled,
    );
    expect(await jobNow()).toMatchObject({
      cursor: null,
      finishedAtUtcMs: null,
      stalledAtUtcMs: NOW,
      lastFailureCode: 'internal',
    });
    // The record's own write fires a step that rests on it.
    expect((await stepsUntilRest(1)).at(-1)).toBe(PolicyStepOutcome.Idle);

    // A day on, the sweep nudges the pass, and its steps finish it.
    const nextDay = UtcEpochMs.plusMs(NOW, DAY);
    const line = {
      updatedAt: PreciseInstant.fromEpochMs(UtcEpochMs.plusMs(NOW, -1_000)),
      windowHours: 1,
    };
    const sweep = sweepPolicyRecompute({
      ...portsAt(nextDay),
      loadPolicyLine: async () => Result.ok(line),
    });
    const nudged = await sweep();
    expect(nudged.ok && nudged.value.policySweepOutcome).toBe(
      PolicySweepOutcome.Nudged,
    );
    expect((await stepsUntilRest(1, nextDay)).at(-1)).toBe(
      PolicyStepOutcome.Finished,
    );
    expect(await jobNow()).toMatchObject({
      storedClients: SUBJECTS.length,
      stalledAtUtcMs: null,
      lastFailureCode: null,
    });
    expect(lateCancelsOf((await readAll())[ANA])).toBe(0);
    const rested = await sweep();
    expect(rested.ok && rested.value.policySweepOutcome).toBe(
      PolicySweepOutcome.Idle,
    );
  });

  it('the daily sweep starts the pass a dropped start owed, ordered by the policy document’s own update time', async () => {
    await seed();
    await backfill(BackfillJobName.ClientStats);
    expect(lateCancelsOf((await readAll())[ANA])).toBe(1);
    const settings = db.collection(Collections.Settings).doc('bookingPolicy');
    await settings.set({ cancellationWindowHours: 1 });

    const policyLine = firestoreClientStatsPorts(db).loadPolicyLine;
    const read = await policyLine();
    if (!read.ok || read.value.updatedAt === null) {
      throw new Error('the policy line did not read');
    }
    const line = read.value;
    const updatedAt = read.value.updatedAt;
    expect(line.windowHours).toBe(1);
    // Nanosecond precision, the instant the store stamped.
    const written = (await settings.get()).updateTime;
    expect(updatedAt).toEqual(
      PreciseInstant.of(written?.seconds ?? 0, written?.nanoseconds ?? 0),
    );

    const nextDay = UtcEpochMs.plusMs(
      PreciseInstant.toEpochMs(updatedAt) ?? NOW,
      DAY,
    );
    const sweep = sweepPolicyRecompute({
      ...portsAt(nextDay),
      loadPolicyLine: policyLine,
    });
    const started = await sweep();
    expect(started.ok && started.value.policySweepOutcome).toBe(
      PolicySweepOutcome.Started,
    );
    expect(await jobNow()).toMatchObject({
      changedAtSeconds: updatedAt.seconds,
      changedAtNanos: updatedAt.nanos,
      windowHours: 1,
    });
    expect((await stepsUntilRest(1, nextDay)).at(-1)).toBe(
      PolicyStepOutcome.Finished,
    );
    const judged = await readAll();
    expect(lateCancelsOf(judged[ANA])).toBe(0);
    expect(judged[ANA]).toMatchObject({
      policyPassChangedAtSeconds: updatedAt.seconds,
      policyPassChangedAtNanos: updatedAt.nanos,
    });

    // The job now answers the document; an edit that moves no line (the
    // horizon) starts nothing either.
    const idle = await sweep();
    expect(idle.ok && idle.value.policySweepOutcome).toBe(
      PolicySweepOutcome.Idle,
    );
    await settings.set({ cancellationWindowHours: 1, horizonMonths: 3 });
    const stillIdle = await sweep();
    expect(stillIdle.ok && stillIdle.value.policySweepOutcome).toBe(
      PolicySweepOutcome.Idle,
    );
    // The edge parses a change's own event time at the same precision.
    expect(preciseInstantOf('2026-09-25T08:00:00.000001Z').nanos).toBe(1_000);
  });
});
