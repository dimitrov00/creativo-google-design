/*
 * Whether a redelivery of a failed trigger attempt could help — the tag of
 * `TriggerAttemptSystem`'s verdict, logged by the edge. A tag dictionary is
 * a component (D-7); moved out of `trigger-attempt.system.ts` (pass D,
 * S-21), values unchanged.
 */

/**
 * Whether a redelivery could help — the ONLY source of these strings, the
 * field `attemptOutcome` (N15). The gRPC canonical code names a failure
 * carries (`aborted`, `already-exists`) are an external vocabulary and stay
 * as Firestore spells them (flatten-spec §0.4).
 */
export const AttemptOutcome = {
  /** A contended, overloaded or briefly absent backend: retry. */
  Transient: 'TRANSIENT',
  /** Would fail the same way for the whole retry window: log and drop. */
  Permanent: 'PERMANENT',
} as const;
export type AttemptOutcome =
  (typeof AttemptOutcome)[keyof typeof AttemptOutcome];
