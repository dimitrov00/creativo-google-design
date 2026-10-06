import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { Money, ZonedDateTime } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import { BarberId, ServiceId, ServiceTerms } from '@creativo/domain/catalog';
import { Actor } from '@creativo/domain/governance';
import {
  Appointment,
  BarberPref,
  ClientStatsPolicy,
  COMPLETED,
  Seat,
  SeatId,
  SeatSubject,
  seatNoShow,
  seatWorked,
} from '@creativo/domain/scheduling';
import {
  type PersistedDocument,
  appointmentToDocument,
  clientStatsFromDocument,
} from '@creativo/application/booking';
import { createProjectionFirestore } from '../../test-support/fake-projection-firestore';
import type { BackfillJob } from './backfill-plan';
import {
  type BackfillDeps,
  RUN_BACKFILL_BUDGET_MS,
  RUN_BACKFILL_TIMEOUT_SECONDS,
  backfillWithAudit,
  runBackfill,
  runBackfillPage,
} from './run-backfill';
import { UNBOUNDED_BUDGET, type WorkBudget } from './work-budget';
import type { AuditInput } from '../booking/audit';

vi.mock('firebase-functions', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const NOW = Date.parse('2026-09-25T08:00:00.000Z');
const ZONE = 'Europe/Sofia';
const DAY = 86_400_000;

function must<T>(result: { isFailure(): boolean; value?: T }): T {
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value as T;
}

function at(ms: number): ZonedDateTime {
  return must<ZonedDateTime>(ZonedDateTime.fromMillis(ms, ZONE));
}

type Who = 'ana' | 'bob';

/** A settled visit: each listed person's seat, worked or not. */
function visit(
  id: string,
  startMs: number,
  people: readonly (readonly [Who, 'worked' | 'no_show'])[],
  chair: { readonly barber?: string; readonly pref?: 'specific' } = {},
): Appointment {
  return must<Appointment>(
    Appointment.reconstitute({
      id,
      locationId: 'shop-1',
      seats: people.map(([who, outcome], index) =>
        Seat.of({
          id: must<SeatId>(SeatId.create(`${id}-${who}`)),
          subject: SeatSubject.account(
            must<UserId>(UserId.create(who)),
            index === 0 ? 'self' : 'companion',
          ),
          serviceId: must<ServiceId>(ServiceId.create('cut')),
          variantId: null,
          barberId: must<BarberId>(
            BarberId.create(chair.barber ?? `barber-${index}`),
          ),
          pref:
            chair.pref === 'specific'
              ? BarberPref.specific(
                  must<BarberId>(
                    BarberId.create(chair.barber ?? `barber-${index}`),
                  ),
                )
              : null,
          terms: must<ServiceTerms>(
            ServiceTerms.create(
              must<Money>(Money.fromMinorUnitsAndCode(2500, 'EUR')),
              30,
            ),
          ),
          startsAt: at(startMs),
          outcome:
            outcome === 'worked'
              ? seatWorked(startMs + 1_800_000)
              : seatNoShow(startMs + 600_000),
        }),
      ),
      status: COMPLETED,
      bookedAt: at(startMs - DAY),
    }),
  );
}

/** As the commit path writes it, placement stamped. */
const stored = (appointment: Appointment): PersistedDocument =>
  appointmentToDocument(appointment, { placement: 'self' });

/** As a row written before the R33 mirrors: neither subjects nor placement. */
function legacy(appointment: Appointment): PersistedDocument {
  const doc = { ...appointmentToDocument(appointment) };
  delete doc['subjectUserIds'];
  delete doc['placement'];
  return doc;
}

const deps = (overrides: Partial<BackfillDeps> = {}): BackfillDeps => ({
  clockMs: () => NOW,
  loadPolicy: async () => ClientStatsPolicy.default(),
  pageSize: 5,
  chunkSize: 5,
  sampleSize: 20,
  // A documentId filter refuses an empty id; '0' sorts before every uid.
  samplePivot: () => '0',
  startBudget: () => UNBOUNDED_BUDGET,
  ...overrides,
});

/**
 * A slow run, without waiting: the budget is spent after `checks` looks —
 * each look is the walk asking whether it may take one more chunk (or the
 * closing sample).
 */
const spentAfter = (checks: number) => (): WorkBudget => {
  let looks = 0;
  return { spent: () => ++looks > checks };
};

/** A whole run, call after call, the way a runner loops it. */
async function runToEnd(
  db: Firestore,
  job: BackfillJob,
  options: Partial<BackfillDeps> = {},
) {
  let result = await runBackfillPage(db, { job, cursor: null }, deps(options));
  const cursors = [result.cursor];
  while (!result.done) {
    result = await runBackfillPage(
      db,
      { job, cursor: result.cursor },
      deps(options),
    );
    cursors.push(result.cursor);
    if (cursors.length > 50) throw new Error('backfill did not finish');
  }
  return { result, cursors };
}

/** The audit writer, recording its rows. */
const auditSpy = () =>
  vi.fn<(row: AuditInput) => Promise<void>>(async () => undefined);

const statsOf = (docs: Map<string, PersistedDocument>, uid: string) =>
  clientStatsFromDocument(uid, docs.get(`clientStats/${uid}`));

describe('runBackfillPage — the stored clients (§12.4 P0 repair)', () => {
  it('repairs a client no appointment names any more', async () => {
    const party = visit('a1', NOW - 3 * DAY, [
      ['ana', 'worked'],
      ['bob', 'no_show'],
    ]);
    const { db, docs } = createProjectionFirestore({
      'appointments/a1': stored(party),
    });
    const asDb = db as unknown as Firestore;
    await runToEnd(asDb, 'clientStats');
    expect(statsOf(docs, 'bob')?.lifetime.noShows).toBe(1);

    // Bob is taken off the party, and the trigger's event for it is lost:
    // his stored document is the only place he still appears.
    docs.set(
      'appointments/a1',
      stored(visit('a1', NOW - 3 * DAY, [['ana', 'worked']])),
    );
    const { result } = await runToEnd(asDb, 'clientStats');

    const bob = statsOf(docs, 'bob');
    expect(bob?.lifetime.noShows).toBe(0);
    expect(bob?.last365.noShows).toEqual([]);
    expect(result.sample).toEqual({ checked: 2, mismatched: [] });
  });

  it('walks the appointments, then the stored clients, before it is done', async () => {
    const { db } = createProjectionFirestore({
      'appointments/a1': stored(
        visit('a1', NOW - 9 * DAY, [['ana', 'worked']]),
      ),
      'appointments/a2': stored(
        visit('a2', NOW - 3 * DAY, [['bob', 'worked']]),
      ),
    });
    const { result, cursors } = await runToEnd(
      db as unknown as Firestore,
      'clientStats',
      { pageSize: 1 },
    );
    expect(cursors).toEqual(['a1', 'a2', '~', '~ana', '~bob', null]);
    expect(result).toMatchObject({ done: true, total: 2 });
  });

  it('ends the mirror job with the appointments', async () => {
    const { db } = createProjectionFirestore({
      'appointments/a1': stored(
        visit('a1', NOW - 9 * DAY, [['ana', 'worked']]),
      ),
    });
    const { result, cursors } = await runToEnd(
      db as unknown as Firestore,
      'subjectMirror',
    );
    expect(cursors).toEqual([null]);
    expect(result).toMatchObject({
      done: true,
      storedClients: 0,
      sample: null,
    });
  });
});

describe('runBackfillPage — placement comes from the audit trail alone (§12.5.1)', () => {
  it('records what a commit row says as an inference, and a legacy row without one', async () => {
    const { db, docs } = createProjectionFirestore({
      'appointments/x1': legacy(
        visit('x1', NOW - 9 * DAY, [['ana', 'worked']]),
      ),
      'appointments/x2': legacy(
        visit('x2', NOW - 6 * DAY, [['ana', 'worked']]),
      ),
      'auditLog/row-1': { action: 'booking.committed', resourceId: 'x1' },
    });
    const asDb = db as unknown as Firestore;
    const first = await runToEnd(asDb, 'subjectMirror');

    expect(first.result.stamped).toBe(2);
    expect(docs.get('appointments/x1')?.['inferredPlacement']).toBe('self');
    // Never the commit's own stamp: that is what vouches for the seats.
    expect(docs.get('appointments/x1')?.['placement']).toBeUndefined();
    // Owned, but no audit row: an import, which must not read as the
    // client's own booking.
    expect(docs.get('appointments/x2')?.['inferredPlacement']).toBeUndefined();
    expect(docs.get('appointments/x2')?.['subjectUserIds']).toEqual(['ana']);

    const second = await runToEnd(asDb, 'subjectMirror');
    expect(second.result.stamped).toBe(0);
  });

  // The legacyPref defect: the pre-P0 commit stored an omitted preference as
  // `specific`, so three phone bookings into whichever chair was free read
  // as «asks for Ivan» once the backfill stamped their placement.
  it('never turns a pre-P0 phone booking’s defaulted preference into a preferred barber', async () => {
    const phoned = (id: string, days: number) =>
      legacy(
        visit(id, NOW - days * DAY, [['ana', 'worked']], {
          barber: 'ivan',
          pref: 'specific',
        }),
      );
    const { db, docs, writes } = createProjectionFirestore({
      'appointments/p1': phoned('p1', 90),
      'appointments/p2': phoned('p2', 60),
      'appointments/p3': phoned('p3', 30),
      'auditLog/r1': { action: 'booking.staff_created', resourceId: 'p1' },
      'auditLog/r2': { action: 'booking.staff_created', resourceId: 'p2' },
      'auditLog/r3': { action: 'booking.staff_created', resourceId: 'p3' },
    });
    const asDb = db as unknown as Firestore;
    const first = await runToEnd(asDb, 'clientStats');

    for (const id of ['p1', 'p2', 'p3']) {
      expect(docs.get(`appointments/${id}`)?.['inferredPlacement']).toBe(
        'staff',
      );
      expect(docs.get(`appointments/${id}`)?.['placement']).toBeUndefined();
    }
    const ana = statsOf(docs, 'ana');
    expect(ana?.lifetime.visitsCompleted).toBe(3);
    expect(ana?.preferredBarberId).toBeNull();
    expect(first.result.sample).toEqual({ checked: 1, mismatched: [] });

    // The double backfill: nothing left to stamp, nothing to recompute —
    // the only write is the job's own progress document.
    const before = writes.length;
    const second = await runToEnd(asDb, 'clientStats');
    expect(second.result).toMatchObject({ stamped: 0, recomputed: 0 });
    expect(
      writes.slice(before).filter((path) => !path.startsWith('backfillJobs/')),
    ).toEqual([]);
  });

  it('still names the barber the P0 commit recorded a request for', async () => {
    const asked = (id: string, days: number) =>
      appointmentToDocument(
        visit(id, NOW - days * DAY, [['ana', 'worked']], {
          barber: 'ivan',
          pref: 'specific',
        }),
        { placement: 'staff' },
      );
    const { db, docs } = createProjectionFirestore({
      'appointments/n1': asked('n1', 20),
      'appointments/n2': asked('n2', 10),
    });
    await runToEnd(db as unknown as Firestore, 'clientStats');
    expect(statsOf(docs, 'ana')?.preferredBarberId?.value).toBe('ivan');
  });
});

describe('runBackfillPage — bounded by its own budget, never by the timeout', () => {
  const sysadmin = Actor.staff(must<UserId>(UserId.create('vendor-1')), [
    'sysadmin',
  ]);

  /** Five of Ana's visits and two of Bob's, as the commit wrote them. */
  const book = () =>
    createProjectionFirestore(
      Object.fromEntries(
        [
          ['a1', 'ana'],
          ['a2', 'ana'],
          ['a3', 'bob'],
          ['a4', 'ana'],
          ['a5', 'bob'],
          ['a6', 'ana'],
          ['a7', 'ana'],
        ].map(([id, who], index) => [
          `appointments/${id}`,
          stored(
            visit(id as string, NOW - (20 - index) * DAY, [
              [who as Who, 'worked'],
            ]),
          ),
        ]),
      ),
    );

  it('stops taking chunks once the budget is spent: partial, with a cursor, audited', async () => {
    const { db, docs } = book();
    const audit = auditSpy();
    // One chunk of two, then the budget is gone.
    const result = await backfillWithAudit(
      db as unknown as Firestore,
      { job: 'clientStats', cursor: null },
      sysadmin,
      deps({ pageSize: 10, chunkSize: 2, startBudget: spentAfter(0) }),
      audit,
    );

    expect(result).toMatchObject({
      done: false,
      budgetSpent: true,
      cursor: 'a2',
      processed: 2,
      recomputed: 1,
    });
    // Ana was recomputed; Bob's visits lie past the cursor.
    expect(statsOf(docs, 'ana')?.lifetime.visitsCompleted).toBe(5);
    expect(docs.has('clientStats/bob')).toBe(false);
    // The progress document carries the cursor for a runner that lost it…
    expect(docs.get('backfillJobs/clientStats')).toMatchObject({
      cursor: 'a2',
      processed: 2,
      finishedAt: null,
    });
    // …and the call still leaves its one row, saying where it stopped.
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit.mock.calls[0]?.[0]?.context).toEqual({
      job: 'clientStats',
      outcome: 'partial',
      processed: '2',
      storedClients: '0',
      done: 'false',
      budgetSpent: 'true',
      cursor: 'a2',
    });
  });

  it('resumes from its progress document, and lands where an unhurried run does', async () => {
    const slow = book();
    const slowDb = slow.db as unknown as Firestore;
    const stingy = { pageSize: 10, chunkSize: 2, startBudget: spentAfter(1) };
    const calls = [];
    // No cursor after the first call: the progress document carries it.
    let result = await runBackfillPage(
      slowDb,
      { job: 'clientStats', cursor: null },
      deps(stingy),
    );
    calls.push(result);
    while (!result.done) {
      result = await runBackfillPage(
        slowDb,
        { job: 'clientStats' },
        deps(stingy),
      );
      calls.push(result);
      if (calls.length > 20) throw new Error('backfill did not finish');
    }
    // Two chunks a call: a1–a4, then a5–a7 (the page's end), then the two
    // stored clients and the sample.
    expect(calls.map((call) => call.cursor)).toEqual(['a4', '~', null]);
    expect(calls.map((call) => call.budgetSpent)).toEqual([true, false, false]);
    expect(result).toMatchObject({
      total: 7,
      sample: { checked: 2, mismatched: [] },
    });

    const fast = book();
    await runToEnd(fast.db as unknown as Firestore, 'clientStats', {
      pageSize: 10,
    });
    for (const uid of ['ana', 'bob']) {
      expect(slow.docs.get(`clientStats/${uid}`)).toEqual(
        fast.docs.get(`clientStats/${uid}`),
      );
    }
  });

  it('always takes the first chunk, so a spent budget still moves the walk', async () => {
    const { db } = book();
    const { result, cursors } = await runToEnd(
      db as unknown as Firestore,
      'subjectMirror',
      {
        pageSize: 10,
        chunkSize: 3,
        startBudget: () => ({ spent: () => true }),
      },
    );
    expect(cursors).toEqual(['a3', 'a6', null]);
    expect(result.done).toBe(true);
  });

  // The closing sample is new work: after a page it waits for the next
  // call, whose first (and only) unit it then is — never deferred twice.
  it('defers the sample past a spent budget, then takes it', async () => {
    const { db } = book();
    const { result, cursors } = await runToEnd(
      db as unknown as Firestore,
      'clientStats',
      {
        pageSize: 10,
        chunkSize: 3,
        startBudget: () => ({ spent: () => true }),
      },
    );
    expect(cursors).toEqual(['a3', 'a6', '~', '~bob', null]);
    expect(result).toMatchObject({
      done: true,
      budgetSpent: false,
      storedClients: 0,
      sample: { checked: 2, mismatched: [] },
    });
  });
});

