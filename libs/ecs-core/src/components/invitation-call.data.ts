import { InvitationId, type PipelineError, Result } from '@core/primitives';
import { CallAnswer } from './call-answer.data';

/** THE INVITATION WIRE (Phase 4a, F3-2) — `redeemInvitation`: which invitation the caller redeems. */
export type InvitationCall = {
  readonly invitationId: InvitationId;
};

export const InvitationCall = {
  decodeRedeemed(raw: unknown): Result<InvitationCall.Redeemed, PipelineError> {
    const answer = CallAnswer.read(raw);
    if (answer === null) return CallAnswer.unusable();
    const invitationId = CallAnswer.parsed(
      answer,
      'invitationId',
      InvitationId.parse,
    );
    const redemptionCount = CallAnswer.whole(answer, 'redemptionCount', 1);
    return invitationId === null || redemptionCount === null
      ? CallAnswer.unusable()
      : Result.ok({ invitationId, redemptionCount });
  },
} as const;

export namespace InvitationCall {
  export type Redeemed = {
    readonly invitationId: InvitationId;
    /** The invitation's count after this redemption. */
    readonly redemptionCount: number;
  };
}
