import type { LocalDate } from '@core/primitives';
import type { RepositoryError } from './repository.error';

/**
 * The refusal codes of the rhythm rule's publish callable
 * (`publishStreakDefinition`) — flat `{ errorCode, … }` structs (Law 7.5),
 * SCREAMING_SNAKE under the `LOYALTY_STREAK_PUBLISH_` prefix (flatten-spec
 * §4.2); since the Phase 4a wire flip the callable answers these codes
 * themselves (no legacy dotted code on the wire). Every non-`errorCode`
 * field is an i18n parameter.
 *
 * The two `CALLER_*` codes judge WHO asks (the verified token, never the
 * payload) before anything is read; the callable never lets either reach
 * the wire as itself — it answers today's `unauthenticated` fault and the
 * `notAdmin` refusal (flip-3 plan F3-4).
 */
export const StreakPublishErrorCode = {
  /** The request carries no signed-in account. */
  CallerUnauthenticated: 'LOYALTY_STREAK_PUBLISH_CALLER_UNAUTHENTICATED',
  /** The signed-in account manages no shop: only an admin publishes the rule. */
  CallerNotAdmin: 'LOYALTY_STREAK_PUBLISH_CALLER_NOT_ADMIN',
  /** The head moved since the draft was made, or what is to be called off no longer waits. */
  Stale: 'LOYALTY_STREAK_PUBLISH_STALE',
  /** The draft is no rule, or the head it would make would not stand. */
  Invalid: 'LOYALTY_STREAK_PUBLISH_INVALID',
  /** The change may not start on the day asked. */
  TooEarly: 'LOYALTY_STREAK_PUBLISH_TOO_EARLY',
  /** A recompute needs the rhythm engine, which does not exist yet. */
  RecomputeNeedsEngine: 'LOYALTY_STREAK_PUBLISH_RECOMPUTE_NEEDS_ENGINE',
  /** The publish names a preview nobody can vouch for. */
  PreviewStale: 'LOYALTY_STREAK_PUBLISH_PREVIEW_STALE',
  /** The envelope could not be read — `field` names the payload field (was `loyalty.streak_publish.invalid_input`). */
  InvalidInput: 'LOYALTY_STREAK_PUBLISH_INVALID_INPUT',
  /** The write fell over — the cause in the log only (was `loyalty.streak_publish.store_failed`). */
  StoreFailed: 'LOYALTY_STREAK_PUBLISH_STORE_FAILED',
} as const;
export type StreakPublishErrorCode =
  (typeof StreakPublishErrorCode)[keyof typeof StreakPublishErrorCode];

/**
 * The refusals the callable ANSWERS rather than throws — spelled ONCE here
 * and read by the call's codec (`StreakPublishCall`), the edge's wire and
 * its spec: the five rule refusals and `CALLER_NOT_ADMIN`. A missing caller
 * (`CALLER_UNAUTHENTICATED`), an envelope the callable cannot read
 * (`INVALID_INPUT`) and a write that fell over (`STORE_FAILED`) are thrown.
 */
export type StreakPublishAnsweredCode =
  | typeof StreakPublishErrorCode.CallerNotAdmin
  | typeof StreakPublishErrorCode.Stale
  | typeof StreakPublishErrorCode.Invalid
  | typeof StreakPublishErrorCode.TooEarly
  | typeof StreakPublishErrorCode.RecomputeNeedsEngine
  | typeof StreakPublishErrorCode.PreviewStale;

/** {@link StreakPublishAnsweredCode}, in dictionary order — the one list. */
const ANSWERED_CODES: readonly StreakPublishAnsweredCode[] = [
  StreakPublishErrorCode.CallerNotAdmin,
  StreakPublishErrorCode.Stale,
  StreakPublishErrorCode.Invalid,
  StreakPublishErrorCode.TooEarly,
  StreakPublishErrorCode.RecomputeNeedsEngine,
  StreakPublishErrorCode.PreviewStale,
];

/**
 * The codes of the {@link StreakPublishError} union, dictionary order — the
 * answered ones and the missing caller; never `INVALID_INPUT` or
 * `STORE_FAILED`, which the union does not hold (they are the edge's
 * {@link StreakPublishError.Failure}). {@link StreakPublishError.guard}'s
 * table (scanned; no `new` in a data file, Law 1).
 */
const REFUSAL_CODES: readonly StreakPublishError['errorCode'][] = [
  StreakPublishErrorCode.CallerUnauthenticated,
  ...ANSWERED_CODES,
];

export type StreakPublishError =
  | StreakPublishError.CallerUnauthenticated
  | StreakPublishError.CallerNotAdmin
  | StreakPublishError.Stale
  | StreakPublishError.Invalid
  | StreakPublishError.TooEarly
  | StreakPublishError.RecomputeNeedsEngine
  | StreakPublishError.PreviewStale;

