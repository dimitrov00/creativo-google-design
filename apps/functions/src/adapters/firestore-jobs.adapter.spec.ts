import type { Firestore } from 'firebase-admin/firestore';
import { vi } from 'vitest';
import { BackfillJobName, Role } from '@core/components';
import { AppointmentId, BackfillJobId, UserId } from '@core/primitives';
import { RepositoryError, RepositoryErrorCode } from '@core/errors';
import { type BackfillJob, Collections } from '@core/entities';
import {
  appointmentFixture,
  FIXTURE_NOW_UTC_MS,
  recordingTelemetry,
} from '@core/testing';
import { StoredDocumentSystem } from '@core/systems';
import { createProjectionFirestore } from '../test-support/fake-projection-firestore';
import { firestoreJobPorts } from './firestore-jobs.adapter';

/*
 * The operator backfill's server reads and progress write, over the
 * in-memory Admin SDK: the job as stored, the progress `Set`, the next page
 * of appointments in document-id order, and the stored roles behind the
 * token's claim.
 */

function bodyOf(entity: { readonly id: string }): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entity).filter(([key]) => key !== 'id'),
  );
}

const JOB_ID = BackfillJobId.of('clientStats');
const job: BackfillJob = {
  id: JOB_ID,
  backfillJobName: BackfillJobName.ClientStats,
  cursor: 'a2',
  processed: 2,
  storedClients: 0,
  stamped: 1,
  recomputed: 2,
  startedAtUtcMs: FIXTURE_NOW_UTC_MS,
  finishedAtUtcMs: null,
  updatedAtUtcMs: FIXTURE_NOW_UTC_MS,
  sampleChecked: null,
  sampleMismatched: [],
};

const visit = (id: string) => appointmentFixture({ id: AppointmentId.of(id) });

function seeded() {
  return createProjectionFirestore({
    [`${Collections.Appointments}/a2`]: bodyOf(visit('a2')),
    [`${Collections.Appointments}/a1`]: bodyOf(visit('a1')),
    [`${Collections.Appointments}/a3`]: bodyOf(visit('a3')),
    [`${Collections.Users}/u-sys`]: { roles: ['sysadmin', 'nonsense'] },
    [`${Collections.Users}/u-client`]: { roles: 'client' },
  });
}

describe('firestoreJobPorts', () => {
  it('writes the progress as a Set of the job minus its id, and reads it back as stored', async () => {
    const fake = seeded();
    const ports = firestoreJobPorts(fake.db as unknown as Firestore);
    expect(await ports.loadBackfillJob(JOB_ID)).toEqual({
      ok: true,
      value: null,
    });
    expect(await ports.writeBackfillJob(job)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(fake.docs.get(`${Collections.BackfillJobs}/clientStats`)).toEqual(
      bodyOf(job),
    );
    expect(await ports.loadBackfillJob(JOB_ID)).toEqual({
      ok: true,
      value: job,
    });
  });

  it('pages the appointments in document-id order, strictly after the cursor', async () => {
    const ports = firestoreJobPorts(seeded().db as unknown as Firestore);
    expect(await ports.pageAppointments(null, 2)).toEqual({
      ok: true,
      value: [visit('a1'), visit('a2')],
    });
    expect(await ports.pageAppointments(AppointmentId.of('a2'), 2)).toEqual({
      ok: true,
      value: [visit('a3')],
    });
  });

  it('reads the stored roles — an unknown string grants nothing, a non-list or no account none at all', async () => {
    const ports = firestoreJobPorts(seeded().db as unknown as Firestore);
    expect(await ports.loadCallerRoles(UserId.of('u-sys'))).toEqual({
      ok: true,
      value: [Role.Sysadmin],
    });
    expect(await ports.loadCallerRoles(UserId.of('u-client'))).toEqual({
      ok: true,
      value: [],
    });
    expect(await ports.loadCallerRoles(UserId.of('u-nobody'))).toEqual({
      ok: true,
      value: [],
    });
  });

  it('answers a read or a write that throws as a value, the canonical code its reason', async () => {
    const fake = seeded();
    vi.spyOn(fake.db, 'doc').mockImplementation(() => {
      throw Object.assign(new Error('7 PERMISSION_DENIED'), { code: 7 });
    });
    const ports = firestoreJobPorts(fake.db as unknown as Firestore);
    expect(await ports.writeBackfillJob(job)).toEqual({
      ok: false,
      error: RepositoryError.writeFailed(
        `${Collections.BackfillJobs}/clientStats`,
        'permission-denied',
      ),
    });
    expect(await ports.loadCallerRoles(UserId.of('u-sys'))).toEqual({
      ok: false,
      error: RepositoryError.readFailed(
        `${Collections.Users}/u-sys`,
        'permission-denied',
      ),
    });
  });
});

describe('firestoreJobPorts.pageAppointments, guarded — the walk stops AT a malformed row (edge hardening D-3)', () => {
  const guarded = (fake: ReturnType<typeof createProjectionFirestore>) => {
    const telemetry = recordingTelemetry();
    return {
      telemetry,
      ports: firestoreJobPorts(
        fake.db as unknown as Firestore,
        StoredDocumentSystem.guardOf,
        telemetry.log,
      ),
    };
  };

  it('fails the whole page naming the document — never a shorter page the walk would read as the end', async () => {
    const fake = seeded();
    fake.docs.set(`${Collections.Appointments}/a2`, {
      ...bodyOf(visit('a2')),
      seats: [{ ...visit('a2').seats[0], durationMinutes: 0 }],
    });
    const { telemetry, ports } = guarded(fake);
    expect(await ports.pageAppointments(null, 3)).toEqual({
      ok: false,
      error: {
        errorCode: RepositoryErrorCode.Malformed,
        path: `${Collections.Appointments}/a2`,
        reason: 'seats[0].durationMinutes',
      },
    });
    expect(telemetry.lines).toEqual([
      {
        level: 'error',
        msg: 'malformed document refused',
        fields: {
          path: `${Collections.Appointments}/a2`,
          field: 'seats[0].durationMinutes',
        },
      },
    ]);
  });

  it('pages a clean walk as before — legacy rows without the subject mirrors included', async () => {
    const fake = seeded();
    const legacy = Object.fromEntries(
      Object.entries(bodyOf(visit('a3'))).filter(
        ([field]) =>
          field !== 'subjectUserIds' && field !== 'subjectCustomerIds',
      ),
    );
    fake.docs.set(`${Collections.Appointments}/a3`, legacy);
    const { telemetry, ports } = guarded(fake);
    expect(await ports.pageAppointments(null, 2)).toEqual({
      ok: true,
      value: [visit('a1'), visit('a2')],
    });
    expect(await ports.pageAppointments(AppointmentId.of('a2'), 2)).toEqual({
      ok: true,
      value: [{ id: 'a3', ...legacy }],
    });
    expect(telemetry.lines).toEqual([]);
  });
});
