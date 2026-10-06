import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import admin from 'firebase-admin';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { Money, ZonedDateTime } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import { BarberId, ServiceId, ServiceTerms } from '@creativo/domain/catalog';
import {
  Appointment,
  BarberPref,
  BookingPolicy,
  CancellationWindow,
  ClientStatsPolicy,
  Seat,
  SeatId,
  SeatLabel,
  type SeatOutcome,
  SeatSubject,
  CONFIRMED,
  summarizeSeatOutcomes,
} from '@creativo/domain/scheduling';
import {
  CLIENT_STATS_COLLECTION,
  POLICY_PASS_FIELD,
  type PersistedDocument,
  appointmentToDocument,
  policyPassOf,
} from '@creativo/application/booking';
import { projectAppointmentWrite } from './dispatch-client-projections';
import { runBackfillPage } from '../ops/run-backfill';
import type { BackfillJob } from '../ops/backfill-plan';
import { UNBOUNDED_BUDGET, type WorkBudget } from '../ops/work-budget';
import {
  compareInstants,
  policyJobFromDocument,
} from './policy-recompute-plan';
import {
  type PolicyChangeDeps,
  continuePolicyRecompute,
  readPolicyLine,
  startPolicyRecompute,
  sweepPolicyRecompute,
} from './recompute-on-policy-change';

/**
 * The client-stats shell against the REAL Firestore emulator (§12.4 P0 exit
 * criteria): the trigger and the backfill agree on every fixture, a second
 * backfill changes no byte but `updatedAt`, and the spend lands in its own
 * admin-only document. Transactions over an `array-contains` query and a
 * re-read-then-stamp of legacy rows are exactly what a fake would flatter.
 *
 * Emulator-only by construction: refuses to run without a local
 * `FIRESTORE_EMULATOR_HOST`, on a demo project of its own.
 */
const PROJECT_ID = 'demo-functions-client-stats';

const EMULATOR = (process.env['FIRESTORE_EMULATOR_HOST'] ??= '127.0.0.1:8080');
if (!EMULATOR.includes('127.0.0.1')) {
  throw new Error('Refusing to run outside the local emulators.');
}

const ZONE = 'Europe/Sofia';
const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = Date.parse('2026-09-25T08:00:00.000Z');
const clockMs = () => NOW;
const loadPolicy = async () => ClientStatsPolicy.default();

function must<T>(result: { isFailure(): boolean; value?: T }): T {
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value as T;
}

type Outcome =
  | 'worked'
  | 'no_show'
  | 'scheduled'
  | {
      readonly by: 'client' | 'staff';
      readonly reason: 'unspecified' | 'staff_barber_absence';
      readonly leadHours: number;
      /**
       * The window stamped when it was called off (2026-09-25). Absent is a
       * row stored before the stamp — judged by whatever the window is now.
       */
      readonly windowHours?: number;
    };

interface SeatFixture {
  readonly who: string | null;
  readonly outcome: Outcome;
  readonly barber?: string;
  readonly service?: string;
  readonly pref?: 'any' | 'specific';
}

function outcomeAt(outcome: Outcome, startMs: number): SeatOutcome {
  if (outcome === 'worked') return { kind: 'worked', atMs: startMs + HOUR / 2 };
  if (outcome === 'no_show')
    return { kind: 'no_show', atMs: startMs + HOUR / 4 };
  if (outcome === 'scheduled') return { kind: 'scheduled' };
  return {
    kind: 'cancelled',
    atMs: startMs - outcome.leadHours * HOUR,
    by: outcome.by,
    reason: { kind: outcome.reason },
    window:
      outcome.windowHours === undefined
        ? null
        : must<CancellationWindow>(
            CancellationWindow.create(outcome.windowHours),
          ),
  };
}

