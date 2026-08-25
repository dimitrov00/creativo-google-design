import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { createFakeFirestore } from '../../test-support/fake-firestore';
import {
  LEAD_TIME_SAMPLES_COLLECTION,
  sampleAllBarbers,
} from './sample-lead-time';

/** The sample day, fixed so `leadTimeDays` is comparable across runs. */
const TODAY = '2026-08-05';

function fakeDb() {
  return createFakeFirestore() as unknown as Firestore & {
    collection: ReturnType<typeof createFakeFirestore>['collection'];
  };
}

/** One capacity month doc: `{ [dayKey]: { [barberId]: { [locationId]: minutes } } }`. */
async function seedCapacity(
  db: ReturnType<typeof fakeDb>,
  month: string,
  days: Record<string, Record<string, Record<string, number>>>,
): Promise<void> {
  await db.collection('capacity').doc(month).set({ month, days });
}

async function seedRoster(
  db: ReturnType<typeof fakeDb>,
  barberIds: readonly string[],
): Promise<void> {
  for (const barberId of barberIds) {
    await db.collection('barberSchedules').doc(barberId).set({ barberId });
  }
}

async function sampleFor(
  db: ReturnType<typeof fakeDb>,
  barberId: string,
): Promise<Record<string, unknown> | undefined> {
  const snap = await db
    .collection(LEAD_TIME_SAMPLES_COLLECTION)
    .doc(`${barberId}__${TODAY}`)
    .get();
  return snap.data();
}

describe('sampleBarberLeadTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Midday Sofia, so the tenant-zone day key is unambiguously TODAY.
    vi.setSystemTime(new Date('2026-08-05T09:00:00Z'));
  });

  it('reports zero lead time when the barber is free today', async () => {
    const db = fakeDb();
    await seedRoster(db, ['ivan']);
    await seedCapacity(db, '2026-08', {
      [TODAY]: { ivan: { 'loc-center': 240 } },
    });

    await sampleAllBarbers(db);

    const sample = await sampleFor(db, 'ivan');
    expect(sample?.['firstAvailableDayKey']).toBe(TODAY);
    expect(sample?.['leadTimeDays']).toBe(0);
    expect(sample?.['freeMinutesOnFirstDay']).toBe(240);
  });

  /**
   * Same-day walk-ups are most of a barbershop's volume, so the walk starts at
   * today — but when today is full the count must be the real distance to the
   * next opening, not one.
   */
  it('counts the days to the first opening', async () => {
    const db = fakeDb();
    await seedRoster(db, ['ivan']);
    await seedCapacity(db, '2026-08', {
      [TODAY]: { ivan: { 'loc-center': 0 } },
      '2026-08-06': {},
      '2026-08-07': { ivan: { 'loc-center': 90 } },
    });

    await sampleAllBarbers(db);

    const sample = await sampleFor(db, 'ivan');
    expect(sample?.['firstAvailableDayKey']).toBe('2026-08-07');
    expect(sample?.['leadTimeDays']).toBe(2);
  });

  /**
   * `null`, not zero and not the horizon: "booked solid as far as we sell" is
   * a different fact from "free on the last day", and averaging a sentinel
   * into a trend line would quietly flatten exactly the peaks worth acting on.
   */
  it('records null when nothing is free inside the horizon', async () => {
    const db = fakeDb();
    await seedRoster(db, ['ivan']);
    await seedCapacity(db, '2026-08', {});

    await sampleAllBarbers(db);

    const sample = await sampleFor(db, 'ivan');
    expect(sample?.['firstAvailableDayKey']).toBeNull();
    expect(sample?.['leadTimeDays']).toBeNull();
    expect(sample?.['freeMinutesOnFirstDay']).toBe(0);
  });

  it('ignores free time below one slot step', async () => {
    const db = fakeDb();
    await seedRoster(db, ['ivan']);
    await seedCapacity(db, '2026-08', {
      // 10 minutes is under the 15-minute default step — not sellable.
      [TODAY]: { ivan: { 'loc-center': 10 } },
      '2026-08-06': { ivan: { 'loc-center': 15 } },
    });

    await sampleAllBarbers(db);

    expect((await sampleFor(db, 'ivan'))?.['firstAvailableDayKey']).toBe(
      '2026-08-06',
    );
  });

  it('sums a barber working two shops on one day', async () => {
    const db = fakeDb();
    await seedRoster(db, ['stefan']);
    await seedCapacity(db, '2026-08', {
      [TODAY]: { stefan: { 'loc-center': 10, 'loc-mladost': 10 } },
    });

    await sampleAllBarbers(db);

    // Neither shop clears the bar alone; the barber's own day does.
    const sample = await sampleFor(db, 'stefan');
    expect(sample?.['firstAvailableDayKey']).toBe(TODAY);
    expect(sample?.['freeMinutesOnFirstDay']).toBe(20);
  });

  it('samples every rostered barber independently', async () => {
    const db = fakeDb();
    await seedRoster(db, ['ivan', 'niko']);
    await seedCapacity(db, '2026-08', {
      [TODAY]: { ivan: { 'loc-center': 60 } },
      '2026-08-06': { niko: { 'loc-center': 60 } },
    });

    await sampleAllBarbers(db);

    expect((await sampleFor(db, 'ivan'))?.['leadTimeDays']).toBe(0);
    expect((await sampleFor(db, 'niko'))?.['leadTimeDays']).toBe(1);
  });

  it('stamps the sample with the day it was taken', async () => {
    const db = fakeDb();
    await seedRoster(db, ['ivan']);
    await seedCapacity(db, '2026-08', {
      [TODAY]: { ivan: { 'loc-center': 60 } },
    });

    await sampleAllBarbers(db);

    const sample = await sampleFor(db, 'ivan');
    expect(sample?.['dayKey']).toBe(TODAY);
    expect(sample?.['barberId']).toBe('ivan');
    expect(sample?.['zone']).toBe('Europe/Sofia');
  });
});
