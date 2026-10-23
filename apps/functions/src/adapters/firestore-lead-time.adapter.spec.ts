import { type Firestore, Timestamp } from 'firebase-admin/firestore';
import { vi } from 'vitest';
import {
  BarberLeadTimeSampleId,
  LocalDate,
  MinuteCount,
} from '@core/primitives';
import { RepositoryError } from '@core/errors';
import { type BarberLeadTimeSample, Collections } from '@core/entities';
import {
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TODAY,
  localDate,
  minuteCount,
} from '@core/testing';
import { createProjectionFirestore } from '../test-support/fake-projection-firestore';
import { firestoreLeadTimePorts } from './firestore-lead-time.adapter';
import { purgeAtFor } from './firestore-ttl.adapter';

/*
 * The lead-time sample writer, over the in-memory Admin SDK: one `Set` of
 * the entity minus its id, with the TTL root `purgeAt` stamped by THE one
 * stamp (`purgeAtFor`, F1-7: the sample day's UTC midnight + 400 days).
 */

const sample: BarberLeadTimeSample = {
  id: BarberLeadTimeSampleId.of(`${FIXTURE_IDS.barber}__${FIXTURE_TODAY}`),
  barberId: FIXTURE_IDS.barber,
  localDate: FIXTURE_TODAY,
  firstAvailableLocalDate: localDate('2026-09-30'),
  leadTimeDays: 2,
  freeMinutesOnFirstDay: minuteCount(60),
  horizonDayCount: 64,
  sampledAtUtcMs: FIXTURE_NOW_UTC_MS,
};

describe('firestoreLeadTimePorts.writeLeadTimeSample', () => {
  it('sets the sample body at its id, with the one TTL stamp', async () => {
    const fake = createProjectionFirestore();
    const ports = firestoreLeadTimePorts(fake.db as unknown as Firestore);
    expect(await ports.writeLeadTimeSample(sample)).toEqual({
      ok: true,
      value: undefined,
    });
    const path = [Collections.BarberLeadTimeSamples, sample.id];
    const body = Object.fromEntries(
      Object.entries(sample).filter(([key]) => key !== 'id'),
    );
    const stored = fake.docs.get(path.join('/'));
    expect(stored).toEqual({ ...body, purgeAt: purgeAtFor(path, body) });
    // 2026-09-28 UTC midnight + 400 days.
    expect(stored?.['purgeAt']).toEqual(
      Timestamp.fromMillis(
        (LocalDate.toEpochDay(FIXTURE_TODAY) + 400) * 86_400_000,
      ),
    );
  });

  it('overwrites the day’s sample — one row per barber per day', async () => {
    const fake = createProjectionFirestore();
    const ports = firestoreLeadTimePorts(fake.db as unknown as Firestore);
    await ports.writeLeadTimeSample(sample);
    await ports.writeLeadTimeSample({
      ...sample,
      firstAvailableLocalDate: null,
      leadTimeDays: null,
      freeMinutesOnFirstDay: MinuteCount.ZERO,
    });
    expect(
      fake.docs.get(`${Collections.BarberLeadTimeSamples}/${sample.id}`)?.[
        'leadTimeDays'
      ],
    ).toBeNull();
  });

  it('answers a write that throws as a value, the canonical code its reason', async () => {
    const fake = createProjectionFirestore();
    vi.spyOn(fake.db, 'doc').mockImplementation(() => {
      throw Object.assign(new Error('8 RESOURCE_EXHAUSTED'), { code: 8 });
    });
    const ports = firestoreLeadTimePorts(fake.db as unknown as Firestore);
    expect(await ports.writeLeadTimeSample(sample)).toEqual({
      ok: false,
      error: RepositoryError.writeFailed(
        `${Collections.BarberLeadTimeSamples}/${sample.id}`,
        'resource-exhausted',
      ),
    });
  });
});
