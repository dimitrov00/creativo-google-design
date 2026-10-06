import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { Money, ZonedDateTime } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import { BarberId, ServiceId, ServiceTerms } from '@creativo/domain/catalog';
import {
  Appointment,
  BookingPolicy,
  CancellationWindow,
  ClientStatsPolicy,
  Seat,
  SeatId,
  SeatSubject,
  cancelled,
  seatCancelled,
} from '@creativo/domain/scheduling';
import {
  type PersistedDocument,
  appointmentToDocument,
  clientStatsFromDocument,
  policyPassOf,
} from '@creativo/application/booking';
import { createProjectionFirestore } from '../../test-support/fake-projection-firestore';
import { UNBOUNDED_BUDGET, type WorkBudget } from '../ops/work-budget';
import {
  type LivePolicyLine,
  type PolicyRecomputeJob,
  policyJobFromDocument,
  policyJobToDocument,
} from './policy-recompute-plan';
import { recomputeClientStats } from './recompute-client-stats';
import {
  type PolicyChangeDeps,
  type PolicyJobWriteEvent,
  type PolicyStepOutcome,
  type SettingsWriteEvent,
  continueClientStatsPolicyRecompute,
  continuePolicyRecompute,
  lateLineMoved,
  recomputeClientStatsOnPolicyChange,
  startPolicyRecompute,
  sweepClientStatsPolicyDaily,
  sweepPolicyRecompute,
} from './recompute-on-policy-change';

