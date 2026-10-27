import type { DocumentData, Firestore } from 'firebase-admin/firestore';
import { Result } from '@core/primitives';
import { RepositoryError } from '@core/errors';
import { Collections, type TriggerFailure } from '@core/entities';
import type { TriggerFailurePorts } from '@core/ports';
import { TriggerAttemptSystem } from '@core/systems';

/**
 * The dead letter's one write (audit-hardening WS-6, RU-32 —
 * `trigger-failure.port.ts`): `triggerFailures/{eventId}`, the body the flat
 * `TriggerFailure` minus its `id` (Law 5) — `TriggerAttemptSystem` built
 * every field, so this adapter writes what it is given: no mapping, no
 * business logic, no TTL stamp (a dead letter is kept indefinitely).
 *
 * CREATED, never set: every redelivery of one event names the same
 * document, so ALREADY_EXISTS is the answer "already recorded" — a success,
 * and the first record stands. Any other failure is answered as a
 * `RepositoryError` value whose `reason` is the canonical gRPC code name,
 * never thrown; `retryingTrigger` logs it and changes nothing else.
 */

/** Firestore's canonical name for gRPC 6, as `TriggerAttemptSystem.failureCode` reads it. */
const ALREADY_EXISTS = 'already-exists';

/** The stored body of a dead letter — the entity minus its id (Law 5). */
function bodyOf(failure: TriggerFailure): DocumentData {
  return Object.fromEntries(
    Object.entries(failure).filter(([key]) => key !== 'id'),
  );
}

export const firestoreTriggerFailurePorts = (
  db: Firestore,
): TriggerFailurePorts => ({
  writeTriggerFailure: async (failure) => {
    try {
      await db
        .collection(Collections.TriggerFailures)
        .doc(failure.id)
        .create(bodyOf(failure));
      return Result.ok(undefined);
    } catch (error) {
      const code = TriggerAttemptSystem.failureCode(error);
      return code === ALREADY_EXISTS
        ? Result.ok(undefined)
        : Result.err(
            RepositoryError.writeFailed(
              `${Collections.TriggerFailures}/${failure.id}`,
              code,
            ),
          );
    }
  },
});
