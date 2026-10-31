import type { Firestore } from 'firebase-admin/firestore';
import { Result } from '@core/primitives';
import { RepositoryError } from '@core/errors';
import { Collections } from '@core/entities';
import type { TriggerFailurePorts } from '@core/ports';
import { FailureCodeSystem } from '@core/systems';
import { ALREADY_EXISTS, bodyOf, writeFailed } from './store-answer';

/**
 * The dead letter's one write (audit-hardening WS-6, RU-32 —
 * `trigger-failure.port.ts`): `triggerFailures/{eventId}`, the body the flat
 * `TriggerFailure` minus its `id` (Law 5) — `TriggerAttemptSystem` built
 * every field, so this adapter writes what it is given: no mapping, no
 * business logic, no TTL stamp (a dead letter is kept indefinitely).
 *
 * CREATED, never set: every redelivery of one event names the same
 * document, so ALREADY_EXISTS from the SAME trigger (the held record's `fn`
 * is this one's) is the answer "already recorded" — a success, and the
 * first record stands. One write is one CloudEvent for every trigger on the
 * document, so the record may instead be held by ANOTHER trigger that gave
 * up on the same event (review round 2): that is refused as a
 * `RepositoryError` with the reason `already-exists`, so `recordDeadLetter`
 * logs `trigger.failure_not_recorded` with this `fn` and event id — the key
 * stays `triggerFailures/{eventId}` (RU-31). Any other failure, the read of
 * the held record included, is answered as a `RepositoryError` value whose
 * `reason` is the canonical gRPC code name, never thrown; `retryingTrigger`
 * logs it and changes nothing else.
 */

export const firestoreTriggerFailurePorts = (
  db: Firestore,
): TriggerFailurePorts => ({
  writeTriggerFailure: async (failure) => {
    const path = `${Collections.TriggerFailures}/${failure.id}`;
    try {
      const ref = db.collection(Collections.TriggerFailures).doc(failure.id);
      const code = await ref.create(bodyOf(failure)).then(
        () => null,
        (error: unknown) => FailureCodeSystem.codeOf(error),
      );
      if (code === null) return Result.ok(undefined);
      if (code !== ALREADY_EXISTS) {
        return Result.err(RepositoryError.writeFailed(path, code));
      }
      const held = await ref.get();
      return held.get('fn') === failure.fn
        ? Result.ok(undefined)
        : Result.err(RepositoryError.writeFailed(path, ALREADY_EXISTS));
    } catch (error) {
      return Result.err(writeFailed(path, error));
    }
  },
});