/** A stored appointment, written the way the commit path writes one. */
function visit(
  id: string,
  startMs: number,
  seats: readonly SeatFixture[],
): PersistedDocument {
  const built = seats.map((fixture, index) => {
    const barberId = must<BarberId>(
      BarberId.create(fixture.barber ?? `barber-${index}`),
    );
    const seatStart = startMs + index * 45 * 60_000;
    return Seat.of({
      id: must<SeatId>(SeatId.create(`${id}-s${index}`)),
      subject:
        fixture.who === null
          ? SeatSubject.anonymous(must<SeatLabel>(SeatLabel.create('Гост')))
          : SeatSubject.account(
              must<UserId>(UserId.create(fixture.who)),
              fixture.who === seats[0]?.who ? 'self' : 'companion',
            ),
      serviceId: must<ServiceId>(ServiceId.create(fixture.service ?? 'cut')),
      variantId: null,
      barberId,
      pref:
        fixture.pref === 'any'
          ? BarberPref.any()
          : BarberPref.specific(barberId),
      terms: must<ServiceTerms>(
        ServiceTerms.create(
          must<Money>(Money.fromMinorUnitsAndCode(2500, 'EUR')),
          30,
        ),
      ),
      startsAt: must<ZonedDateTime>(ZonedDateTime.fromMillis(seatStart, ZONE)),
      outcome: outcomeAt(fixture.outcome, startMs),
    });
  });
  const appointment = must<Appointment>(
    Appointment.reconstitute({
      id,
      locationId: 'shop-1',
      seats: built,
      status: summarizeSeatOutcomes(
        built.map((seat) => seat.outcome),
        CONFIRMED,
      ),
      bookedAt: must<ZonedDateTime>(
        ZonedDateTime.fromMillis(startMs - 10 * DAY, ZONE),
      ),
    }),
  );
  return appointmentToDocument(appointment, {
    placement: seats[0]?.who === null ? 'staff' : 'self',
  });
}

/** One of every §12 state the stats can show, across four people and a guest. */
const FIXTURES: Record<string, PersistedDocument> = {
  'ana-1': visit('ana-1', NOW - 120 * DAY, [
    { who: 'ana', outcome: 'worked', barber: 'ivan' },
  ]),
  'ana-2': visit('ana-2', NOW - 90 * DAY, [
    { who: 'ana', outcome: 'worked', barber: 'ivan' },
  ]),
  'ana-3': visit('ana-3', NOW - 60 * DAY, [
    { who: 'ana', outcome: 'worked', barber: 'ivan' },
    { who: 'bob', outcome: 'worked', barber: 'petar', service: 'kids' },
  ]),
  'ana-late': visit('ana-late', NOW - 40 * DAY, [
    {
      who: 'ana',
      outcome: { by: 'client', reason: 'unspecified', leadHours: 2 },
    },
  ]),
  'ana-shop': visit('ana-shop', NOW - 20 * DAY, [
    {
      who: 'ana',
      outcome: { by: 'staff', reason: 'staff_barber_absence', leadHours: 30 },
    },
  ]),
  'ana-4': visit('ana-4', NOW - 10 * DAY, [
    { who: 'ana', outcome: 'worked', barber: 'ivan', service: 'cut' },
    { who: 'ana', outcome: 'worked', barber: 'ivan', service: 'beard' },
  ]),
  'ana-next': visit('ana-next', NOW + 14 * DAY, [
    { who: 'ana', outcome: 'scheduled' },
  ]),
  'zora-1': visit('zora-1', NOW - 50 * DAY, [
    { who: 'zora', outcome: 'no_show' },
  ]),
  'zora-2': visit('zora-2', NOW - 30 * DAY, [
    { who: 'zora', outcome: 'no_show' },
  ]),
  'zora-3': visit('zora-3', NOW - 5 * DAY, [
    { who: 'zora', outcome: 'no_show' },
    { who: null, outcome: 'worked' },
  ]),
  'walk-in': visit('walk-in', NOW - 2 * DAY, [
    { who: null, outcome: 'worked' },
  ]),
  'old-1': visit('old-1', NOW - 500 * DAY, [
    { who: 'mira', outcome: 'worked', pref: 'any' },
  ]),
};

