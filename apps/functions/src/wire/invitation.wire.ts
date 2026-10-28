import { InvitationId, Result } from '@core/primitives';
import { EngagementError } from '@core/errors';
import type { RedeemInvitationCommand } from '@core/pipelines';
import type { EdgeError } from '../edge';
import { callerUserId } from '../lib/booking/caller-roles';
import { field, payloadOf, type WireRequest } from './wire-read';

/**
 * THE `redeemInvitation` CALLABLE'S WIRE (flip-3 plan F3-2, Phase 4a
 * 4A-3 (5)) — new with the rules tightening that took the client's direct
 * create/update away: the request is the call component `InvitationCall`
 * (`{ invitationId }`), the answer `InvitationCall.Redeemed`
 * (`{ invitationId, redemptionCount }`) — the pipeline's own, wired as it
 * is — and a refusal its ecs-core struct (`refusalOf`). The
 * referee is the VERIFIED caller, read FIRST (no session →
 * `ENGAGEMENT_INVITATION_UNAUTHENTICATED`). No web caller exists yet.
 */

export function decodeRedeemInvitation(
  request: WireRequest,
): Result<RedeemInvitationCommand, EdgeError> {
  const referee = callerUserId(request);
  if (referee === null) {
    return Result.err(EngagementError.invitationUnauthenticated());
  }
  // Anything that is no string reads as none — never `String`-coerced into an id.
  const raw = field(payloadOf(request), 'invitationId');
  const invitationId = InvitationId.parse(typeof raw === 'string' ? raw : '');
  if (!invitationId.ok) return Result.err(invitationId.error);
  return Result.ok({
    invitationId: invitationId.value,
    refereeUserId: referee,
  });
}
