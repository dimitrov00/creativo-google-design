import type { Firestore } from 'firebase-admin/firestore';
import { OperationId, TriggerEventId, UtcEpochMs } from '@core/primitives';
import { RepositoryErrorCode } from '@core/errors';
import { AttemptOutcome } from '@core/components';
import { Collections, type TriggerFailure } from '@core/entities';
import { unwrapOk } from '@core/testing';
import { createProjectionFirestore } from '../test-support/fake-projection-firestore';
import { firestoreTriggerFailurePorts } from './firestore-trigger-failures.adapter';

const AT = unwrapOk(UtcEpochMs.of(1_790_000_000_000));

/** One dead letter, as `TriggerAttemptSystem.triggerFailure` builds it. */
function deadLetter(id: string, recordedAtUtcMs = AT): TriggerFailure {
  return {
    id: TriggerEventId.of(id),
    fn: 'rebuildBusyOnAppointmentChange',
    documentPath: 'appointments/apt-1',
    attemptOutcome: AttemptOutcome.Permanent,
    failureCode: 'invalid-argument',
    recordedAtUtcMs,
    writeOperationId: OperationId.of('op-00000000000001'),
  };
}

/** The stored body — the entity minus its id (Law 5). */
const body = (failure: TriggerFailure): Record<string, unknown> =>
  Object.fromEntries(Object.entries(failure).filter(([key]) => key !== 'id'));

/** A db whose every `create()` rejects with `error` — the one call the adapter makes. */
const refusingDb = (error: unknown): Firestore =>
  ({
    collection: () => ({
      doc: () => ({
        create: async () => {
          throw error;
        },
      }),
    }),
  }) as unknown as Firestore;

describe('firestoreTriggerFailurePorts.writeTriggerFailure — the dead letter, created once (WS-6, RU-32)', () => {
  it('creates the dead letter at its event id, the body the flat entity minus its id', async () => {
    const fake = createProjectionFirestore();
    const answer = await firestoreTriggerFailurePorts(
      fake.db as unknown as Firestore,
    ).writeTriggerFailure(deadLetter('evt-1'));
    expect(answer).toEqual({ ok: true, value: undefined });
    expect(fake.docs.get(`${Collections.TriggerFailures}/evt-1`)).toEqual(
      body(deadLetter('evt-1')),
    );
    expect([...fake.docs.keys()]).toEqual(['triggerFailures/evt-1']);
  });

  it('is idempotent by event id: a redelivery answers success and the first record stands', async () => {
    const fake = createProjectionFirestore();
    const ports = firestoreTriggerFailurePorts(fake.db as unknown as Firestore);
    expect((await ports.writeTriggerFailure(deadLetter('evt-1'))).ok).toBe(
      true,
    );
    const later = deadLetter('evt-1', unwrapOk(UtcEpochMs.of(AT + 60_000)));
    expect(await ports.writeTriggerFailure(later)).toEqual({
      ok: true,
      value: undefined,
    });
    expect([...fake.docs.keys()]).toEqual(['triggerFailures/evt-1']);
    expect(fake.docs.get('triggerFailures/evt-1')).toEqual(
      body(deadLetter('evt-1')),
    );
  });

  it('answers any other failure as a write refusal naming the document and the canonical code — never a throw', async () => {
    const answer = await firestoreTriggerFailurePorts(
      refusingDb(Object.assign(new Error('14 UNAVAILABLE'), { code: 14 })),
    ).writeTriggerFailure(deadLetter('evt-2'));
    expect(answer).toEqual({
      ok: false,
      error: {
        errorCode: RepositoryErrorCode.WriteFailed,
        path: 'triggerFailures/evt-2',
        reason: 'unavailable',
      },
    });
    const denied = await firestoreTriggerFailurePorts(
      refusingDb({ code: 7 }),
    ).writeTriggerFailure(deadLetter('evt-3'));
    expect(denied.ok ? null : denied.error.reason).toBe('permission-denied');
  });
});