const SUBJECTS = ['ana', 'bob', 'mira', 'zora'];

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
  });

  async function seed(
    fixtures: Record<string, PersistedDocument> = FIXTURES,
  ): Promise<void> {
    const batch = db.batch();
    for (const [id, data] of Object.entries(fixtures)) {
      batch.set(db.collection('appointments').doc(id), data);
    }
    await batch.commit();
  }

  async function clearStats(): Promise<void> {
    for (const uid of SUBJECTS) {
      const ref = db.collection(CLIENT_STATS_COLLECTION).doc(uid);
      await ref.collection('restricted').doc('money').delete();
      await ref.delete();
    }
  }

  /** Every subject's two documents, raw. */
  async function readAll(): Promise<
    Record<string, PersistedDocument | undefined>
  > {
    const out = new Map<string, PersistedDocument | undefined>();
    for (const uid of SUBJECTS) {
      const ref = db.collection(CLIENT_STATS_COLLECTION).doc(uid);
      out.set(uid, (await ref.get()).data());
      out.set(
        `${uid}/money`,
        (await ref.collection('restricted').doc('money').get()).data(),
      );
    }
    return Object.fromEntries(out);
  }

  /** The documents minus their bookkeeping — what trigger and backfill must agree on. */
  function content(
    docs: Record<string, PersistedDocument | undefined>,
  ): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(docs).map(([key, data]) => [
        key,
        data === undefined
          ? undefined
          : Object.fromEntries(
              Object.entries(data).filter(
                ([field]) =>
                  field !== 'version' &&
                  field !== 'updatedAt' &&
                  field !== POLICY_PASS_FIELD,
              ),
            ),
      ]),
    );
  }

  async function replayTrigger(): Promise<void> {
    for (const [id, data] of Object.entries(FIXTURES)) {
      await projectAppointmentWrite(
        {
          id: `create-${id}`,
          time: new Date(NOW).toISOString(),
          data: {
            before: { data: () => undefined },
            after: { data: () => data },
          },
        },
        db,
        { clockMs, loadPolicy },
      );
    }
  }

  async function backfill(
    job: BackfillJob,
    pageSize = 5,
    startBudget: () => WorkBudget = () => UNBOUNDED_BUDGET,
  ) {
    const deps = {
      clockMs,
      loadPolicy,
      pageSize,
      chunkSize: 2,
      sampleSize: 20,
      // A documentId filter refuses an empty id; '0' sorts before every uid.
      samplePivot: () => '0',
      startBudget,
    };
    let result = await runBackfillPage(db, { job, cursor: null }, deps);
    let calls = 1;
    while (!result.done) {
      // No cursor: the job's progress document carries it (resumable).
      result = await runBackfillPage(db, { job }, deps);
      calls += 1;
      if (calls > 50) throw new Error('backfill did not finish');
    }
    return { result, calls };
  }

  it('trigger and backfill agree on every fixture', async () => {
    await seed();
    await replayTrigger();
    const fromTrigger = await readAll();

    await clearStats();
    const { result, calls } = await backfill('clientStats', 5);
    const fromBackfill = await readAll();

    // 12 appointments, 5 a page, then the 4 stored clients on one page.
    expect(calls).toBe(4);
    expect(result.total).toBe(Object.keys(FIXTURES).length);
    expect(content(fromBackfill)).toEqual(content(fromTrigger));
    expect(result.sample).toEqual({ checked: 4, mismatched: [] });

    // Spot-check the facts themselves, not only the agreement.
    const ana = fromBackfill['ana'];
    expect(ana?.['lifetime']).toEqual({
      visitsCompleted: 4,
      noShows: 0,
      lateCancels: 1,
      clientCancels: 1,
    });
    expect((ana?.['nextVisit'] as PersistedDocument)['appointmentId']).toBe(
      'ana-next',
    );
    expect(fromBackfill['bob']?.['lifetime']).toMatchObject({
      visitsCompleted: 1,
    });
    expect(
      (fromBackfill['zora']?.['pauseSuggestion'] as PersistedDocument)['basis'],
    ).toEqual(['zora-1', 'zora-2', 'zora-3']);
  });

  it('a second backfill changes no byte but updatedAt', async () => {
    await seed();
    await backfill('clientStats');
    const first = await readAll();
    await backfill('clientStats');
    const second = await readAll();

    const withoutUpdatedAt = (docs: typeof first) =>
      Object.fromEntries(
        Object.entries(docs).map(([key, data]) => [
          key,
          data === undefined
            ? undefined
            : Object.fromEntries(
                Object.entries(data).filter(([field]) => field !== 'updatedAt'),
              ),
        ]),
      );
    expect(withoutUpdatedAt(second)).toEqual(withoutUpdatedAt(first));
  });

  it('writes the spend to restricted/money alone, at the stats version', async () => {
    await seed();
    await backfill('clientStats');
    const docs = await readAll();

    expect(docs['ana']).not.toHaveProperty('lifetimeSpendMinor');
    expect(JSON.stringify(docs['ana'])).not.toMatch(/spend/i);
    expect(docs['ana/money']).toMatchObject({
      userId: 'ana',
      lifetimeSpendMinor: 5 * 2500, // four visits, one of them two services
      currencyCode: 'EUR',
      version: docs['ana']?.['version'],
    });
  });

  it('stamps the mirrors on legacy rows, then lands on the same stats but the preferred barber', async () => {
    await seed();
    await replayTrigger();
    const fromTrigger = content(await readAll());
    await clearStats();

    // Strip the mirrors, as a row written before them would be.
    for (const id of Object.keys(FIXTURES)) {
      await db.collection('appointments').doc(id).update({
        subjectUserIds: FieldValue.delete(),
        placement: FieldValue.delete(),
      });
    }
    // The commit rows of Ana's worked visits — the only evidence a
    // placement may be rebuilt from (§12.5.1).
    const commits: readonly (readonly [string, string])[] = [
      ['ana-1', 'booking.committed'],
      ['ana-2', 'booking.committed'],
      ['ana-3', 'booking.staff_created'],
      ['ana-4', 'booking.committed'],
    ];
    for (const [resourceId, action] of commits) {
      await db
        .collection('auditLog')
        .doc(`row-${resourceId}`)
        .set({
          action,
          resourceId,
          actor: { kind: 'system', source: 'fixture' },
          at: new Date(NOW).toISOString(),
          targetUserId: 'ana',
          context: null,
        });
    }

    const mirror = await backfill('subjectMirror');
    expect(mirror.result.sample).toBeNull();
    const rows = (await db.collection('appointments').get()).docs;
    const inferred = Object.fromEntries(
      rows.map((doc) => [doc.id, doc.get('inferredPlacement')]),
    );
    expect(inferred['ana-3']).toBe('staff'); // the audit row said so
    expect(inferred['ana-1']).toBe('self');
    // No commit row, no placement — owned or not. A legacy import must not
    // read as anybody's own request.
    expect(inferred['walk-in']).toBeUndefined();
    expect(inferred['old-1']).toBeUndefined();
    // The commit's own stamp is never reconstructed (legacyPref).
    expect(rows.every((doc) => doc.get('placement') === undefined)).toBe(true);
    expect(
      (await db.collection('appointments').doc('ana-3').get()).get(
        'subjectUserIds',
      ),
    ).toEqual(['ana', 'bob']);

    await backfill('clientStats');
    // Everything the trigger said, except «asks for Ivan»: these rows' seats
    // carry the pre-P0 commit's defaulted `specific`, which is no request.
    const trigger = fromTrigger['ana'] as Record<string, unknown>;
    expect(trigger['preferredBarberId']).toBe('ivan');
    expect(content(await readAll())).toEqual({
      ...fromTrigger,
      ana: { ...trigger, preferredBarberId: null },
    });
  });

  it('resumes from its progress document when called without a cursor', async () => {
    await seed();
    const deps = {
      clockMs,
      loadPolicy,
      pageSize: 4,
      chunkSize: 4,
      sampleSize: 20,
      // A documentId filter refuses an empty id; '0' sorts before every uid.
      samplePivot: () => '0',
      startBudget: () => UNBOUNDED_BUDGET,
    };
    const first = await runBackfillPage(
      db,
      { job: 'subjectMirror', cursor: null },
      deps,
    );
    expect(first).toMatchObject({ done: false, processed: 4, total: 4 });

    const progress = (
      await db.collection('backfillJobs').doc('subjectMirror').get()
    ).data();
    expect(progress).toMatchObject({
      cursor: first.cursor,
      processed: 4,
      finishedAt: null,
    });

    const second = await runBackfillPage(db, { job: 'subjectMirror' }, deps);
    expect(second).toMatchObject({ processed: 4, total: 8 });
  });

  // The 540 s timeout defect: a call stops taking chunks once its budget is
  // spent, and a run of such calls lands on the unhurried run's bytes.
  it('a budget-bound backfill lands where an unhurried one does', async () => {
    await seed();
    await backfill('clientStats');
    const unhurried = content(await readAll());
    await clearStats();

    // Every call spends its budget after its first chunk.
    const spent = (): WorkBudget => ({ spent: () => true });
    const { calls } = await backfill('clientStats', 5, spent);
    expect(calls).toBeGreaterThan(4);
    expect(content(await readAll())).toEqual(unhurried);
  });

  /** Steps that read the owner's free window as `hours`, one stored client a step. */
  function windowDeps(hours: number): PolicyChangeDeps {
    const defaults = BookingPolicy.default();
    const moved = must<BookingPolicy>(
      BookingPolicy.create({
        slotStepMinutes: defaults.slotStepMinutes,
        horizonMonths: defaults.horizonMonths,
        minLeadMinutes: defaults.minLeadMinutes,
        maxPartySize: defaults.maxPartySize,
        cancellationWindowHours: hours,
        maxFlexibleDays: defaults.maxFlexibleDays,
        autoConfirm: defaults.autoConfirm,
      }),
    );
    return {
      clockMs,
      loadPolicy: async () => ClientStatsPolicy.forBooking(moved),
      // The document the settings write (`startPass`) left behind.
      readPolicyLine: async () => ({
        updatedAt: new Date(NOW - 1_000).toISOString(),
        windowHours: hours,
      }),
      pageSize: 1,
      startBudget: (): WorkBudget => ({ spent: () => true }),
    };
  }

  const policyJobRef = () =>
    db.collection('backfillJobs').doc('clientStatsPolicy');

  /** The settings trigger's start, for a move of the free window from 24 h to `hours`. */
  async function startPass(hours: number, deps: PolicyChangeDeps) {
    return startPolicyRecompute(
      {
        id: 'evt-policy',
        time: new Date(NOW - 1_000).toISOString(),
        params: { docId: 'bookingPolicy' },
        data: {
          before: { data: () => ({ cancellationWindowHours: 24 }) },
          after: { data: () => ({ cancellationWindowHours: hours }) },
        },
      },
      db,
      deps,
    );
  }

  /** One delivery of the job document's write, as the step trigger sees it. */
  async function stepOnce(id: string, deps: PolicyChangeDeps) {
    const data = (await policyJobRef().get()).data();
    return continuePolicyRecompute(
      {
        id,
        time: new Date(NOW).toISOString(),
        data: { after: { data: () => data } },
      },
      db,
      deps,
    );
  }

  /** Each job write fires the next step, until the chain rests. Every step's outcome, in order. */
  async function stepsUntilRest(deps: PolicyChangeDeps): Promise<string[]> {
    const outcomes: string[] = [];
    for (let step = 0; step < 20; step += 1) {
      const outcome = await stepOnce(`evt-step-${step}`, deps);
      outcomes.push(outcome);
      if (outcome !== 'advanced') break;
    }
    return outcomes;
  }

  /**
   * The owner moves the free window from 24 h to `hours`: the settings
   * trigger starts the pass, and each job write fires the next step — one
   * stored client a step — until it finishes. Every step's outcome, in order.
   */
  async function windowMovedTo(hours: number): Promise<string[]> {
    const deps = windowDeps(hours);
    expect(await startPass(hours, deps)).toBe('started');
    return stepsUntilRest(deps);
  }

  /** A stored client's lifetime late-cancel count. */
  const lateCancelsOf = (stats: PersistedDocument | undefined): unknown =>
    (stats?.['lifetime'] as PersistedDocument)['lateCancels'];

  it('a policy change re-judges every stored client through the job, a budgeted step at a time', async () => {
    await seed();
    await backfill('clientStats');
    const before = await readAll();
    expect(
      (before['ana']?.['lifetime'] as PersistedDocument)['lateCancels'],
    ).toBe(1);

    // The owner shortens the free window to 1 h: Ana's 2 h cancel — stored
    // before cancellations were stamped — is judged by it, and is free now.
    const jobRef = db.collection('backfillJobs').doc('clientStatsPolicy');
    const outcomes = await windowMovedTo(1);
    // One stored client per step, then the empty page that ends the walk.
    expect(outcomes).toEqual([
      'advanced',
      'advanced',
      'advanced',
      'advanced',
      'finished',
    ]);
    expect(policyJobFromDocument((await jobRef.get()).data())).toMatchObject({
      storedClients: SUBJECTS.length,
      failed: 0,
    });
    const after = await readAll();
    expect(
      (after['ana']?.['lifetime'] as PersistedDocument)['lateCancels'],
    ).toBe(0);
  });

  it('a policy change leaves a stamped cancellation where the rule of its day put it', async () => {
    // The same 2 h client cancel twice: Ana's stored before the stamp, Bob's
    // stamped with the 24 h window it was made under.
    await seed({
      'ana-late': FIXTURES['ana-late'] as PersistedDocument,
      'bob-late': visit('bob-late', NOW - 40 * DAY, [
        {
          who: 'bob',
          outcome: {
            by: 'client',
            reason: 'unspecified',
            leadHours: 2,
            windowHours: 24,
          },
        },
      ]),
    });
    await backfill('clientStats');
    const before = await readAll();
    expect([
      lateCancelsOf(before['ana']),
      lateCancelsOf(before['bob']),
    ]).toEqual([1, 1]);

    expect((await windowMovedTo(1)).at(-1)).toBe('finished');
    const after = await readAll();
    expect([lateCancelsOf(after['ana']), lateCancelsOf(after['bob'])]).toEqual([
      0, 1,
    ]);
  });

  it('a pass that stalls says so on its job, rests, and the daily sweep carries it on', async () => {
    await seed();
    await backfill('clientStats');
    const deps = windowDeps(1);
    expect(await startPass(1, deps)).toBe('started');

    // A permanent failure before the first page: stalled, and recorded.
    const broken = { ...deps, loadPolicy: () => Promise.reject({ code: 13 }) };
    expect(await stepOnce('evt-broken', broken)).toBe('stalled');
    expect(
      policyJobFromDocument((await policyJobRef().get()).data()),
    ).toMatchObject({
      cursor: null,
      finishedAt: null,
      stalledAt: new Date(NOW).toISOString(),
      lastFailureCode: 'internal',
    });
    // The record's own write fires a step that rests on it.
    expect(await stepOnce('evt-stall-record', deps)).toBe('idle');

    // A day on, the sweep nudges the pass, and its steps finish it.
    const nextDay = NOW + DAY;
    const run = { id: 'sweep@1', time: new Date(nextDay).toISOString() };
    const sweepDeps = {
      clockMs: () => nextDay,
      readPolicyLine: deps.readPolicyLine,
    };
    expect(await sweepPolicyRecompute(run, db, sweepDeps)).toBe('nudged');
    expect((await stepsUntilRest(deps)).at(-1)).toBe('finished');
    expect(
      policyJobFromDocument((await policyJobRef().get()).data()),
    ).toMatchObject({
      storedClients: SUBJECTS.length,
      stalledAt: null,
      lastFailureCode: null,
    });
    expect(lateCancelsOf((await readAll())['ana'])).toBe(0);
    // A finished pass is left alone.
    expect(await sweepPolicyRecompute(run, db, sweepDeps)).toBe('idle');
  });

  // The start is dropped (no trigger runs here at all): the sweep reads the
  // REAL policy document — its `updateTime` is what orders it against the
  // job — and owes the book the pass nobody started.
  it('the daily sweep starts the pass a dropped start owed, ordered by the policy document’s own update time', async () => {
    await seed();
    await backfill('clientStats');
    expect(lateCancelsOf((await readAll())['ana'])).toBe(1);
    const settings = db.collection('settings').doc('bookingPolicy');
    await settings.set({ cancellationWindowHours: 1 });

    const line = await readPolicyLine(db);
    const written = (await settings.get()).updateTime;
    expect(line.windowHours).toBe(1);
    expect(line.updatedAt).not.toBeNull();
    // Nanosecond precision, and the same instant the store stamped: inside
    // the stamp's own millisecond. `toMillis()` floors; `toDate()` ROUNDS,
    // so it lands on the next millisecond whenever the stamp's sub-
    // millisecond part is at least half of one — ahead of the very instant.
    expect(line.updatedAt).toMatch(/\.\d{9}Z$/);
    const stampedMs = written?.toMillis() ?? Number.NaN;
    expect(
      compareInstants(line.updatedAt ?? '', new Date(stampedMs).toISOString()),
    ).toBeGreaterThanOrEqual(0);
    expect(
      compareInstants(
        line.updatedAt ?? '',
        new Date(stampedMs + 1).toISOString(),
      ),
    ).toBeLessThan(0);

    const nextDay = Date.now() + DAY;
    const run = { id: 'sweep@1', time: new Date(nextDay).toISOString() };
    const sweepDeps = { clockMs: () => nextDay, readPolicyLine };
    expect(await sweepPolicyRecompute(run, db, sweepDeps)).toBe('started');
    expect(
      policyJobFromDocument((await policyJobRef().get()).data()),
    ).toMatchObject({ changedAt: line.updatedAt, windowHours: 1 });
    expect((await stepsUntilRest(windowDeps(1))).at(-1)).toBe('finished');
    const judged = await readAll();
    expect(lateCancelsOf(judged['ana'])).toBe(0);
    expect(policyPassOf(judged['ana'])?.changedAt).toBe(line.updatedAt);

    // The job now answers the document: nothing more is owed, and an edit
    // that moves no line (the horizon) starts nothing either.
    expect(await sweepPolicyRecompute(run, db, sweepDeps)).toBe('idle');
    await settings.set({ cancellationWindowHours: 1, horizonMonths: 3 });
    expect(await sweepPolicyRecompute(run, db, sweepDeps)).toBe('idle');
  });
});
