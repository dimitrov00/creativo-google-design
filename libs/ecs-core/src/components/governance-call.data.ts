import {
  ImpersonationSessionId,
  Result,
  type UserId,
  type UtcEpochMs,
} from '@core/primitives';
import { type PipelineError } from '@core/errors';
import { CallAnswer } from './call-answer.data';
import type { ImpersonationScope } from './impersonation-scope.data';
import { ImpersonationEndReason } from './end-reason-fields.data';

/**
 * THE GOVERNANCE WIRE (Phase 4a 4A-3 (4)) — `startImpersonation`: whom
 * support reads as, how far, why, until when. The server adds the caller;
 * its answer carries the read-as token the web signs in with (OR-24,
 * docs/designs/support-read-as.md).
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
    if (answer === null) return CallAnswer.unusable();
    const sessionId = CallAnswer.parsed(
      answer,
      'sessionId',
      ImpersonationSessionId.parse,
    );
    const customToken = CallAnswer.text(answer, 'customToken');
    return sessionId === null || customToken === null || customToken === ''
      ? CallAnswer.unusable()
      : Result.ok({ sessionId, customToken });
  },

  decodeEnded(raw: unknown): Result<GovernanceCall.Ended, PipelineError> {
    const answer = CallAnswer.read(raw);
    if (answer === null) return CallAnswer.unusable();
    const sessionId = CallAnswer.parsed(
      answer,
      'sessionId',
      ImpersonationSessionId.parse,
    );
    const impersonationEndReason = CallAnswer.tag(
      answer,
      'impersonationEndReason',
      ImpersonationEndReason,
    );
    return sessionId === null || impersonationEndReason === null
      ? CallAnswer.unusable()
      : Result.ok({ sessionId, impersonationEndReason });
  },
} as const;

export namespace GovernanceCall {
  /** `endImpersonation`: the session to end (the server adds the caller). */
  export type End = { readonly sessionId: ImpersonationSessionId };
  /**
   * The opened session and the token that signs in AS its target, its
   * read-as claims beside the target's own (`ReadAsClaims`). Signed by the
   * server; the web hands it to Firebase Auth and keeps it nowhere.
   */
  export type Started = {
    readonly sessionId: ImpersonationSessionId;
    readonly customToken: string;
  };
  export type Ended = {
    readonly sessionId: ImpersonationSessionId;
    readonly impersonationEndReason: ImpersonationEndReason;
  };
}
