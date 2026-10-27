import type { RepositoryError } from '@core/errors';
import type { TriggerFailure } from '@core/entities';
import type { Result } from '@core/primitives';

/*
 * The dead letter (audit-hardening WS-6, RU-32): a retrying trigger that
 * gives up on a delivery — a PERMANENT failure, or a TRANSIENT one in the
 * last stretch of the 24 h retry window (`TriggerAttemptSystem.deadLetter`)
 * — records it once, after its attempt line, at
 * `triggerFailures/{eventId}`. Written by `retryingTrigger` (the functions
 * edge) through this port; implemented by
 * `apps/functions/src/adapters/firestore-trigger-failures.adapter.ts`.
 */

/**
 * Creates the dead letter at its event id — idempotent: a redelivery of the
 * same event finds the document there and answers success (the first
 * record stands). Any other failure is answered as a `RepositoryError`
 * value, never thrown; the caller logs it and changes nothing else.
 */
export type WriteTriggerFailure = (
  failure: TriggerFailure,
) => Promise<Result<void, RepositoryError>>;

/** The dead-letter writer — `firestoreTriggerFailurePorts(db)`. */
export type TriggerFailurePorts = {
  readonly writeTriggerFailure: WriteTriggerFailure;
};
