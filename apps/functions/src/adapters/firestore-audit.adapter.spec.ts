import type { Firestore } from 'firebase-admin/firestore';
import {
  AppointmentId,
  AuditEntryId,
  AuditResourceId,
  CustomerId,
  LocationId,
  Result,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import { type RepositoryError, RepositoryErrorCode } from '@core/errors';
import {
  Actor,
  AttemptOutcome,
  AuditAction,
  AuditContext,
  AuditTargetRef,
  Role,
} from '@core/components';
import type { AuditEntry } from '@core/entities';
import { recordingTelemetry, unwrapOk } from '@core/testing';
import { createProjectionFirestore } from '../test-support/fake-projection-firestore';
import { documentAuditReport } from '../wire/triggers.wire';
import { firestoreAuditPorts } from './firestore-audit.adapter';

const AT = unwrapOk(UtcEpochMs.of(1_790_000_000_000));

/**
 * One flat row, as `AuditSystem.plan` builds it and the pipeline ids it —
 * a backfill row names no operation (`auditOperationId: null`, WS-4.4).
 */
function row(id: string, target: string | null): AuditEntry {
  return {
    id: AuditEntryId.of(id),
    recordedAtUtcMs: AT,
    resourceId: AuditResourceId.forAppointment(AppointmentId.of('a1')),
    auditOperationId: null,
    ...Actor.staff(UserId.of('u-staff'), [Role.Receptionist]),
    ...AuditContext.placement(
      AuditAction.BookingStaffCreated,
      LocationId.of('loc-center'),
    ),
    ...(target === null
      ? AuditTargetRef.none()
      : AuditTargetRef.customer(CustomerId.of(target))),
  };
}

const body = (entry: AuditEntry): Record<string, unknown> => {
  const { id: _id, ...rest } = entry;
  return rest;
};

describe('firestoreAuditPorts', () => {
  describe('appendAudit — the backfill’s after-commit row, created, never fatal', () => {
    it('creates each row at its derived id, the body the flat entry minus its id', async () => {
      const fake = createProjectionFirestore();
      const telemetry = recordingTelemetry();
      await firestoreAuditPorts(
        fake.db as unknown as Firestore,
        telemetry,
      ).appendAudit([row('r1', 'cus_maria'), row('r2', null)]);
      expect(fake.docs.get('auditLog/r1')).toEqual(
        body(row('r1', 'cus_maria')),
      );
      expect(fake.docs.get('auditLog/r2')).toEqual(body(row('r2', null)));
      expect(telemetry.lines).toEqual([]);
    });

    it('a replay writes nothing twice, fills a missing row, and is not logged as a failure', async () => {
      const stale = { ...body(row('r1', 'cus_maria')), recordedAtUtcMs: 1 };
      const fake = createProjectionFirestore({ 'auditLog/r1': stale });
      const telemetry = recordingTelemetry();
      await firestoreAuditPorts(
        fake.db as unknown as Firestore,
        telemetry,
      ).appendAudit([row('r1', 'cus_maria'), row('r2', 'cus_petar')]);
      // The first call's row is never rewritten…
      expect(fake.docs.get('auditLog/r1')).toEqual(stale);
      // …and the row it did not write is filled in.
      expect(fake.docs.get('auditLog/r2')).toEqual(
        body(row('r2', 'cus_petar')),
      );
      expect(telemetry.lines).toEqual([]);
    });

    it('never throws on a failed write: it logs once at error level and the act stands', async () => {
      const failing = {
        collection: () => ({ doc: (id: string) => ({ id }) }),
        batch: () => ({
          create: () => undefined,
          commit: async () => {
            throw new Error('unavailable');
          },
        }),
      } as unknown as Firestore;
      const telemetry = recordingTelemetry();
      await expect(
        firestoreAuditPorts(failing, telemetry).appendAudit([row('r1', null)]),
      ).resolves.toBeUndefined();
      expect(telemetry.lines).toEqual([
        {
          level: 'error',
          msg: 'audit write failed',
          fields: {
            action: AuditAction.BookingStaffCreated,
            resourceId: 'a1',
            reason: 'unknown',
          },
        },
      ]);
    });

    it('writes every row of one act in ONE batch — the act is logged for everybody or for nobody', async () => {
      const fake = createProjectionFirestore();
      const batch = vi.spyOn(fake.db, 'batch');
      await firestoreAuditPorts(
        fake.db as unknown as Firestore,
        recordingTelemetry(),
      ).appendAudit([row('r1', 'cus_maria'), row('r2', 'cus_stefan')]);
      expect(batch).toHaveBeenCalledTimes(1);
      expect([...fake.docs.keys()].sort()).toEqual([
        'auditLog/r1',
        'auditLog/r2',
      ]);
    });

    it('logs a gap-filling row that fails for any other reason than ALREADY_EXISTS, and never throws', async () => {
      const fake = createProjectionFirestore({
        'auditLog/r1': body(row('r1', 'cus_maria')),
      });
      // The batch meets r1 (a replay), so the rows are created one by one —
      // and r2's own create is refused for a reason that is no replay.
      const db = {
        batch: () => fake.db.batch(),
        collection: (name: string) => ({
          doc: (id: string) => {
            const ref = fake.db.collection(name).doc(id);
            return id === 'r2'
              ? {
                  ...ref,
                  create: async () => {
                    throw Object.assign(new Error('7 PERMISSION_DENIED'), {
                      code: 7,
                    });
                  },
                }
              : ref;
          },
        }),
      } as unknown as Firestore;
      const telemetry = recordingTelemetry();
      await expect(
        firestoreAuditPorts(db, telemetry).appendAudit([
          row('r1', 'cus_maria'),
          row('r2', 'cus_stefan'),
        ]),
      ).resolves.toBeUndefined();
      expect(fake.docs.has('auditLog/r2')).toBe(false);
      expect(telemetry.lines).toEqual([
        {
          level: 'error',
          msg: 'audit write failed',
          fields: expect.objectContaining({
            action: AuditAction.BookingStaffCreated,
            reason: 'permission-denied',
          }),
        },
      ]);
    });

    it('asks nothing for no rows', async () => {
      const fake = createProjectionFirestore();
      const batch = vi.spyOn(fake.db, 'batch');
      await firestoreAuditPorts(
        fake.db as unknown as Firestore,
        recordingTelemetry(),
      ).appendAudit([]);
      expect(batch).not.toHaveBeenCalled();
    });
  });

  describe('createAuditRows — the document-change triggers’ write', () => {
    it('creates the rows; an existing row is a success, not a rewrite', async () => {
      const kept = { ...body(row('r1', null)), recordedAtUtcMs: 1 };
      const fake = createProjectionFirestore({ 'auditLog/r1': kept });
      const result = await firestoreAuditPorts(
        fake.db as unknown as Firestore,
        recordingTelemetry(),
      ).createAuditRows([row('r1', null), row('r2', null)]);
      expect(result).toEqual({ ok: true, value: undefined });
      expect(fake.docs.get('auditLog/r1')).toEqual(kept);
      expect(fake.docs.get('auditLog/r2')).toEqual(body(row('r2', null)));
    });

    it('answers a real failure as a REPOSITORY_WRITE_FAILED value, so the trigger retries', async () => {
      const failing = {
        collection: () => ({
          doc: () => ({
            create: async () => {
              throw new Error('permission-denied');
            },
          }),
        }),
      } as unknown as Firestore;
      const result = await firestoreAuditPorts(
        failing,
        recordingTelemetry(),
      ).createAuditRows([row('r1', null)]);
      expect(!result.ok && result.error.errorCode).toBe(
        RepositoryErrorCode.WriteFailed,
      );
    });

    /** The trigger edge's verdict on the write's answer (`documentAuditReport`). */
    const verdictOf = (written: Result<void, RepositoryError>) =>
      documentAuditReport(written.ok ? Result.ok({ rows: 1 }) : written)
        .attemptFailure;

    /** A store whose every row create throws `thrown`. */
    const throwingOnCreate = (thrown: unknown): Firestore =>
      ({
        collection: () => ({
          doc: () => ({
            create: async () => {
              throw thrown;
            },
          }),
        }),
      }) as unknown as Firestore;

    it('records the canonical code as the reason, so a transient outage is judged TRANSIENT and redelivered', async () => {
      // The Admin SDK's shape: gRPC 14 on `code`, the status words in the message.
      const outage = Object.assign(
        new Error('14 UNAVAILABLE: No connection established'),
        { code: 14 },
      );
      const result = await firestoreAuditPorts(
        throwingOnCreate(outage),
        recordingTelemetry(),
      ).createAuditRows([row('r1', null)]);
      expect(!result.ok && result.error.reason).toBe('unavailable');
      expect(verdictOf(result)).toMatchObject({
        failureCode: 'unavailable',
        attemptOutcome: AttemptOutcome.Transient,
      });
    });

    it('keeps a permanent failure permanent (gRPC 7, permission-denied)', async () => {
      const refused = Object.assign(new Error('7 PERMISSION_DENIED: no'), {
        code: 7,
      });
      const result = await firestoreAuditPorts(
        throwingOnCreate(refused),
        recordingTelemetry(),
      ).createAuditRows([row('r1', null)]);
      expect(!result.ok && result.error.reason).toBe('permission-denied');
      expect(verdictOf(result)).toMatchObject({
        failureCode: 'permission-denied',
        attemptOutcome: AttemptOutcome.Permanent,
      });
    });
  });

  describe('a failure names its canonical code, never the SDK’s message (S-DEP-2)', () => {
    const leaky = (): Error =>
      Object.assign(new Error('14 UNAVAILABLE: no route to +359880000777'), {
        code: 14,
      });

    it('the backfill row’s failure line holds the code as `reason`, no message', async () => {
      const failing = {
        collection: () => ({ doc: (id: string) => ({ id }) }),
        batch: () => ({
          create: () => undefined,
          commit: async () => {
            throw leaky();
          },
        }),
      } as unknown as Firestore;
      const telemetry = recordingTelemetry();
      await firestoreAuditPorts(failing, telemetry).appendAudit([
        row('r1', null),
      ]);
      expect(telemetry.lines).toEqual([
        {
          level: 'error',
          msg: 'audit write failed',
          fields: {
            action: AuditAction.BookingStaffCreated,
            resourceId: 'a1',
            reason: 'unavailable',
          },
        },
      ]);
      expect(JSON.stringify(telemetry.lines)).not.toContain('359880000777');
    });

    it('the backfill read answers the code as its reason', async () => {
      const failing = {
        collection: () => ({
          where: () => ({
            get: async () => {
              throw leaky();
            },
          }),
        }),
      } as unknown as Firestore;
      const result = await firestoreAuditPorts(
        failing,
        recordingTelemetry(),
      ).auditActionsFor([AppointmentId.of('a1')]);
      expect(result).toEqual({
        ok: false,
        error: {
          errorCode: RepositoryErrorCode.ReadFailed,
          path: 'auditLog',
          reason: 'unavailable',
        },
      });
      expect(JSON.stringify(result)).not.toContain('359880000777');
    });
  });

  describe('auditActionsFor — the backfill’s read', () => {
    it('answers every row filed against the ids, by resourceId, in chunks', async () => {
      const seed: Record<string, Record<string, unknown>> = {
        'auditLog/x': { resourceId: 'other', auditAction: 'BOOKING_COMMITTED' },
      };
      const ids: AppointmentId[] = [];
      for (let i = 0; i < 31; i++) {
        ids.push(AppointmentId.of(`a${i}`));
        seed[`auditLog/r${i}`] = {
          resourceId: `a${i}`,
          auditAction: 'BOOKING_COMMITTED',
        };
      }
      const fake = createProjectionFirestore(seed);
      const result = await firestoreAuditPorts(
        fake.db as unknown as Firestore,
        recordingTelemetry(),
      ).auditActionsFor(ids);
      expect(result.ok && result.value.map((entry) => entry.id).sort()).toEqual(
        ids.map((_, i) => `r${i}`).sort(),
      );
    });
  });
});
