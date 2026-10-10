import type { DayKey } from './day-key.data';

/**
 * The refusal codes of the rhythm rule's publish callable
 * (`publishStreakDefinition`) — the server's words, unchanged. Every
 * non-`code` field is an i18n parameter.
 */
export const StreakPublishErrorCode = {
  /** The head moved since the draft was made, or what is to be called off no longer waits. */
  Stale: 'loyalty.streak_publish.stale',
  /** The draft is no rule, or the head it would make would not stand. */
  Invalid: 'loyalty.streak_publish.invalid',
  /** The change may not start on the day asked. */
  TooEarly: 'loyalty.streak_publish.too_early',
  /** A recompute needs the rhythm engine, which does not exist yet. */
  RecomputeNeedsEngine: 'loyalty.streak_publish.recompute_needs_engine',
  /** The publish names a preview nobody can vouch for. */
  PreviewStale: 'loyalty.streak_publish.preview_stale',
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
    return { code: StreakPublishErrorCode.Stale, expected, actual };
  },
  invalid(fields: readonly string[]): StreakPublishError.Invalid {
    return { code: StreakPublishErrorCode.Invalid, fields };
  },
  tooEarly(
    effectiveFromDayKey: DayKey,
    earliest: DayKey,
  ): StreakPublishError.TooEarly {
    return {
      code: StreakPublishErrorCode.TooEarly,
      effectiveFromDayKey,
      earliest,
    };
  },
  recomputeNeedsEngine(): StreakPublishError.RecomputeNeedsEngine {
    return { code: StreakPublishErrorCode.RecomputeNeedsEngine };
  },
  previewStale(): StreakPublishError.PreviewStale {
    return { code: StreakPublishErrorCode.PreviewStale };
  },
} as const;

export namespace StreakPublishError {
  export type Stale = {
    readonly code: typeof StreakPublishErrorCode.Stale;
    /** The version the request names. */
    readonly expected: number;
    /** The version the head holds (0 for none). */
    readonly actual: number;
  };
  export type Invalid = {
    readonly code: typeof StreakPublishErrorCode.Invalid;
    /** The paths into the rule at fault, each once, in the rule's order. */
    readonly fields: readonly string[];
  };
  export type TooEarly = {
    readonly code: typeof StreakPublishErrorCode.TooEarly;
    readonly effectiveFromDayKey: DayKey;
    readonly earliest: DayKey;
  };
  export type RecomputeNeedsEngine = {
    readonly code: typeof StreakPublishErrorCode.RecomputeNeedsEngine;
  };
  export type PreviewStale = {
    readonly code: typeof StreakPublishErrorCode.PreviewStale;
  };
}
