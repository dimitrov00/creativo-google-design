import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import {
  AppointmentId,
  AuditEntryId,
  AuditResourceId,
  CustomerId,
  LocationId,
  UserId,
  type UtcEpochMs,
} from '@core/primitives';
import {
  Actor,
  AuditAction,
  AuditContext,
  AuditTargetRef,
  Role,
} from '@core/components';
import { type AuditEntry, Collections } from '@core/entities';
import { AuditSystem } from '@core/systems';
import { recordingTelemetry, utcMs } from '@core/testing';
import { sha256Hex } from './crypto.adapter';
import { firestoreAuditPorts } from './firestore-audit.adapter';

/**
 * `appendAudit`'s exactly-once write against the REAL Firestore emulator —
 * the successor of `lib/booking/audit.integration.spec.ts` (flip 1 §5.2).
 * Its one caller is the operator backfill's per-call row (audit-hardening
 * L2); the booking verbs' rows commit inside their own plan
 * (`integration/audit-in-commit.integration.spec.ts`).
 *
 * The unit spec proves the logic over a fake that throws what the author
 * believes the SDK throws; this proves the belief — that a batch `create()`
 * onto an existing row fails whole with the error the adapter recognises as
 * ALREADY_EXISTS, and nothing is logged for it.
 *
 * Emulator-only by construction, same guard as the seed.
 */
const PROJECT_ID = 'demo-functions-audit';

const EMULATOR_HOST = (process.env['FIRESTORE_EMULATOR_HOST'] ??=
  '127.0.0.1:8080');
if (!EMULATOR_HOST.includes('127.0.0.1')) {
  throw new Error('Refusing to run outside the local emulators.');
}

const RESOURCE = AuditResourceId.forAppointment(AppointmentId.of('appt-1'));
const MARIA = CustomerId.of('cus_maria');
const STEFAN = CustomerId.of('cus_stefan');

/** One person's row for one change, the id derived as the pipelines derive it. */
function rowFor(
  target: CustomerId,
  changeKey: string,
  recordedAtUtcMs: UtcEpochMs,
): AuditEntry {
  return {
    id: AuditEntryId.of(
      sha256Hex(
        AuditSystem.rowBasis(
          AuditAction.BookingCommitted,
          RESOURCE,
          target,
          changeKey,
        ),
      ),
    ),
    recordedAtUtcMs,
    resourceId: RESOURCE,
    // A backfill row — `appendAudit`'s one caller (L2) — names no operation.
    auditOperationId: null,
    ...Actor.staff(UserId.of('dev-staff-georgi'), [Role.Barber]),
    ...AuditContext.placement(
      AuditAction.BookingCommitted,
      LocationId.of('loc-center'),
    ),
    ...AuditTargetRef.customer(target),
  };
}

const FIRST = utcMs('2030-01-15T10:00:00.000+02:00');
const LATER = utcMs('2030-01-15T10:00:07.000+02:00');

describe('firestoreAuditPorts.appendAudit (emulator)', () => {
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

  async function rows() {
    return (await db.collection(Collections.AuditLog).get()).docs;
  }

  it('writes one row per person, and a replay of the same change adds none — silently', async () => {
    const telemetry = recordingTelemetry();
    const audit = firestoreAuditPorts(db, telemetry);
    await audit.appendAudit([
      rowFor(MARIA, 'attempt:abc', FIRST),
      rowFor(STEFAN, 'attempt:abc', FIRST),
    ]);
    await audit.appendAudit([
      rowFor(MARIA, 'attempt:abc', LATER),
      rowFor(STEFAN, 'attempt:abc', LATER),
    ]);

    const written = await rows();
    expect(written).toHaveLength(2);
    // The first call's rows, untouched by the replay.
    expect(
      written.every((row) => row.data()['recordedAtUtcMs'] === FIRST),
    ).toBe(true);
    expect(telemetry.lines).toEqual([]);
  });

  it('writes distinct rows for distinct changes', async () => {
    const audit = firestoreAuditPorts(db, recordingTelemetry());
    await audit.appendAudit([
      rowFor(MARIA, 'revision:4', FIRST),
      rowFor(STEFAN, 'revision:4', FIRST),
    ]);
    await audit.appendAudit([
      rowFor(MARIA, 'revision:5', FIRST),
      rowFor(STEFAN, 'revision:5', FIRST),
    ]);
    expect(await rows()).toHaveLength(4);
  });

  it('fills in a person a partial earlier write missed', async () => {
    const telemetry = recordingTelemetry();
    const audit = firestoreAuditPorts(db, telemetry);
    await audit.appendAudit([rowFor(MARIA, 'attempt:abc', FIRST)]);
    await audit.appendAudit([
      rowFor(MARIA, 'attempt:abc', FIRST),
      rowFor(STEFAN, 'attempt:abc', FIRST),
    ]);
    expect(
      (await rows()).map((row) => row.data()['targetCustomerId']).sort(),
    ).toEqual([MARIA, STEFAN]);
    expect(telemetry.lines).toEqual([]);
  });
});
