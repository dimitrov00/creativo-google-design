import {
  LocalDate,
  type PipelineError,
  type PublishRequestId,
  Result,
  type StreakDefinitionId,
  StreakPublishError,
  StreakPublishErrorCode,
} from '@core/primitives';
import { CallAnswer } from './call-answer.data';
import {
  type StreakRule,
  StreakRuleDirection,
  type StreakTransition,
} from './streak-rule.data';

/**
 * What a publish call was answered — the field `streakPublishOutcome`, the
 * ONLY source of these strings (Phase 4a 4A-4: the lowercase `kind`
 * `published` / `withdrawn` / `refused` of the frozen wire).
 */
export const StreakPublishOutcome = {
  Published: 'PUBLISHED',
  Withdrawn: 'WITHDRAWN',
  /** A judgement of the rule — an ordinary answer, never a throw. */
  Refused: 'REFUSED',
} as const;
export type StreakPublishOutcome =
  (typeof StreakPublishOutcome)[keyof typeof StreakPublishOutcome];

/** The refusals the callable ANSWERS (its faults it throws). */
const ANSWERED_CODES: readonly StreakPublishCall.AnsweredCode[] = [
  StreakPublishErrorCode.CallerNotAdmin,
  StreakPublishErrorCode.Stale,
  StreakPublishErrorCode.Invalid,
  StreakPublishErrorCode.TooEarly,
  StreakPublishErrorCode.RecomputeNeedsEngine,
  StreakPublishErrorCode.PreviewStale,
];
const DIRECTIONS: readonly StreakRuleDirection[] =
  Object.values(StreakRuleDirection);

/** A day field holds a day, or nothing (`null`/absent) — never anything else. */
function dayFieldOk(answer: CallAnswer, name: string): boolean {
  const raw = CallAnswer.field(answer, name);
  return (
    raw === null ||
    raw === undefined ||
    (typeof raw === 'string' && LocalDate.parse(raw).ok)
  );
}

/** A day field's day, `null` when it holds none (check {@link dayFieldOk} first). */
function dayFieldOf(answer: CallAnswer, name: string): LocalDate | null {
  return CallAnswer.parsed(answer, name, LocalDate.parse);
}

/**
 * A publish of the rhythm's rule as the admin page SENDS it — the argument
 * of the gateway's `PublishStreakRule` port and the shape the publish
 * system judges (flip-3 plan §3.1.1). A component, never a ports-tier or
 * pipeline-tier type, so the system that judges a call and builds its
 * receipt may name it (Law 8.2).
 *
 * `rule` is the rule AS PROPOSED — its `version` the proposal
 * `baseVersion + 1`, its `effectiveFromLocalDate` the day asked — carried
 * whole: a call is a request in flight, never a stored document, and the
 * rule is the one value `StreakRule.parse` answers and the publish judges
 * (the version document it becomes stores it flat at its root).
 * `baseVersion` is the head's version the draft was made against (0 for a
 * rhythm nothing was published under); `requestId` the intent, so a retry
 * answers the first receipt and writes nothing; `previewHash` the preview
 * the admin saw, `null` when none was shown.
 */
export type StreakPublishCall = {
  readonly requestId: PublishRequestId;
  readonly streakId: StreakDefinitionId;
  readonly baseVersion: number;
  readonly rule: StreakRule;
  readonly streakTransition: StreakTransition;
  readonly previewHash: string | null;
};

