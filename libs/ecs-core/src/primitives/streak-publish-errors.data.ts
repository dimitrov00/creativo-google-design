import type { LocalDate } from './local-date.primitive';

/**
 * The refusal codes of the rhythm rule's publish callable
 * (`publishStreakDefinition`) — flat `{ errorCode, … }` structs (Law 7.5),
 * SCREAMING_SNAKE under the `LOYALTY_STREAK_PUBLISH_` prefix (flatten-spec
 * §4.2); the callable's answer keeps the legacy dotted code on the wire
 * until Phase 4. Every non-`errorCode` field is an i18n parameter.
 */
export const StreakPublishErrorCode = {
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
} as const;
export type StreakPublishErrorCode =
  (typeof StreakPublishErrorCode)[keyof typeof StreakPublishErrorCode];

export type StreakPublishError =
  | StreakPublishError.Stale
  | StreakPublishError.Invalid
  | StreakPublishError.TooEarly
  | StreakPublishError.RecomputeNeedsEngine
  | StreakPublishError.PreviewStale;

export const StreakPublishError = {
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
} as const;

export namespace StreakPublishError {
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
}
