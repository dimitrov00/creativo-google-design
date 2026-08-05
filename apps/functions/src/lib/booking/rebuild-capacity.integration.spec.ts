import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import { rebuildBarberCapacity } from './rebuild-capacity';

/**
 * The I/O shell against the REAL Firestore emulator — the lane that exists
 * because merge-vs-replace semantics cannot be faked honestly.
 *
 * Emulator-only by construction, same guard as the seed script: refuses to
 * run without `FIRESTORE_EMULATOR_HOST`, so it can never touch a real
 * project. Uses its own demo project id, so clearing between tests cannot
 * disturb the dev stack's seeded data on the same emulator.
 */
const PROJECT_ID = 'demo-functions-capacity';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
if (!process.env.FIRESTORE_EMULATOR_HOST.includes('127.0.0.1')) {
  throw new Error('Refusing to run outside the local emulators.');
}

const ZONE = 'Europe/Sofia';

/** Mon-first: open six days 09:00–17:00, closed Sunday. */
const HOURS = [
  ...Array.from({ length: 6 }, () => ({
    kind: 'open',
    opens: '09:00',
    closes: '17:00',
  })),
  { kind: 'closed' },
];

const SCHEDULE = {
  barberId: 'b1',
  turnaroundMinutes: 0,
  versions: [
    {
      seq: 1,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      weeklyPattern: Object.fromEntries(
        [
          'monday',
          'tuesday',
          'wednesday',
          'thursday',
          'friday',
          'saturday',
        ].map((weekday) => [
          weekday,
          [{ start: '09:00', end: '17:00', locationId: 'loc-a' }],
        ]),
      ),
    },
  ],
};

describe('rebuildBarberCapacity (emulator)', () => {
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
    // The REST wipe endpoint clears exactly this demo project.
    await fetch(
      `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
      { method: 'DELETE' },
    );
    await db.collection('locations').doc('loc-a').set({
      timezone: ZONE,
      status: 'active',
      hours: HOURS,
    });
    await db.collection('barberSchedules').doc('b1').set(SCHEDULE);
  });

  it('materializes a month from geometry, pruning empty days', async () => {
    await db
      .collection('barberBusy')
      .doc('b1__2026-08-03')
      .set({
        barberId: 'b1',
        dayKey: '2026-08-03',
        zone: ZONE,
        busy: [
          {
            startIso: '2026-08-03T10:00:00+03:00',
            endIso: '2026-08-03T11:00:00+03:00',
            zone: ZONE,
          },
        ],
      });

    // Mon 3rd .. Sun 9th.
    await rebuildBarberCapacity(db, 'b1', '2026-08-03', '2026-08-09');

    const month = (await db.collection('capacity').doc('2026-08').get()).data();
    expect(month?.['month']).toBe('2026-08');
    const days = month?.['days'] as Record<
      string,
      Record<string, Record<string, number>>
    >;
    expect(days['2026-08-03']).toEqual({ b1: { 'loc-a': 420 } }); // 480 − 60
    expect(days['2026-08-04']).toEqual({ b1: { 'loc-a': 480 } });
    // Sunday: no windows ⇒ no entry at all, not a zero.
    expect(days['2026-08-09']).toBeUndefined();
    expect(month?.['purgeAt']).toBeDefined();
  });

  // THE regression this suite exists for: `set(…, {merge:true})` built its
  // mask from the LEAVES, so a location key that vanished from a
  // contribution survived every rebuild — phantom free minutes no sweep
  // could heal. The fix writes with `update(FieldPath)`, which replaces the
  // map wholesale. If this test starts failing, someone reintroduced merge
  // semantics.
  it('REPLACES a stale contribution — a ghost location key does not survive', async () => {
    await db
      .collection('capacity')
      .doc('2026-08')
      .set({
        month: '2026-08',
        days: {
          '2026-08-03': {
            b1: { 'loc-a': 100, 'loc-ghost': 999 },
            b2: { 'loc-a': 50 },
          },
        },
      });

    await rebuildBarberCapacity(db, 'b1', '2026-08-03', '2026-08-03');

    const days = (
      await db.collection('capacity').doc('2026-08').get()
    ).data()?.['days'] as Record<
      string,
      Record<string, Record<string, number>>
    >;
    expect(days['2026-08-03']?.['b1']).toEqual({ 'loc-a': 480 });
    expect(days['2026-08-03']?.['b1']?.['loc-ghost']).toBeUndefined();
    // Another barber's entry on the same day is untouched.
    expect(days['2026-08-03']?.['b2']).toEqual({ 'loc-a': 50 });
  });

  it('deletes the entry when the day empties, and keeps absent-day semantics', async () => {
    await rebuildBarberCapacity(db, 'b1', '2026-08-03', '2026-08-03');

    // The barber calls in a full-day block: recompute must DELETE the entry.
    await db
      .collection('barberBusy')
      .doc('b1__2026-08-03')
      .set({
        barberId: 'b1',
        dayKey: '2026-08-03',
        zone: ZONE,
        busy: [
          {
            startIso: '2026-08-03T09:00:00+03:00',
            endIso: '2026-08-03T17:00:00+03:00',
            zone: ZONE,
          },
        ],
      });
    await rebuildBarberCapacity(db, 'b1', '2026-08-03', '2026-08-03');

    const days = (
      await db.collection('capacity').doc('2026-08').get()
    ).data()?.['days'] as Record<string, unknown>;
    expect(days['2026-08-03']).toEqual({});
  });
});
