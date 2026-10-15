import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import admin from 'firebase-admin';
import { type Firestore, Timestamp } from 'firebase-admin/firestore';
import { RepositoryError, Result } from '@core/primitives';
import { WriteOp } from '@core/components';
import { QueryOp } from '@core/entities';
import { firestoreCommitPlan } from './firestore-tx.adapter';

/**
 * The transaction adapter against the REAL Firestore emulator — the lane for
 * what an in-memory double cannot vouch for: the SDK's FieldPath grammar,
 * its ALREADY_EXISTS / NOT_FOUND commit failures and their messages, and
 * contention retries re-running read → decide.
 *
 * Emulator-only by construction, as every functions integration spec:
 * refuses to run without a local `FIRESTORE_EMULATOR_HOST`, and uses its own
 * demo project id, so wiping between tests cannot disturb seeded data.
 */
const PROJECT_ID = 'demo-functions-tx';

const EMULATOR_HOST = (process.env['FIRESTORE_EMULATOR_HOST'] ??=
  '127.0.0.1:8080');
if (!EMULATOR_HOST.includes('127.0.0.1')) {
  throw new Error('Refusing to run outside the local emulators.');
}

describe('firestore-tx adapter (emulator)', () => {
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
      `http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
      { method: 'DELETE' },
    );
  });

  const body = async (path: string) => (await db.doc(path).get()).data();

  it('applies Set, Create, root-field Update and Delete in one transaction', async () => {
    await db.doc('settings/x').set({ a: { b: 1, c: 2 }, keep: true });
    await db.doc('barberBusy/old').set({ blocks: [1] });

    const result = await firestoreCommitPlan(db)(
      async (tx) => tx.get<{ readonly id: string }>(['settings', 'x']),
      (settings) =>
        Result.ok({
          read: settings?.id ?? null,
          writes: [
            WriteOp.update(['settings', 'x'], {
              'a.b': 10,
              'odd/key*': 'literal',
            }),
            WriteOp.set(['barberBusy', 'new'], { blocks: [] }),
            WriteOp.create(['auditLog', 'row-1'], { action: 'x' }),
            WriteOp.remove(['barberBusy', 'old']),
          ],
        }),
    );

    expect(result).toEqual({ ok: true, value: { read: 'x' } });
    // Law 5: an Update key is ONE root field — `a.b` is a field named with
    // a dot, written beside the untouched `a` map, never a path into it.
    expect(await body('settings/x')).toEqual({
      a: { b: 1, c: 2 },
      'a.b': 10,
      'odd/key*': 'literal',
      keep: true,
    });
    expect(await body('barberBusy/new')).toEqual({ blocks: [] });
    expect(await body('auditLog/row-1')).toEqual({ action: 'x' });
    expect(await body('barberBusy/old')).toBeUndefined();
  });

  it('removes deleteFields at the root with FieldValue.delete() — a variant transition (Law 6)', async () => {
    await db.doc('appointments/a1').set({
      bookingStatus: 'CONFIRMED',
      confirmedAtUtcMs: 1,
      'a.b': 'literal',
      a: { b: 1 },
    });
    const result = await firestoreCommitPlan(db)(
      async () => null,
      () =>
        Result.ok({
          writes: [
            WriteOp.transition(
              ['appointments', 'a1'],
              { bookingStatus: 'CANCELLED', cancelledAtUtcMs: 2 },
              ['confirmedAtUtcMs', 'a.b'],
            ),
          ],
        }),
    );
    expect(result.ok).toBe(true);
    // `a.b` is ONE root field — deleting it leaves the nested map alone.
    expect(await body('appointments/a1')).toEqual({
      bookingStatus: 'CANCELLED',
      cancelledAtUtcMs: 2,
      a: { b: 1 },
    });
  });

  it('refuses a key both set and deleted as a value, applying nothing', async () => {
    await db.doc('appointments/a1').set({ n: 1 });
    const result = await firestoreCommitPlan(db)(
      async () => null,
      () =>
        Result.ok({
          writes: [
            WriteOp.set(['barberBusy', 'k'], { blocks: [] }),
            WriteOp.transition(['appointments', 'a1'], { n: 2 }, ['n']),
          ],
        }),
    );
    expect(result).toEqual({
      ok: false,
      error: RepositoryError.writeFailed(
        'appointments/a1',
        'field-set-and-deleted',
      ),
    });
    expect(await body('appointments/a1')).toEqual({ n: 1 });
    expect(await body('barberBusy/k')).toBeUndefined();
  });

  it('answers ALREADY_EXISTS as a value naming the document, and applies nothing', async () => {
    await db.doc('auditLog/taken').set({ action: 'first' });

    const result = await firestoreCommitPlan(db)(
      async () => null,
      () =>
        Result.ok({
          writes: [
            WriteOp.set(['barberBusy', 'k'], { blocks: [] }),
            WriteOp.create(['auditLog', 'fresh'], { action: 'new' }),
            WriteOp.create(['auditLog', 'taken'], { action: 'again' }),
          ],
        }),
    );

    expect(result).toEqual({
      ok: false,
      error: RepositoryError.alreadyExists('auditLog/taken'),
    });
    expect(await body('auditLog/taken')).toEqual({ action: 'first' });
    expect(await body('auditLog/fresh')).toBeUndefined();
    expect(await body('barberBusy/k')).toBeUndefined();
  });

  it('rejects an Update of an absent document (NOT_FOUND) and applies nothing', async () => {
    await expect(
      firestoreCommitPlan(db)(
        async () => null,
        () =>
          Result.ok({
            writes: [
              WriteOp.set(['barberBusy', 'k'], { blocks: [] }),
              WriteOp.update(['appointments', 'gone'], { revision: 2 }),
            ],
          }),
      ),
    ).rejects.toMatchObject({ code: 5 });
    expect(await body('barberBusy/k')).toBeUndefined();
  });

  it('reads a query as data — a root key, `in`, ordering and a limit', async () => {
    await Promise.all([
      db
        .doc('appointments/a1')
        .set({ bookingStatus: 'PENDING', utcEpochMs: 3 }),
      db
        .doc('appointments/a2')
        .set({ bookingStatus: 'CONFIRMED', utcEpochMs: 1 }),
      db
        .doc('appointments/a3')
        .set({ bookingStatus: 'CANCELLED', utcEpochMs: 2 }),
      db
        .doc('appointments/a5')
        .set({ bookingStatus: 'PENDING', utcEpochMs: 9 }),
    ]);
    const result = await firestoreCommitPlan(db)(
      (tx) =>
        tx.query<{ readonly id: string }>({
          collection: ['appointments'],
          where: [
            {
              field: 'bookingStatus',
              op: QueryOp.In,
              value: ['PENDING', 'CONFIRMED'],
            },
          ],
          orderBy: [{ field: 'utcEpochMs', descending: true }],
          limit: 2,
        }),
      (rows) => Result.ok({ ids: rows.map((row) => row.id), writes: [] }),
    );
    expect(result).toEqual({ ok: true, value: { ids: ['a5', 'a1'] } });
  });

  it('stamps the TTL purgeAt as a real Timestamp on a TTL group’s Set, and nothing elsewhere (F1-7)', async () => {
    const result = await firestoreCommitPlan(db)(
      async () => null,
      () =>
        Result.ok({
          writes: [
            WriteOp.set(['barberBusy', 'b_ivan__2026-10-07'], {
              barberId: 'b_ivan',
              localDate: '2026-10-07',
              blocks: [],
            }),
            WriteOp.set(['appointments', 'a9'], { localDate: '2026-10-07' }),
          ],
        }),
    );
    expect(result.ok).toBe(true);
    const busy = await body('barberBusy/b_ivan__2026-10-07');
    expect(busy?.['purgeAt']).toBeInstanceOf(Timestamp);
    expect((busy?.['purgeAt'] as Timestamp).toMillis()).toBe(
      Date.UTC(2026, 9, 7) + 30 * 86_400_000,
    );
    expect(await body('appointments/a9')).toEqual({ localDate: '2026-10-07' });
  });

  it('re-runs read → decide on contention, so two racing increments both land', async () => {
    await db.doc('settings/counter').set({ n: 0 });
    const increment = () =>
      firestoreCommitPlan(db)(
        async (tx) => tx.get<{ readonly n: number }>(['settings', 'counter']),
        (counter) =>
          Result.ok({
            writes: [
              WriteOp.update(['settings', 'counter'], {
                n: (counter?.n ?? 0) + 1,
              }),
            ],
          }),
      );
    const results = await Promise.all([increment(), increment()]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await body('settings/counter')).toEqual({ n: 2 });
  });
});