export const StreakPublishCall = {
  /** A call to withdraw the version that waits for its day — `version` names it. */
  withdraw(
    requestId: PublishRequestId,
    streakId: StreakDefinitionId,
    version: number,
  ): StreakPublishCall.Withdraw {
    return { requestId, streakId, version };
  },

  /**
   * What a landed publish answers: the version it made, the day it starts
   * judging by, and whom the change favoured against the version before it.
   * A replayed publish answers the ORIGINAL receipt.
   */
  receipt(
    version: number,
    effectiveFromLocalDate: LocalDate,
    streakRuleDirection: StreakRuleDirection,
  ): StreakPublishCall.Receipt {
    return { version, effectiveFromLocalDate, streakRuleDirection };
  },

  /* ── the answer (the server encodes, the web decodes) ── */

  published(receipt: StreakPublishCall.Receipt): StreakPublishCall.Published {
    return { streakPublishOutcome: StreakPublishOutcome.Published, ...receipt };
  },

  withdrawn(version: number): StreakPublishCall.Withdrawn {
    return { streakPublishOutcome: StreakPublishOutcome.Withdrawn, version };
  },

  /**
   * An answered refusal, projected flat: its code, the rule fields an
   * `INVALID` names (`[]` otherwise), and a `TOO_EARLY`'s two days (`null`
   * otherwise) — never the legacy nested locators.
   */
  refused(error: StreakPublishCall.AnsweredError): StreakPublishCall.Refused {
    return {
      streakPublishOutcome: StreakPublishOutcome.Refused,
      errorCode: error.errorCode,
      fields:
        error.errorCode === StreakPublishErrorCode.Invalid ? error.fields : [],
      earliest:
        error.errorCode === StreakPublishErrorCode.TooEarly
          ? error.earliest
          : null,
      effectiveFromLocalDate:
        error.errorCode === StreakPublishErrorCode.TooEarly
          ? error.effectiveFromLocalDate
          : null,
    };
  },

  /**
   * The refusal an answer names, rebuilt as the publish's own struct — as
   * the frozen wire's web half did: a `STALE` restates the version the call
   * named (the answer names no head), a `TOO_EARLY` without a day the
   * answer vouches for falls back to the day the publish asked for; a
   * withdrawal asks none, so such an answer is no answer at all (`null`).
   */
  refusalOf(
    refused: StreakPublishCall.Refused,
    askedVersion: number,
    askedDay: LocalDate | null,
  ): StreakPublishError | null {
    switch (refused.errorCode) {
      case StreakPublishErrorCode.CallerNotAdmin:
        return StreakPublishError.callerNotAdmin();
      case StreakPublishErrorCode.Invalid:
        return StreakPublishError.invalid(refused.fields);
      case StreakPublishErrorCode.Stale:
        return StreakPublishError.stale(askedVersion, askedVersion);
      case StreakPublishErrorCode.TooEarly: {
        const earliest = refused.earliest ?? askedDay;
        return earliest === null
          ? null
          : StreakPublishError.tooEarly(askedDay ?? earliest, earliest);
      }
      case StreakPublishErrorCode.RecomputeNeedsEngine:
        return StreakPublishError.recomputeNeedsEngine();
      case StreakPublishErrorCode.PreviewStale:
        return StreakPublishError.previewStale();
    }
  },

  /** `publishStreakDefinition`'s answer, or `PIPELINE_UNKNOWN` when it is none the call knows. */
  decodeAnswer(raw: unknown): Result<StreakPublishCall.Answer, PipelineError> {
    const answer = CallAnswer.read(raw);
    if (answer === null) return CallAnswer.unusable();
    switch (CallAnswer.field(answer, 'streakPublishOutcome')) {
      case StreakPublishOutcome.Published: {
        const version = CallAnswer.whole(answer, 'version', 1);
        const day = dayFieldOf(answer, 'effectiveFromLocalDate');
        const direction = CallAnswer.oneOf(
          answer,
          'streakRuleDirection',
          DIRECTIONS,
        );
        return version === null || day === null || direction === null
          ? CallAnswer.unusable()
          : Result.ok(
              StreakPublishCall.published(
                StreakPublishCall.receipt(version, day, direction),
              ),
            );
      }
      case StreakPublishOutcome.Withdrawn: {
        const version = CallAnswer.whole(answer, 'version', 1);
        return version === null
          ? CallAnswer.unusable()
          : Result.ok(StreakPublishCall.withdrawn(version));
      }
      case StreakPublishOutcome.Refused: {
        const errorCode = CallAnswer.oneOf(answer, 'errorCode', ANSWERED_CODES);
        const rawFields = CallAnswer.field(answer, 'fields');
        if (
          errorCode === null ||
          !Array.isArray(rawFields) ||
          !dayFieldOk(answer, 'earliest') ||
          !dayFieldOk(answer, 'effectiveFromLocalDate')
        ) {
          return CallAnswer.unusable();
        }
        const earliest = dayFieldOf(answer, 'earliest');
        const asked = dayFieldOf(answer, 'effectiveFromLocalDate');
        const fields: string[] = [];
        for (const field of rawFields as readonly unknown[]) {
          if (typeof field === 'string') fields.push(field);
        }
        return Result.ok({
          streakPublishOutcome: StreakPublishOutcome.Refused,
          errorCode,
          fields,
          earliest,
          effectiveFromLocalDate: asked,
        });
      }
      default:
        return CallAnswer.unusable();
    }
  },
} as const;

export namespace StreakPublishCall {
  /** A withdrawal of the waiting version — the gateway's `WithdrawStreakRule` argument. */
  export type Withdraw = {
    readonly requestId: PublishRequestId;
    readonly streakId: StreakDefinitionId;
    readonly version: number;
  };
  /** A landed publish's answer — the gateway's and the pipeline's. */
  export type Receipt = {
    readonly version: number;
    readonly effectiveFromLocalDate: LocalDate;
    readonly streakRuleDirection: StreakRuleDirection;
  };

  /** The refusals the callable answers rather than throws. */
  export type AnsweredCode =
    | typeof StreakPublishErrorCode.CallerNotAdmin
    | typeof StreakPublishErrorCode.Stale
    | typeof StreakPublishErrorCode.Invalid
    | typeof StreakPublishErrorCode.TooEarly
    | typeof StreakPublishErrorCode.RecomputeNeedsEngine
    | typeof StreakPublishErrorCode.PreviewStale;
  export type AnsweredError = Extract<
    StreakPublishError,
    { readonly errorCode: AnsweredCode }
  >;

  /** What the callable answers — a receipt, a withdrawal, or a judgement. */
  export type Answer = Published | Withdrawn | Refused;
  export type Published = {
    readonly streakPublishOutcome: typeof StreakPublishOutcome.Published;
  } & Receipt;
  export type Withdrawn = {
    readonly streakPublishOutcome: typeof StreakPublishOutcome.Withdrawn;
    /** The version the withdrawal called off. */
    readonly version: number;
  };
  export type Refused = {
    readonly streakPublishOutcome: typeof StreakPublishOutcome.Refused;
    readonly errorCode: AnsweredCode;
    /** An `INVALID`'s flat rule fields at fault (`StreakRuleField`), else `[]`. */
    readonly fields: readonly string[];
    /** A `TOO_EARLY`'s first day the change may start, else `null`. */
    readonly earliest: LocalDate | null;
    /** A `TOO_EARLY`'s attempted day, else `null`. */
    readonly effectiveFromLocalDate: LocalDate | null;
  };
}