export const StreakPublishError = {
  callerUnauthenticated(): StreakPublishError.CallerUnauthenticated {
    return { errorCode: StreakPublishErrorCode.CallerUnauthenticated };
  },
  callerNotAdmin(): StreakPublishError.CallerNotAdmin {
    return { errorCode: StreakPublishErrorCode.CallerNotAdmin };
  },
  stale(expected: number, actual: number): StreakPublishError.Stale {
    return { errorCode: StreakPublishErrorCode.Stale, expected, actual };
  },
  invalid(fields: readonly string[]): StreakPublishError.Invalid {
    return { errorCode: StreakPublishErrorCode.Invalid, fields };
  },
  tooEarly(
    effectiveFromLocalDate: LocalDate,
    earliest: LocalDate,
  ): StreakPublishError.TooEarly {
    return {
      errorCode: StreakPublishErrorCode.TooEarly,
      effectiveFromLocalDate,
      earliest,
    };
  },
  recomputeNeedsEngine(): StreakPublishError.RecomputeNeedsEngine {
    return { errorCode: StreakPublishErrorCode.RecomputeNeedsEngine };
  },
  previewStale(): StreakPublishError.PreviewStale {
    return { errorCode: StreakPublishErrorCode.PreviewStale };
  },
  invalidInput(field: string): StreakPublishError.InvalidInput {
    return { errorCode: StreakPublishErrorCode.InvalidInput, field };
  },
  storeFailed(): StreakPublishError.StoreFailed {
    return { errorCode: StreakPublishErrorCode.StoreFailed };
  },

  /** The refusals the callable answers ({@link StreakPublishAnsweredCode}), dictionary order. */
  ANSWERED_CODES,

  /** A refusal the callable answers rather than throws. */
  isAnswered(
    failure: StreakPublishError.Failure,
  ): failure is StreakPublishError.Answered {
    return (ANSWERED_CODES as readonly string[]).includes(failure.errorCode);
  },

  /**
   * The publish's no (the server's, or the page's own judgement before
   * anything is sent), as against a request that got no answer (a
   * `RepositoryError`): every code of the {@link StreakPublishError} union —
   * never only the callable's answered subset
   * ({@link StreakPublishAnsweredCode}), so a refusal the page itself words
   * routes exactly as the server's — and nothing outside it: the edge's
   * thrown `INVALID_INPUT` and `STORE_FAILED` are no refusal of the rule
   * (pass D: the guard narrows to exactly the union it names).
   */
  guard(error: { readonly errorCode: string }): error is StreakPublishError {
    return (REFUSAL_CODES as readonly string[]).includes(error.errorCode);
  },
} as const;

/**
 * Why the server's publish pipeline (`publishStreakDefinition`) wrote
 * nothing: a refusal of the rule or the caller, or a store that failed.
 */
export type PublishStreakDefinitionError = StreakPublishError | RepositoryError;

/**
 * Why the admin page's publish or withdrawal (`rhythm-publish.pipeline.ts`)
 * landed nothing — the same set as the server pipeline's: a refusal the
 * page words, or a request that got no answer (`RepositoryError`), told
 * apart by {@link StreakPublishError.guard}.
 */
export type RhythmPublishRefusal = PublishStreakDefinitionError;

export namespace StreakPublishError {
  /** A refusal the callable answers rather than throws. */
  export type Answered = Extract<
    StreakPublishError,
    { readonly errorCode: StreakPublishAnsweredCode }
  >;
  /**
   * Every way a publish request is not written, as the edge meets it: a
   * refusal, an envelope it cannot read, or a store failure.
   */
  export type Failure = StreakPublishError | InvalidInput | RepositoryError;
  export type CallerUnauthenticated = {
    readonly errorCode: typeof StreakPublishErrorCode.CallerUnauthenticated;
  };
  export type CallerNotAdmin = {
    readonly errorCode: typeof StreakPublishErrorCode.CallerNotAdmin;
  };
  export type Stale = {
    readonly errorCode: typeof StreakPublishErrorCode.Stale;
    /** The version the request names. */
    readonly expected: number;
    /** The version the head holds (0 for none). */
    readonly actual: number;
  };
  export type Invalid = {
    readonly errorCode: typeof StreakPublishErrorCode.Invalid;
    /** The flat fields of the rule at fault (`StreakRuleField`), each once, in the rule's order. */
    readonly fields: readonly string[];
  };
  export type TooEarly = {
    readonly errorCode: typeof StreakPublishErrorCode.TooEarly;
    readonly effectiveFromLocalDate: LocalDate;
    readonly earliest: LocalDate;
  };
  export type RecomputeNeedsEngine = {
    readonly errorCode: typeof StreakPublishErrorCode.RecomputeNeedsEngine;
  };
  export type PreviewStale = {
    readonly errorCode: typeof StreakPublishErrorCode.PreviewStale;
  };
  export type InvalidInput = {
    readonly errorCode: typeof StreakPublishErrorCode.InvalidInput;
    /** The payload field that was missing or malformed. */
    readonly field: string;
  };
  export type StoreFailed = {
    readonly errorCode: typeof StreakPublishErrorCode.StoreFailed;
  };
}
