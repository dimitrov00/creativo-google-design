import type { Firestore } from 'firebase-admin/firestore';
import { vi } from 'vitest';
import { BookingPolicy, PreciseInstant } from '@core/components';
import { CustomerId, PolicyRecomputeJobId } from '@core/primitives';
import { RepositoryError } from '@core/errors';
import {
  BOOKING_POLICY_DOC,
  Collections,
  POLICY_RECOMPUTE_DOC,
  type PolicyRecomputeJob,
  RecomputeJobName,
} from '@core/entities';
import { PolicyRecomputeJobSystem } from '@core/systems';
import { FIXTURE_NOW_UTC_MS } from '@core/testing';
import { createProjectionFirestore } from '../test-support/fake-projection-firestore';
import { firestoreClientStatsPorts } from './firestore-client-stats.adapter';

/*
 * The policy recompute's server reads, over the in-memory Admin SDK: the
 * stored clients' ids in document-id order (bodies not read), the pass's
 * job as stored, and the policy's late line with the document's own update
 * time at full precision.
 */

const ANA = CustomerId.of('cus_ana');
const BOB = CustomerId.of('cus_bob');
const CAROL = CustomerId.of('cus_carol');

const job: PolicyRecomputeJob = {
  id: PolicyRecomputeJobId.FIXED,
  recomputeJobName: RecomputeJobName.ClientStatsPolicy,
  generation: 'evt-a',
  changedAtSeconds: (PreciseInstant.of(1_800_000_000, 5) as PreciseInstant)
    .seconds,
  changedAtNanos: (PreciseInstant.of(1_800_000_000, 5) as PreciseInstant).nanos,
  cursor: ANA,
  storedClients: 1,
  recomputed: 1,
  failed: 0,
  startedAtUtcMs: FIXTURE_NOW_UTC_MS,
  updatedAtUtcMs: FIXTURE_NOW_UTC_MS,
  finishedAtUtcMs: null,
  stepKey: PolicyRecomputeJobSystem.stepKeyOf('evt-a', ANA, null),
  stalledAtUtcMs: null,
  lastFailureCode: null,
  windowHours: 48,
};

function seeded() {
  const body = Object.fromEntries(
    Object.entries(job).filter(([key]) => key !== 'id'),
  );
  return createProjectionFirestore({
    [`${Collections.ClientStats}/${CAROL}`]: { version: 1 },
    [`${Collections.ClientStats}/${ANA}`]: { version: 1 },
    [`${Collections.ClientStats}/${BOB}`]: { version: 1 },
    [`${Collections.ClientStats}/${ANA}/restricted/money`]: { version: 1 },
    [`${Collections.BackfillJobs}/${POLICY_RECOMPUTE_DOC}`]: body,
  });
}

describe('firestoreClientStatsPorts.pageClients', () => {
  it('pages the stored clients in document-id order, strictly after the cursor — never a subcollection', async () => {
    const ports = firestoreClientStatsPorts(
      seeded().db as unknown as Firestore,
    );
    expect(await ports.pageClients(null, 2)).toEqual({
      ok: true,
      value: [ANA, BOB],
    });
    expect(await ports.pageClients(BOB, 2)).toEqual({
      ok: true,
      value: [CAROL],
    });
  });

  it('answers a read that throws as a value, the canonical code its reason', async () => {
    const fake = seeded();
    vi.spyOn(fake.db, 'collection').mockImplementation(() => {
      throw Object.assign(new Error('14 UNAVAILABLE'), { code: 14 });
    });
    const ports = firestoreClientStatsPorts(fake.db as unknown as Firestore);
    expect(await ports.pageClients(null, 2)).toEqual({
      ok: false,
      error: RepositoryError.readFailed(Collections.ClientStats, 'unavailable'),
    });
  });
});

describe('firestoreClientStatsPorts.loadPolicyRecomputeJob', () => {
  it('reads the pass’s job as stored, `null` before the first pass', async () => {
    const ports = firestoreClientStatsPorts(
      seeded().db as unknown as Firestore,
    );
    expect(await ports.loadPolicyRecomputeJob()).toEqual({
      ok: true,
      value: job,
    });
    const empty = firestoreClientStatsPorts(
      createProjectionFirestore().db as unknown as Firestore,
    );
    expect(await empty.loadPolicyRecomputeJob()).toEqual({
      ok: true,
      value: null,
    });
  });
});

describe('firestoreClientStatsPorts.loadPolicyLine', () => {
  it('reads the window through the defaults and the document’s update time to the nanosecond', async () => {
    const fake = createProjectionFirestore();
    const doc = vi.spyOn(fake.db, 'doc').mockReturnValue({
      get: async () => ({
        exists: true,
        updateTime: { seconds: 1_800_000_000, nanoseconds: 123_456_789 },
        data: () => ({ cancellationWindowHours: 48 }),
      }),
    } as unknown as ReturnType<typeof fake.db.doc>);
    const ports = firestoreClientStatsPorts(fake.db as unknown as Firestore);
    expect(await ports.loadPolicyLine()).toEqual({
      ok: true,
      value: {
        updatedAt: PreciseInstant.of(1_800_000_000, 123_456_789),
        windowHours: 48,
      },
    });
    expect(doc).toHaveBeenCalledWith(
      `${Collections.Settings}/${BOOKING_POLICY_DOC}`,
    );
  });

  it('reads no document as the defaults’ window, with no update time', async () => {
    const ports = firestoreClientStatsPorts(
      createProjectionFirestore().db as unknown as Firestore,
    );
    expect(await ports.loadPolicyLine()).toEqual({
      ok: true,
      value: {
        updatedAt: null,
        windowHours: BookingPolicy.DEFAULT.cancellationWindowHours,
      },
    });
  });
});