describe('backfillWithAudit — one row per call, a failed one included', () => {
  const sysadmin = Actor.staff(must<UserId>(UserId.create('vendor-1')), [
    'sysadmin',
  ]);

  it('names the job and how the page went', async () => {
    const { db } = createProjectionFirestore({
      'appointments/a1': stored(
        visit('a1', NOW - 9 * DAY, [['ana', 'worked']]),
      ),
    });
    const audit = auditSpy();
    await backfillWithAudit(
      db as unknown as Firestore,
      { job: 'subjectMirror', cursor: null },
      sysadmin,
      deps(),
      audit,
    );
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit.mock.calls[0]?.[0]).toMatchObject({
      actor: sysadmin,
      action: 'ops.backfill',
      resourceId: 'backfillJobs/subjectMirror',
      context: {
        job: 'subjectMirror',
        outcome: 'complete',
        processed: '1',
        storedClients: '0',
        done: 'true',
        budgetSpent: 'false',
      },
    });
    expect(audit.mock.calls[0]?.[0]?.context).not.toHaveProperty('cursor');
  });

  it('says partial, and where to go on, when the page runs out first', async () => {
    const { db } = createProjectionFirestore({
      'appointments/a1': stored(
        visit('a1', NOW - 9 * DAY, [['ana', 'worked']]),
      ),
      'appointments/a2': stored(
        visit('a2', NOW - 8 * DAY, [['ana', 'worked']]),
      ),
    });
    const audit = auditSpy();
    const result = await backfillWithAudit(
      db as unknown as Firestore,
      { job: 'subjectMirror', cursor: null },
      sysadmin,
      deps({ pageSize: 1 }),
      audit,
    );
    expect(result).toMatchObject({ done: false, cursor: 'a1' });
    expect(audit.mock.calls[0]?.[0]?.context).toMatchObject({
      outcome: 'partial',
      done: 'false',
      budgetSpent: 'false',
      cursor: 'a1',
    });
  });

  it('keys a returned page as one change: a replayed call logs once, every other call on its own', async () => {
    const { db } = createProjectionFirestore(
      Object.fromEntries(
        ['a1', 'a2', 'a3'].map((id, index) => [
          `appointments/${id}`,
          stored(visit(id, NOW - (9 - index) * DAY, [['ana', 'worked']])),
        ]),
      ),
    );
    const audit = auditSpy();
    const other = Actor.staff(must<UserId>(UserId.create('vendor-2')), [
      'sysadmin',
    ]);
    const call = async (
      cursor: string | null | undefined,
      options: { readonly atMs?: number; readonly actor?: Actor } = {},
    ) => {
      const result = await backfillWithAudit(
        db as unknown as Firestore,
        cursor === undefined
          ? { job: 'subjectMirror' }
          : { job: 'subjectMirror', cursor },
        options.actor ?? sysadmin,
        deps({ pageSize: 1, clockMs: () => options.atMs ?? NOW }),
        audit,
      );
      return { result, key: audit.mock.calls.at(-1)?.[0]?.changeKey };
    };

    const first = await call(null);
    const second = await call('a1');
    // The runner lost the second answer and sends the same request again.
    const replay = await call('a1');
    const byOther = await call('a1', { actor: other });
    // …or lost its place, and resumes from the progress document.
    const resumed = await call(undefined);
    // A new run from the top, a moment later.
    const rerun = await call(null, { atMs: NOW + 1_000 });

    expect(first.result).toMatchObject({
      runStartedAt: new Date(NOW).toISOString(),
      startedFrom: null,
      cursor: 'a1',
    });
    expect(resumed.result).toMatchObject({ startedFrom: 'a2', cursor: 'a3' });
    expect(replay.key).toBe(second.key);
    const keys = [first, second, byOther, resumed, rerun].map((c) => c.key);
    expect(keys.every((key) => typeof key === 'string')).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('writes the row for a page that failed after writing, then rethrows', async () => {
    const { db, docs } = createProjectionFirestore({
      'appointments/x1': legacy(
        visit('x1', NOW - 9 * DAY, [['ana', 'worked']]),
      ),
    });
    const audit = auditSpy();
    const aborted = { code: 10 };

    await expect(
      backfillWithAudit(
        db as unknown as Firestore,
        { job: 'clientStats', cursor: null },
        sysadmin,
        deps({ loadPolicy: () => Promise.reject(aborted) }),
        audit,
      ),
    ).rejects.toBe(aborted);

    // The mirror was stamped before the stats step threw…
    expect(docs.get('appointments/x1')?.['subjectUserIds']).toEqual(['ana']);
    // …so the call still leaves its row, saying how it ended.
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit.mock.calls[0]?.[0]).toMatchObject({
      actor: sysadmin,
      action: 'ops.backfill',
      context: { job: 'clientStats', outcome: 'failed', code: 'aborted' },
    });
    // Every failed attempt may have committed part of its page: its own row.
    expect(audit.mock.calls[0]?.[0]).not.toHaveProperty('changeKey');
  });
});

describe('runBackfill — answers inside its callers’ wait', () => {
  // The Firebase callable SDK stops listening at 70 s by default, and
  // fetch (undici) at 300 s: a budget sized from the platform's 540 s
  // (378 s) outlasted both, and the caller gave up on a call still running.
  it('takes new work for 49 s, leaving 21 s of the SDK’s wait for the chunk in hand', () => {
    expect(RUN_BACKFILL_BUDGET_MS).toBe(49_000);
    expect(RUN_BACKFILL_BUDGET_MS).toBeLessThan(70_000);
  });

  it('keeps the long platform timeout as the reserve the call is never killed inside', () => {
    expect(RUN_BACKFILL_TIMEOUT_SECONDS).toBe(540);
    expect(runBackfill.__endpoint).toMatchObject({ timeoutSeconds: 540 });
  });
});