vi.mock('firebase-functions', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const NOW = Date.parse('2026-09-25T08:00:00.000Z');
const ZONE = 'Europe/Sofia';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function must<T>(result: { isFailure(): boolean; value?: T }): T {
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value as T;
}

function policy(cancellationWindowHours: number): ClientStatsPolicy {
  const defaults = BookingPolicy.default();
  return ClientStatsPolicy.forBooking(
    must<BookingPolicy>(
      BookingPolicy.create({
        slotStepMinutes: defaults.slotStepMinutes,
        horizonMonths: defaults.horizonMonths,
        minLeadMinutes: defaults.minLeadMinutes,
        maxPartySize: defaults.maxPartySize,
        cancellationWindowHours,
        maxFlexibleDays: defaults.maxFlexibleDays,
        autoConfirm: defaults.autoConfirm,
      }),
    ),
  );
}

/**
 * `who` called their visit off themselves, `leadHours` before it.
 * `windowHours` is the window stamped when they did; `null` — the default
 * here — is a cancellation stored before the stamp (2026-09-25), the only
 * kind whose verdict the live window still decides and so the one this
 * pass exists for.
 */
function cancelledAhead(
  id: string,
  who: string,
  leadHours: number,
  windowHours: number | null = null,
): PersistedDocument {
  const startMs = NOW - 10 * DAY;
  const appointment = must<Appointment>(
    Appointment.reconstitute({
      id,
      locationId: 'shop-1',
      seats: [
        Seat.of({
          id: must<SeatId>(SeatId.create(`${id}-s1`)),
          subject: SeatSubject.account(
            must<UserId>(UserId.create(who)),
            'self',
          ),
          serviceId: must<ServiceId>(ServiceId.create('cut')),
          variantId: null,
          barberId: must<BarberId>(BarberId.create('ivan')),
          terms: must<ServiceTerms>(
            ServiceTerms.create(
              must<Money>(Money.fromMinorUnitsAndCode(2500, 'EUR')),
              30,
            ),
          ),
          startsAt: must<ZonedDateTime>(
            ZonedDateTime.fromMillis(startMs, ZONE),
          ),
          outcome: seatCancelled(
            startMs - leadHours * HOUR,
            'client',
            { kind: 'unspecified' },
            windowHours === null
              ? null
              : must<CancellationWindow>(
                  CancellationWindow.create(windowHours),
                ),
          ),
        }),
      ],
      status: cancelled('unspecified'),
      bookedAt: must<ZonedDateTime>(
        ZonedDateTime.fromMillis(startMs - 5 * DAY, ZONE),
      ),
    }),
  );
  return appointmentToDocument(appointment, { placement: 'self' });
}

const JOB = 'backfillJobs/clientStatsPolicy';

/** The owner's edit of the late line, as a `settings/{docId}` write event. */
function settingsEvent(
  id: string,
  atMs: number,
  fromHours: number,
  toHours: number,
  docId = 'bookingPolicy',
): SettingsWriteEvent {
  return {
    id,
    time: new Date(atMs).toISOString(),
    params: { docId },
    data: {
      before: { data: () => ({ cancellationWindowHours: fromHours }) },
      after: { data: () => ({ cancellationWindowHours: toHours }) },
    },
  };
}

/** The job document's write as its trigger sees it — the data as of NOW. */
function jobEvent(
  docs: Map<string, PersistedDocument>,
  id = 'evt-job',
): PolicyJobWriteEvent {
  const data = docs.get(JOB);
  return {
    id,
    time: new Date(NOW - 1_000).toISOString(),
    data: { after: { data: () => data } },
  };
}

/** A budget spent after `pages` looks — one look per page after the first. */
const spentAfter = (looks: number) => (): WorkBudget => {
  let seen = 0;
  return { spent: () => ++seen > looks };
};

/** Ana and Bob both cancelled 30 h ahead, judged under a 24 h window: free. */
async function bookAt24() {
  const fixture = createProjectionFirestore({
    'appointments/a1': cancelledAhead('a1', 'ana', 30),
    'appointments/b1': cancelledAhead('b1', 'bob', 30),
  });
  const db = fixture.db as unknown as Firestore;
  const at24 = { policy: policy(24), clockMs: () => NOW };
  await recomputeClientStats(db, 'ana', at24);
  await recomputeClientStats(db, 'bob', at24);
  const late = (uid: string) =>
    clientStatsFromDocument(uid, fixture.docs.get(`clientStats/${uid}`))
      ?.lifetime.lateCancels;
  return { ...fixture, db, late };
}

/** The policy document as the sweep reads it: its window, and when it was last written. */
const lineAt = (windowHours: number, atMs: number | null): LivePolicyLine => ({
  windowHours,
  updatedAt: atMs === null ? null : new Date(atMs).toISOString(),
});

/** The live policy the steps read — the owner's latest word. */
function liveWindow(hours: number) {
  const live = { hours };
  const deps = (
    overrides: Partial<PolicyChangeDeps> = {},
  ): PolicyChangeDeps => ({
    clockMs: () => NOW,
    loadPolicy: async () => policy(live.hours),
    readPolicyLine: async () => lineAt(live.hours, null),
    pageSize: 200,
    startBudget: () => UNBOUNDED_BUDGET,
    ...overrides,
  });
  return { live, deps };
}

/** Every step the chain takes, each fired by the previous step's write. */
async function drain(
  db: Firestore,
  docs: Map<string, PersistedDocument>,
  deps: PolicyChangeDeps,
): Promise<PolicyStepOutcome[]> {
  const outcomes: PolicyStepOutcome[] = [];
  for (let i = 0; i < 50; i += 1) {
    const outcome = await continuePolicyRecompute(jobEvent(docs), db, deps);
    outcomes.push(outcome);
    if (outcome !== 'advanced') return outcomes;
  }
  throw new Error('the chain did not settle');
}

const jobOf = (docs: Map<string, PersistedDocument>) =>
  policyJobFromDocument(docs.get(JOB));

/**
 * `db`, with `action` run just before the `n`th read of the job document
 * through it. A step reads the job before EVERY page, so `n = 2` is the gap
 * between its first page and its second — where a newer change can land.
 */
function beforeJobRead(
  db: Firestore,
  n: number,
  action: () => Promise<unknown>,
): Firestore {
  let reads = 0;
  const collection = (name: string) => {
    const real = db.collection(name);
    if (name !== 'backfillJobs') return real;
    return {
      ...real,
      doc: (id: string) => {
        const ref = real.doc(id);
        return {
          ...ref,
          get: async () => {
            reads += 1;
            if (reads === n) await action();
            return ref.get();
          },
        };
      },
    };
  };
  return {
    collection,
    runTransaction: db.runTransaction.bind(db),
  } as unknown as Firestore;
}

/** `db`, with `action` run just before the `n`th transaction through it starts. */
function beforeTransaction(
  db: Firestore,
  n: number,
  action: () => Promise<unknown>,
): Firestore {
  let started = 0;
  return {
    collection: db.collection.bind(db),
    runTransaction: async (
      ...args: Parameters<Firestore['runTransaction']>
    ) => {
      started += 1;
      if (started === n) await action();
      return db.runTransaction(...args);
    },
  } as unknown as Firestore;
}

/** `db`, whose `n`th transaction rejects with `error` — every other one runs. */
function failingTransaction(
  db: Firestore,
  n: number,
  error: unknown,
): Firestore {
  let started = 0;
  return {
    collection: db.collection.bind(db),
    runTransaction: (...args: Parameters<Firestore['runTransaction']>) => {
      started += 1;
      return started === n ? Promise.reject(error) : db.runTransaction(...args);
    },
  } as unknown as Firestore;
}

describe('lateLineMoved', () => {
  it('wakes on the booking policy’s cancellation window and nothing else', () => {
    const window = (hours: number) => ({ cancellationWindowHours: hours });
    expect(lateLineMoved('bookingPolicy', window(24), window(48))).toBe(true);
    expect(lateLineMoved('bookingPolicy', undefined, window(48))).toBe(true);
    expect(lateLineMoved('bookingPolicy', window(24), window(24))).toBe(false);
    expect(
      lateLineMoved(
        'bookingPolicy',
        { ...window(24), horizonDays: 30 },
        { ...window(24), horizonDays: 60 },
      ),
    ).toBe(false);
    expect(lateLineMoved('supportPolicy', window(24), window(48))).toBe(false);
  });
});

describe('startPolicyRecompute — a durable pass, never the whole book in one go', () => {
  beforeEach(() => vi.mocked(logger.error).mockClear());

  it('starts a pass from the top and recomputes nobody itself', async () => {
    const { db, docs, late } = await bookAt24();
    const { deps } = liveWindow(48);
    const outcome = await startPolicyRecompute(
      settingsEvent('evt-a', NOW - 5_000, 24, 48),
      db,
      deps(),
    );
    expect(outcome).toBe('started');
    expect(jobOf(docs)).toMatchObject({
      generation: 'evt-a',
      cursor: null,
      storedClients: 0,
      finishedAt: null,
    });
    expect([late('ana'), late('bob')]).toEqual([0, 0]);
  });

  it('writes nothing when the write moved no late line', async () => {
    const { db, docs } = await bookAt24();
    const loadPolicy = vi.fn(async () => policy(24));
    const { deps } = liveWindow(24);
    expect(
      await startPolicyRecompute(
        settingsEvent('evt-a', NOW, 24, 24),
        db,
        deps({ loadPolicy }),
      ),
    ).toBe('unmoved');
    expect(
      await startPolicyRecompute(
        settingsEvent('evt-b', NOW, 24, 48, 'supportPolicy'),
        db,
        deps({ loadPolicy }),
      ),
    ).toBe('unmoved');
    expect(docs.has(JOB)).toBe(false);
    expect(loadPolicy).not.toHaveBeenCalled();
  });

  it('keeps its place on a redelivery, and against an older change delivered late', async () => {
    const { db, docs } = await bookAt24();
    const { deps } = liveWindow(48);
    await startPolicyRecompute(
      settingsEvent('evt-b', NOW - 1_000, 24, 48),
      db,
      deps(),
    );
    await continuePolicyRecompute(
      jobEvent(docs),
      db,
      deps({ pageSize: 1, startBudget: spentAfter(0) }),
    );
    const midway = docs.get(JOB);
    expect(jobOf(docs)?.cursor).toBe('ana');

    expect(
      await startPolicyRecompute(
        settingsEvent('evt-b', NOW - 1_000, 24, 48),
        db,
        deps(),
      ),
    ).toBe('unchanged');
    expect(
      await startPolicyRecompute(
        settingsEvent('evt-a', NOW - 9_000, 12, 24),
        db,
        deps(),
      ),
    ).toBe('unchanged');
    expect(docs.get(JOB)).toEqual(midway);
  });

  it('drops a start that failed permanently: logged, the job untouched, left to the backfill', async () => {
    const { db, docs } = await bookAt24();
    const { deps } = liveWindow(48);
    const broken = {
      collection: db.collection.bind(db),
      runTransaction: () => Promise.reject({ code: 13 }),
    } as unknown as Firestore;
    expect(
      await startPolicyRecompute(
        settingsEvent('evt-a', NOW - 2_000, 24, 48),
        broken,
        deps(),
      ),
    ).toBe('dropped');
    expect(docs.has(JOB)).toBe(false);
    expect(vi.mocked(logger.error).mock.calls[0]?.[1]).toEqual({
      fn: 'recomputeClientStatsOnPolicyChange',
      eventId: 'evt-a',
      outcome: 'permanent',
      code: 'internal',
      ageMs: 2_000,
    });
  });

  it('logs the attempt and rethrows a transient failure for redelivery', async () => {
    const { db } = await bookAt24();
    const { deps } = liveWindow(48);
    const contended = {
      collection: db.collection.bind(db),
      runTransaction: () => Promise.reject({ code: 10 }),
    } as unknown as Firestore;
    await expect(
      startPolicyRecompute(
        settingsEvent('evt-a', NOW - 2_000, 24, 48),
        contended,
        deps(),
      ),
    ).rejects.toEqual({ code: 10 });
    expect(vi.mocked(logger.error).mock.calls[0]?.[1]).toEqual({
      fn: 'recomputeClientStatsOnPolicyChange',
      eventId: 'evt-a',
      outcome: 'transient',
      code: 'aborted',
      ageMs: 2_000,
    });
  });
});

describe('continuePolicyRecompute — the live window judges what was stored before the stamp (§11.2 #11)', () => {
  beforeEach(() => vi.mocked(logger.error).mockClear());

  it('re-judges EVERY stored client, not only the next one written', async () => {
    const { db, docs, late } = await bookAt24();
    const { deps } = liveWindow(48);
    await startPolicyRecompute(
      settingsEvent('evt-a', NOW - 5_000, 24, 48),
      db,
      deps(),
    );

    // The owner widened the window to 48 h: both 30 h cancels are late now,
    // for both clients alike. With budget to spare, one step takes every
    // page.
    expect(await drain(db, docs, deps({ pageSize: 1 }))).toEqual(['finished']);
    expect([late('ana'), late('bob')]).toEqual([1, 1]);
    expect(jobOf(docs)).toMatchObject({
      cursor: 'bob',
      storedClients: 2,
      recomputed: 2,
      failed: 0,
      finishedAt: new Date(NOW).toISOString(),
    });
    // A finished pass rests: its own last write fires one more idle step.
    expect(await continuePolicyRecompute(jobEvent(docs), db, deps())).toBe(
      'idle',
    );
  });

  it('re-judges only what was stored before the stamp: a stamped cancel keeps its verdict', async () => {
    // Carol cancelled 30 h ahead under a 24 h window, and Dan 3 h ahead
    // under it — both stamped. Ana's and Bob's rows predate the stamp.
    const fixture = createProjectionFirestore({
      'appointments/a1': cancelledAhead('a1', 'ana', 30),
      'appointments/b1': cancelledAhead('b1', 'bob', 30),
      'appointments/c1': cancelledAhead('c1', 'carol', 30, 24),
      'appointments/d1': cancelledAhead('d1', 'dan', 3, 24),
    });
    const db = fixture.db as unknown as Firestore;
    const at24 = { policy: policy(24), clockMs: () => NOW };
    for (const uid of ['ana', 'bob', 'carol', 'dan']) {
      await recomputeClientStats(db, uid, at24);
    }
    const late = (uid: string) =>
      clientStatsFromDocument(uid, fixture.docs.get(`clientStats/${uid}`))
        ?.lifetime.lateCancels;
    expect(['ana', 'bob', 'carol', 'dan'].map(late)).toEqual([0, 0, 0, 1]);

    // Widened to 48 h: the unstamped cancels move, the stamped ones do not.
    const wide = liveWindow(48);
    await startPolicyRecompute(
      settingsEvent('evt-a', NOW - 5_000, 24, 48),
      db,
      wide.deps(),
    );
    expect(await drain(db, fixture.docs, wide.deps())).toEqual(['finished']);
    expect(['ana', 'bob', 'carol', 'dan'].map(late)).toEqual([1, 1, 0, 1]);

    // Shortened to 2 h: Dan's real late cancel still stands.
    const narrow = liveWindow(2);
    await startPolicyRecompute(
      settingsEvent('evt-b', NOW - 1_000, 48, 2),
      db,
      narrow.deps(),
    );
    expect(await drain(db, fixture.docs, narrow.deps())).toEqual(['finished']);
    expect(['ana', 'bob', 'carol', 'dan'].map(late)).toEqual([0, 0, 0, 1]);
  });

  it('stops taking pages once a slow step spends its budget, and resumes from the cursor', async () => {
    const { db, docs, late } = await bookAt24();
    const { deps } = liveWindow(48);
    await startPolicyRecompute(
      settingsEvent('evt-a', NOW - 5_000, 24, 48),
      db,
      deps(),
    );
    const slow = deps({ pageSize: 1, startBudget: spentAfter(0) });

    expect(await continuePolicyRecompute(jobEvent(docs), db, slow)).toBe(
      'advanced',
    );
    // One page, then the budget was gone: Ana is on the new line, Bob is
    // next, and the job says so.
    expect([late('ana'), late('bob')]).toEqual([1, 0]);
    expect(jobOf(docs)).toMatchObject({
      cursor: 'ana',
      storedClients: 1,
      finishedAt: null,
    });

    expect(await drain(db, docs, slow)).toEqual(['advanced', 'finished']);
    expect([late('ana'), late('bob')]).toEqual([1, 1]);
  });

  it('lets a newer policy change supersede a running pass — the last word wins', async () => {
    const { db, docs, late } = await bookAt24();
    const { live, deps } = liveWindow(48);
    await startPolicyRecompute(
      settingsEvent('evt-a', NOW - 9_000, 24, 48),
      db,
      deps(),
    );
    const stepOfA = jobEvent(docs, 'evt-job-a');

    // Mid-step, the owner changes their mind back to 24 h: the step read
    // 48 h and re-judged under it, but may not advance a pass that is no
    // longer the job's.
    const racing = deps({
      loadPolicy: async () => {
        const read = policy(live.hours);
        live.hours = 24;
        await startPolicyRecompute(
          settingsEvent('evt-b', NOW - 1_000, 48, 24),
          db,
          deps(),
        );
        return read;
      },
    });
    expect(await continuePolicyRecompute(stepOfA, db, racing)).toBe(
      'superseded',
    );
    expect(jobOf(docs)).toMatchObject({ generation: 'evt-b', cursor: null });
    // A redelivery of A's step changes nothing either.
    expect(await continuePolicyRecompute(stepOfA, db, deps())).toBe(
      'superseded',
    );

    expect(await drain(db, docs, deps())).toEqual(['finished']);
    expect([late('ana'), late('bob')]).toEqual([0, 0]);
  });

  // A newer change lands BETWEEN two pages of a running step. Without a
  // look at the job before each page, the step went on under the policy it
  // had loaded until its budget ran out — and a new pass that overtook it
  // could find its old-line writes landing after its own.
  it('stops a superseded step before its next page: at most the page in hand is judged by the old line', async () => {
    const { db, docs, late } = await bookAt24();
    const { live, deps } = liveWindow(48);
    await startPolicyRecompute(
      settingsEvent('evt-a', NOW - 9_000, 24, 48),
      db,
      deps(),
    );
    const stepOfA = jobEvent(docs, 'evt-job-a');
    const between = beforeJobRead(db, 2, async () => {
      live.hours = 24;
      await startPolicyRecompute(
        settingsEvent('evt-b', NOW - 1_000, 48, 24),
        db,
        deps(),
      );
    });

    expect(
      await continuePolicyRecompute(stepOfA, between, deps({ pageSize: 1 })),
    ).toBe('superseded');
    // Ana's page was in hand under 48 h; Bob's never started under it.
    expect([late('ana'), late('bob')]).toEqual([1, 0]);
    expect(jobOf(docs)).toMatchObject({ generation: 'evt-b', cursor: null });

    expect(await drain(db, docs, deps())).toEqual(['finished']);
    expect([late('ana'), late('bob')]).toEqual([0, 0]);
  });

  it('keeps the last word when the newer pass overtakes a running step between its pages', async () => {
    const { db, docs, late } = await bookAt24();
    const { live, deps } = liveWindow(48);
    await startPolicyRecompute(
      settingsEvent('evt-a', NOW - 9_000, 24, 48),
      db,
      deps(),
    );
    const stepOfA = jobEvent(docs, 'evt-job-a');
    const newer: PolicyStepOutcome[] = [];
    const overtaken = beforeJobRead(db, 2, async () => {
      live.hours = 24;
      await startPolicyRecompute(
        settingsEvent('evt-b', NOW - 1_000, 48, 24),
        db,
        deps(),
      );
      // The new pass runs to its end while A's step sits between pages.
      newer.push(...(await drain(db, docs, deps())));
    });

    expect(
      await continuePolicyRecompute(stepOfA, overtaken, deps({ pageSize: 1 })),
    ).toBe('superseded');
    expect(newer).toEqual(['finished']);
    // A's step wrote nothing after the new pass: both clients stay on 24 h.
    expect([late('ana'), late('bob')]).toEqual([0, 0]);
    expect(jobOf(docs)).toMatchObject({ generation: 'evt-b' });
    expect(jobOf(docs)?.finishedAt).not.toBeNull();
  });

  // The window the between-pages look cannot close: the newer pass reaches
  // the very clients the old step has IN HAND. Its answers must stand — the
  // old step's writes for them, judged by the old line, land after and are
  // refused by the stamp the newer pass left (round 3, 2026-09-25).
  it('keeps the last word when the newer pass judges the page the old step has in hand', async () => {
    const { db, docs, late } = await bookAt24();
    const { live, deps } = liveWindow(48);
    await startPolicyRecompute(
      settingsEvent('evt-a', NOW - 9_000, 24, 48),
      db,
      deps(),
    );
    const stepOfA = jobEvent(docs, 'evt-job-a');
    const newer: PolicyStepOutcome[] = [];
    // A's step has read the job, loaded 48 h and fetched its page; before
    // the first client of that page is written, the owner moves the line
    // back to 24 h and the new pass runs to its end.
    const midPage = beforeTransaction(db, 1, async () => {
      live.hours = 24;
      await startPolicyRecompute(
        settingsEvent('evt-b', NOW - 1_000, 48, 24),
        db,
        deps(),
      );
      newer.push(...(await drain(db, docs, deps())));
    });

    expect(await continuePolicyRecompute(stepOfA, midPage, deps())).toBe(
      'superseded',
    );
    expect(newer).toEqual(['finished']);
    // Both clients stay on the newer line: A's page, judged by 48 h, wrote
    // nothing over the answers evt-b's pass stamped.
    expect([late('ana'), late('bob')]).toEqual([0, 0]);
    for (const uid of ['ana', 'bob']) {
      expect(policyPassOf(docs.get(`clientStats/${uid}`))?.generation).toBe(
        'evt-b',
      );
    }
  });

  it('stamps every client a pass judges — an unchanged answer too — and the appointment trigger carries the stamp forward', async () => {
    const { db, docs } = await bookAt24();
    const { deps } = liveWindow(24);
    // A pass whose line changes nobody's answer still leaves its mark.
    await startPolicyRecompute(
      settingsEvent('evt-a', NOW - 9_000, 12, 24),
      db,
      deps(),
    );
    expect(await drain(db, docs, deps())).toEqual(['finished']);
    expect(jobOf(docs)?.recomputed).toBe(0);
    expect(policyPassOf(docs.get('clientStats/ana'))).toEqual({
      generation: 'evt-a',
      changedAt: new Date(NOW - 9_000).toISOString(),
    });

    // A writer that is not a pass keeps it: a new visit re-judges Ana.
    docs.set('appointments/a2', cancelledAhead('a2', 'ana', 2));
    expect(
      await recomputeClientStats(db, 'ana', {
        policy: policy(24),
        clockMs: () => NOW,
      }),
    ).toBe('written');
    expect(policyPassOf(docs.get('clientStats/ana'))?.generation).toBe('evt-a');
  });

  it('records a permanent stall on the job — stalled, not slow — and rests on that write', async () => {
    const { db, docs } = await bookAt24();
    const { deps } = liveWindow(48);
    await startPolicyRecompute(
      settingsEvent('evt-a', NOW - 5_000, 24, 48),
      db,
      deps(),
    );
    const started = jobOf(docs);
    const broken = deps({
      clockMs: () => NOW + 7_000,
      loadPolicy: () => Promise.reject({ code: 13 }),
    });

    expect(await continuePolicyRecompute(jobEvent(docs), db, broken)).toBe(
      'stalled',
    );
    expect(jobOf(docs)).toEqual({
      ...started,
      stalledAt: new Date(NOW + 7_000).toISOString(),
      lastFailureCode: 'internal',
    });
    expect(vi.mocked(logger.error).mock.calls[0]?.[1]).toEqual({
      fn: 'continueClientStatsPolicyRecompute',
      eventId: 'evt-job',
      outcome: 'permanent',
      code: 'internal',
      ageMs: 8_000,
    });

    // The record's own write fires a delivery, which rests…
    const recorded = docs.get(JOB);
    expect(
      await continuePolicyRecompute(jobEvent(docs, 'evt-stall'), db, deps()),
    ).toBe('idle');
    // …and a stale delivery of the stalled step, failing the same way,
    // does not rewrite the record.
    expect(
      await continuePolicyRecompute(
        {
          id: 'evt-job',
          time: new Date(NOW).toISOString(),
          data: {
            after: {
              data: () => policyJobToDocument(started as PolicyRecomputeJob),
            },
          },
        },
        db,
        broken,
      ),
    ).toBe('stalled');
    expect(docs.get(JOB)).toBe(recorded);
  });

  it('records a stall when the advance itself fails permanently, and rethrows a transient one', async () => {
    const { db, docs, late } = await bookAt24();
    const { deps } = liveWindow(48);
    await startPolicyRecompute(
      settingsEvent('evt-a', NOW - 5_000, 24, 48),
      db,
      deps(),
    );
    // Transactions 1 and 2 recompute Ana and Bob; the 3rd is the advance.
    await expect(
      continuePolicyRecompute(
        jobEvent(docs),
        failingTransaction(db, 3, { code: 10 }),
        deps(),
      ),
    ).rejects.toEqual({ code: 10 });
    expect(jobOf(docs)).toMatchObject({ cursor: null, stalledAt: null });

    expect(
      await continuePolicyRecompute(
        jobEvent(docs),
        failingTransaction(db, 3, { code: 13 }),
        deps(),
      ),
    ).toBe('stalled');
    // The recomputes landed; the cursor did not move, and the job says why.
    expect([late('ana'), late('bob')]).toEqual([1, 1]);
    expect(jobOf(docs)).toMatchObject({
      cursor: null,
      finishedAt: null,
      stalledAt: new Date(NOW).toISOString(),
      lastFailureCode: 'internal',
    });
  });

  it('advances once however often the same step is delivered', async () => {
    const { db, docs } = await bookAt24();
    const { deps } = liveWindow(48);
    await startPolicyRecompute(
      settingsEvent('evt-a', NOW - 5_000, 24, 48),
      db,
      deps(),
    );
    const once = jobEvent(docs);
    const step = deps({ pageSize: 1, startBudget: spentAfter(0) });
    expect(await continuePolicyRecompute(once, db, step)).toBe('advanced');
    expect(await continuePolicyRecompute(once, db, step)).toBe('superseded');
    expect(jobOf(docs)).toMatchObject({ cursor: 'ana', storedClients: 1 });
  });

  it('rethrows a transient failure with no page finished, and keeps the cursor', async () => {
    const { db, docs, late, failHistoryOf } = await bookAt24();
    const { deps } = liveWindow(48);
    await startPolicyRecompute(
      settingsEvent('evt-a', NOW - 5_000, 24, 48),
      db,
      deps(),
    );
    failHistoryOf('ana', { code: 14 });
    await expect(
      continuePolicyRecompute(jobEvent(docs), db, deps()),
    ).rejects.toEqual({ code: 14 });
    // Bob's recompute stood on its own; the page is retried whole.
    expect(late('bob')).toBe(1);
    expect(jobOf(docs)).toMatchObject({ cursor: null, finishedAt: null });
    expect(vi.mocked(logger.error).mock.calls[0]?.[1]).toEqual({
      fn: 'continueClientStatsPolicyRecompute',
      eventId: 'evt-job',
      outcome: 'transient',
      code: 'unavailable',
      ageMs: 1_000,
    });
  });

  it('counts a permanent failure and walks on, leaving it to the backfill', async () => {
    const { db, docs, late, failHistoryOf } = await bookAt24();
    const { deps } = liveWindow(48);
    await startPolicyRecompute(
      settingsEvent('evt-a', NOW - 5_000, 24, 48),
      db,
      deps(),
    );
    failHistoryOf('ana', { code: 7 });
    expect(await drain(db, docs, deps())).toEqual(['finished']);
    expect(late('bob')).toBe(1);
    expect(jobOf(docs)).toMatchObject({ failed: 1, storedClients: 2 });
    expect(vi.mocked(logger.error).mock.calls[0]?.[1]).toMatchObject({
      fn: 'continueClientStatsPolicyRecompute',
      outcome: 'permanent',
      code: 'permission-denied',
    });
  });

  it('does nothing for a deleted or unreadable job', async () => {
    const { db } = await bookAt24();
    const { deps } = liveWindow(48);
    const none: PolicyJobWriteEvent = {
      id: 'evt-job',
      time: new Date(NOW).toISOString(),
      data: { after: { data: () => undefined } },
    };
    expect(await continuePolicyRecompute(none, db, deps())).toBe('idle');
  });
});

describe('sweepPolicyRecompute — the daily nudge for a pass that stopped moving', () => {
  beforeEach(() => {
    vi.mocked(logger.error).mockClear();
    vi.mocked(logger.info).mockClear();
    vi.mocked(logger.warn).mockClear();
  });
  const run = (atMs: number) => ({
    id: 'sweep@run',
    time: new Date(atMs).toISOString(),
  });
  /**
   * The sweep at `atMs`, reading `line` off the policy document — by
   * default the one evt-a wrote (48 h, at NOW − 5 s), the change every pass
   * below answers, so no start is owed.
   */
  const sweepAt = (
    atMs: number,
    line: LivePolicyLine = lineAt(48, NOW - 5_000),
  ) => ({ clockMs: () => atMs, readPolicyLine: async () => line });

  /** A pass one step in, whose next step's deliveries all ran out. */
  async function abandonedPass() {
    const book = await bookAt24();
    const { deps } = liveWindow(48);
    await startPolicyRecompute(
      settingsEvent('evt-a', NOW - 5_000, 24, 48),
      book.db,
      deps(),
    );
    await continuePolicyRecompute(
      jobEvent(book.docs),
      book.db,
      deps({ pageSize: 1, startBudget: spentAfter(0) }),
    );
    return { ...book, deps };
  }

  it('nudges an unfinished pass that has not moved for an hour, and the fired step carries it on', async () => {
    const { db, docs, late, deps, writes } = await abandonedPass();
    const before = jobOf(docs);
    expect(before).toMatchObject({ cursor: 'ana', finishedAt: null });
    expect(
      await sweepPolicyRecompute(
        run(NOW + 30 * 60_000),
        db,
        sweepAt(NOW + 30 * 60_000),
      ),
    ).toBe('idle');

    const later = NOW + HOUR;
    expect(await sweepPolicyRecompute(run(later), db, sweepAt(later))).toBe(
      'nudged',
    );
    expect(jobOf(docs)).toEqual({
      ...before,
      updatedAt: new Date(later).toISOString(),
    });
    expect(vi.mocked(logger.info).mock.calls[0]?.[1]).toEqual({
      generation: 'evt-a',
      cursor: 'ana',
      lastFailureCode: null,
    });
    // Idempotent: the second sweep in the hour finds it fresh.
    const jobWrites = writes.filter((path) => path === JOB).length;
    expect(await sweepPolicyRecompute(run(later), db, sweepAt(later))).toBe(
      'idle',
    );
    expect(writes.filter((path) => path === JOB)).toHaveLength(jobWrites);

    expect(await drain(db, docs, deps())).toEqual(['finished']);
    expect([late('ana'), late('bob')]).toEqual([1, 1]);
  });

  it('retries a stalled pass once a day, and the step that moves it clears the stall', async () => {
    const { db, docs, late, deps } = await abandonedPass();
    const broken = deps({ loadPolicy: () => Promise.reject({ code: 13 }) });
    expect(await continuePolicyRecompute(jobEvent(docs), db, broken)).toBe(
      'stalled',
    );
    expect(jobOf(docs)?.stalledAt).not.toBeNull();

    const nextDay = NOW + DAY;
    expect(await sweepPolicyRecompute(run(nextDay), db, sweepAt(nextDay))).toBe(
      'nudged',
    );
    expect(jobOf(docs)).toMatchObject({
      stalledAt: null,
      lastFailureCode: 'internal',
    });
    expect(await drain(db, docs, deps())).toEqual(['finished']);
    expect(jobOf(docs)).toMatchObject({
      stalledAt: null,
      lastFailureCode: null,
    });
    expect([late('ana'), late('bob')]).toEqual([1, 1]);
  });

  it('leaves no job and a finished one alone', async () => {
    const { db, docs } = await bookAt24();
    const { deps } = liveWindow(48);
    // No job, and a policy at the default window: nothing was ever moved.
    expect(
      await sweepPolicyRecompute(run(NOW), db, sweepAt(NOW, lineAt(24, null))),
    ).toBe('idle');
    await startPolicyRecompute(
      settingsEvent('evt-a', NOW - 5_000, 24, 48),
      db,
      deps(),
    );
    await drain(db, docs, deps());
    const later = NOW + DAY;
    expect(await sweepPolicyRecompute(run(later), db, sweepAt(later))).toBe(
      'idle',
    );
  });

  // A start that failed for good left the job on the previous change's
  // pass, finished — and before round 3 nothing would ever notice.
  it('starts the pass a dropped start owed: the policy is newer than the job and draws another line', async () => {
    const { db, docs, late } = await bookAt24();
    const { live, deps } = liveWindow(48);
    await startPolicyRecompute(
      settingsEvent('evt-a', NOW - 9_000, 24, 48),
      db,
      deps(),
    );
    await drain(db, docs, deps());
    expect([late('ana'), late('bob')]).toEqual([1, 1]);

    // The owner moves the line back to 24 h; the start is dropped.
    live.hours = 24;
    const broken = failingTransaction(db, 1, { code: 13 });
    expect(
      await startPolicyRecompute(
        settingsEvent('evt-b', NOW - 1_000, 48, 24),
        broken,
        deps(),
      ),
    ).toBe('dropped');
    expect(jobOf(docs)).toMatchObject({ generation: 'evt-a', windowHours: 48 });

    const nextNight = NOW + DAY;
    const line = lineAt(24, NOW - 1_000);
    expect(
      await sweepPolicyRecompute(run(nextNight), db, sweepAt(nextNight, line)),
    ).toBe('started');
    expect(jobOf(docs)).toMatchObject({
      generation: `sweep:${line.updatedAt}`,
      changedAt: line.updatedAt,
      windowHours: 24,
      cursor: null,
      finishedAt: null,
    });
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      'policy recompute started by the sweep: a dropped start',
      expect.objectContaining({ windowHours: 24 }),
    );

    // Its write fires the steps like any start, and the book follows.
    expect(await drain(db, docs, deps())).toEqual(['finished']);
    expect([late('ana'), late('bob')]).toEqual([0, 0]);
    // The next night finds the job answering the document: nothing owed.
    expect(
      await sweepPolicyRecompute(
        run(nextNight + DAY),
        db,
        sweepAt(nextNight + DAY, line),
      ),
    ).toBe('idle');
  });

  it('owes nothing for a newer policy that moved no line — a horizon edit is not a walk over the book', async () => {
    const { db, docs, writes } = await bookAt24();
    const { deps } = liveWindow(48);
    await startPolicyRecompute(
      settingsEvent('evt-a', NOW - 9_000, 24, 48),
      db,
      deps(),
    );
    await drain(db, docs, deps());
    const jobWrites = writes.filter((path) => path === JOB).length;
    const later = NOW + DAY;
    expect(
      await sweepPolicyRecompute(
        run(later),
        db,
        sweepAt(later, lineAt(48, NOW - 1_000)),
      ),
    ).toBe('idle');
    expect(writes.filter((path) => path === JOB)).toHaveLength(jobWrites);
  });

  it('owes the first change a pass when there is no job and the window left the default', async () => {
    const { db, docs, late } = await bookAt24();
    const { deps } = liveWindow(48);
    expect(
      await sweepPolicyRecompute(
        run(NOW),
        db,
        sweepAt(NOW, lineAt(48, NOW - 1_000)),
      ),
    ).toBe('started');
    expect(await drain(db, docs, deps())).toEqual(['finished']);
    expect([late('ana'), late('bob')]).toEqual([1, 1]);
  });

  it('fails the sweep through the attempt line when the policy cannot be read', async () => {
    const { db, docs } = await bookAt24();
    const unreadable = {
      clockMs: () => NOW,
      readPolicyLine: () => Promise.reject({ code: 13 }),
    };
    expect(await sweepPolicyRecompute(run(NOW - 3_000), db, unreadable)).toBe(
      'failed',
    );
    expect(docs.has(JOB)).toBe(false);
    expect(vi.mocked(logger.error).mock.calls[0]?.[1]).toMatchObject({
      fn: 'sweepClientStatsPolicyDaily',
      outcome: 'permanent',
    });
  });

  it('logs the attempt line, rethrowing a transient failure for the scheduler’s retry', async () => {
    const { db } = await bookAt24();
    const failing = (code: number) =>
      ({
        collection: db.collection.bind(db),
        runTransaction: () => Promise.reject({ code }),
      }) as unknown as Firestore;
    await expect(
      sweepPolicyRecompute(run(NOW - 3_000), failing(14), sweepAt(NOW)),
    ).rejects.toEqual({ code: 14 });
    expect(vi.mocked(logger.error).mock.calls[0]?.[1]).toEqual({
      fn: 'sweepClientStatsPolicyDaily',
      eventId: 'sweep@run',
      outcome: 'transient',
      code: 'unavailable',
      ageMs: 3_000,
    });
    expect(
      await sweepPolicyRecompute(run(NOW), failing(13), sweepAt(NOW)),
    ).toBe('failed');
  });
});

describe('the deployed triggers', () => {
  it('sweep once a day at night, retrying', () => {
    expect(sweepClientStatsPolicyDaily.__endpoint).toMatchObject({
      scheduleTrigger: {
        schedule: 'every day 03:30',
        timeZone: 'Europe/Sofia',
        retryConfig: { retryCount: 3 },
      },
    });
  });

  it('start on settings writes, and step on the job document, retrying, inside a budgeted timeout', () => {
    expect(recomputeClientStatsOnPolicyChange.__endpoint).toMatchObject({
      eventTrigger: {
        eventFilterPathPatterns: { document: 'settings/{docId}' },
        retry: true,
      },
    });
    // A path with no wildcard is an exact event filter, not a pattern.
    expect(continueClientStatsPolicyRecompute.__endpoint).toMatchObject({
      timeoutSeconds: 540,
      eventTrigger: {
        eventFilters: { document: 'backfillJobs/clientStatsPolicy' },
        retry: true,
      },
    });
  });
});
