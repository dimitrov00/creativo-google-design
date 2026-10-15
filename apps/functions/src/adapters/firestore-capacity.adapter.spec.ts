import type { Firestore } from 'firebase-admin/firestore';
import { vi } from 'vitest';
import { CapacityEntry } from '@core/components';
import { CapacityMonthId, RepositoryError } from '@core/primitives';
import { type CapacityMonth, Collections } from '@core/entities';
import { FIXTURE_IDS, FIXTURE_TODAY, minuteCount } from '@core/testing';
import { createProjectionFirestore } from '../test-support/fake-projection-firestore';
import { firestoreCapacityPorts } from './firestore-capacity.adapter';

/*
 * The capacity rollup's server read, over the in-memory Admin SDK: several
 * month documents in ONE `getAll`, positions preserved, bodies as stored.
 */

const SEPTEMBER = CapacityMonthId.of('2026-09');
const OCTOBER = CapacityMonthId.of('2026-10');

const month: CapacityMonth = {
  id: SEPTEMBER,
  month: SEPTEMBER,
  entries: [
    CapacityEntry.of(
      FIXTURE_TODAY,
      FIXTURE_IDS.barber,
      FIXTURE_IDS.location,
      minuteCount(120),
    ),
  ],
};

describe('firestoreCapacityPorts.loadCapacityMonths', () => {
  it('reads the months in ONE getAll, positions preserved — `null` before a month’s first rebuild', async () => {
    const fake = createProjectionFirestore({
      [`${Collections.Capacity}/${SEPTEMBER}`]: {
        month: SEPTEMBER,
        entries: month.entries,
      },
    });
    const getAll = vi.spyOn(fake.db, 'getAll');
    const ports = firestoreCapacityPorts(fake.db as unknown as Firestore);
    expect(await ports.loadCapacityMonths([OCTOBER, SEPTEMBER])).toEqual({
      ok: true,
      value: [null, month],
    });
    expect(getAll).toHaveBeenCalledTimes(1);
  });

  it('reads nothing for no month', async () => {
    const fake = createProjectionFirestore();
    const getAll = vi.spyOn(fake.db, 'getAll');
    const ports = firestoreCapacityPorts(fake.db as unknown as Firestore);
    expect(await ports.loadCapacityMonths([])).toEqual({ ok: true, value: [] });
    expect(getAll).not.toHaveBeenCalled();
  });

  it('answers a read that throws as a value, the canonical code its reason', async () => {
    const fake = createProjectionFirestore();
    vi.spyOn(fake.db, 'getAll').mockRejectedValue(
      Object.assign(new Error('4 DEADLINE_EXCEEDED'), { code: 4 }),
    );
    const ports = firestoreCapacityPorts(fake.db as unknown as Firestore);
    expect(await ports.loadCapacityMonths([SEPTEMBER])).toEqual({
      ok: false,
      error: RepositoryError.readFailed(
        Collections.Capacity,
        'deadline-exceeded',
      ),
    });
  });
});
