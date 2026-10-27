import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import { OperationId, TriggerEventId, type UtcEpochMs } from '@core/primitives';
import { AttemptOutcome } from '@core/components';
import { Collections, type TriggerFailure } from '@core/entities';
import { utcMs } from '@core/testing';
import { firestoreTriggerFailurePorts } from './firestore-trigger-failures.adapter';

/**
 * The dead letter's exactly-once write against the REAL Firestore emulator
 * (audit-hardening WS-6, RU-32). The unit spec proves the logic over a fake
 * that throws what the author believes the SDK throws; this proves the
 * belief — that a `create()` onto an existing dead letter fails with the
 * error the adapter recognises as ALREADY_EXISTS, so a redelivery of one
 * event answers success and leaves the first record as it was.
 *
 * Emulator-only by construction, same guard as the seed.
 */
const PROJECT_ID = 'demo-functions-trigger-failures';

const EMULATOR_HOST = (process.env['FIRESTORE_EMULATOR_HOST'] ??=
  '127.0.0.1:8080');
if (!EMULATOR_HOST.includes('127.0.0.1')) {
  throw new Error('Refusing to run outside the local emulators.');
}

const FIRST = utcMs('2030-01-15T10:00:00.000+02:00');
const LATER = utcMs('2030-01-16T09:50:00.000+02:00');

/** One dead letter, as `TriggerAttemptSystem.triggerFailure` builds it. */
function deadLetter(
  eventId: string,
  recordedAtUtcMs: UtcEpochMs,
  attemptOutcome: AttemptOutcome = AttemptOutcome.Permanent,
): TriggerFailure {
  return {
    id: TriggerEventId.of(eventId),
    fn: 'dispatchClientProjections',
    documentPath: 'appointments/appt-1',
    attemptOutcome,
    failureCode:
      attemptOutcome === AttemptOutcome.Permanent
        ? 'invalid-argument'
        : 'unavailable',
    recordedAtUtcMs,
    writeOperationId: OperationId.of('op-00000000000001'),
  };
}

describe('firestoreTriggerFailurePorts.writeTriggerFailure (emulator)', () => {
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

  async function stored() {
    return (await db.collection(Collections.TriggerFailures).get()).docs;
  }

  it('creates the dead letter at its event id, the body the flat entity minus its id', async () => {
    const ports = firestoreTriggerFailurePorts(db);
    expect(await ports.writeTriggerFailure(deadLetter('evt-1', FIRST))).toEqual(
      { ok: true, value: undefined },
    );
    const docs = await stored();
    expect(docs.map((doc) => doc.id)).toEqual(['evt-1']);
    const body = Object.fromEntries(
      Object.entries(deadLetter('evt-1', FIRST)).filter(
        ([key]) => key !== 'id',
      ),
    );
    expect(docs[0]?.data()).toEqual(body);
  });

  it('writes one dead letter per event: a redelivery answers success and the first record stands', async () => {
    const ports = firestoreTriggerFailurePorts(db);
    await ports.writeTriggerFailure(
      deadLetter('evt-1', FIRST, AttemptOutcome.Transient),
    );
    expect(await ports.writeTriggerFailure(deadLetter('evt-1', LATER))).toEqual(
      { ok: true, value: undefined },
    );
    const docs = await stored();
    expect(docs).toHaveLength(1);
    expect(docs[0]?.data()).toMatchObject({
      recordedAtUtcMs: FIRST,
      attemptOutcome: AttemptOutcome.Transient,
    });
  });

  it('keeps distinct events apart', async () => {
    const ports = firestoreTriggerFailurePorts(db);
    await ports.writeTriggerFailure(deadLetter('evt-1', FIRST));
    await ports.writeTriggerFailure(deadLetter('evt-2', FIRST));
    expect((await stored()).map((doc) => doc.id).sort()).toEqual([
      'evt-1',
      'evt-2',
    ]);
  });
});
