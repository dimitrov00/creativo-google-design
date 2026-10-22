import {
  ImpersonationSessionId,
  type PipelineError,
  Result,
  type UserId,
  type UtcEpochMs,
} from '@core/primitives';
import { CallAnswer } from './call-answer.data';
import type { ImpersonationScope } from './impersonation-scope.data';
import { ImpersonationEndReason } from './impersonation-status.data';

/** Every end reason — derived, never a second source. */
const END_REASONS: readonly ImpersonationEndReason[] = Object.values(
  ImpersonationEndReason,
);

/**
 * THE GOVERNANCE WIRE (Phase 4a 4A-3 (4)) — `startImpersonation`: whom an
 * admin acts as, how far, why, until when. The server adds the caller.
 */
export type GovernanceCall = {
  readonly targetUserId: UserId;
  readonly impersonationScope: ImpersonationScope;
  readonly reason: string;
  readonly expiresAtUtcMs: UtcEpochMs;
};

export const GovernanceCall = {
  decodeStarted(raw: unknown): Result<GovernanceCall.Started, PipelineError> {
    const answer = CallAnswer.read(raw);
    const sessionId =
      answer === null
        ? null
        : CallAnswer.parsed(answer, 'sessionId', ImpersonationSessionId.parse);
    return sessionId === null
      ? CallAnswer.unusable()
      : Result.ok({ sessionId });
  },

  decodeEnded(raw: unknown): Result<GovernanceCall.Ended, PipelineError> {
    const answer = CallAnswer.read(raw);
    if (answer === null) return CallAnswer.unusable();
    const sessionId = CallAnswer.parsed(
      answer,
      'sessionId',
      ImpersonationSessionId.parse,
    );
    const impersonationEndReason = CallAnswer.oneOf(
      answer,
      'impersonationEndReason',
      END_REASONS,
    );
    return sessionId === null || impersonationEndReason === null
      ? CallAnswer.unusable()
      : Result.ok({ sessionId, impersonationEndReason });
  },
} as const;

export namespace GovernanceCall {
  /** `endImpersonation`: the session to end (the server adds the caller). */
  export type End = { readonly sessionId: ImpersonationSessionId };
  export type Started = { readonly sessionId: ImpersonationSessionId };
  export type Ended = {
    readonly sessionId: ImpersonationSessionId;
    readonly impersonationEndReason: ImpersonationEndReason;
  };
}
