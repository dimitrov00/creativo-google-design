import type { AttemptOutcome, WriteProvenance } from '@core/components';
import type { TriggerEventId, UtcEpochMs } from '@core/primitives';

/**
 * The identity slice of a dead letter (audit-hardening WS-6, RU-31): which
 * retrying trigger gave up on which delivery, how the failure was judged and
 * when it was recorded. `id` IS the event id — the document id
 * (`triggerFailures/{eventId}`, Law 5: the body is the entity minus `id`) —
 * so every redelivery of one event names the same document and the dead
 * letter is written once (the adapter's `create()`, ALREADY_EXISTS a
 * success).
 */
export type TriggerFailureMeta = {
  readonly id: TriggerEventId;
  /** The export's name — the `fn` of the attempt line it follows. */
  readonly fn: string;
  /**
   * The written document's path (`appointments/<id>`) — ids only, never a
   * body — or `null` for a delivery that names none (a schedule tick).
   */
  readonly documentPath: string | null;
  readonly attemptOutcome: AttemptOutcome;
  /**
   * The failure's canonical gRPC code name as `TriggerAttemptSystem` judged
   * it (`unavailable`, `invalid-argument`, `data-loss`, …) — an external
   * vocabulary, never an `errorCode` of ours.
   */
  readonly failureCode: string;
  readonly recordedAtUtcMs: UtcEpochMs;
};

/**
 * A trigger delivery no redelivery will fix — `triggerFailures/{eventId}`,
 * flat (Law 6): the meta slice and the operation id the written document
 * carried (`WriteProvenance`, WS-4.3 — the join back to the callable whose
 * write woke the trigger, `null` when none). Written by `retryingTrigger`
 * through `TriggerFailurePorts.writeTriggerFailure` (RU-32) after the
 * attempt line, on a PERMANENT failure or on a TRANSIENT one in the last
 * stretch of the 24 h retry window (`TriggerAttemptSystem.deadLetter`).
 * Admin-read in the rules, written by no client, never TTL'd.
 */
export type TriggerFailure = TriggerFailureMeta & WriteProvenance;
