import { type InvitationCall, WriteOp } from '@core/components';
import { type InvitationId, Result, type UserId } from '@core/primitives';
import {
  EngagementError,
  type RepositoryError,
  RepositoryErrorCode,
} from '@core/errors';
import {
  Collections,
  type Invitation,
  type InvitationRedemption,
  Subcollections,
} from '@core/entities';
import type { ClockPorts, CommitPorts, TelemetryPorts } from '@core/ports';
import { ReferralSystem } from '@core/systems';

/**
 * `redeemInvitation` — a signed-in user redeems an invitation (flip-3 plan
 * F3-2; Phase 4a 4A-3 (5)). Since Phase 4a the callable is the ONLY writer
 * of an invitation's count and its redemptions (the rules refuse every
 * client create and update). The referee is the VERIFIED caller, never the
 * payload: no caller → `ENGAGEMENT_INVITATION_UNAUTHENTICATED`, before any
 * read.
 *
 * ONE transaction reads `invitations/{id}` and the caller's redemption
 * `invitations/{id}/redemptions/{refereeUserId}`: no invitation →
 * `ENGAGEMENT_INVITATION_NOT_FOUND`; a redemption already there →
 * `ENGAGEMENT_INVITATION_ALREADY_REDEEMED` (its existence alone prevents a
 * second — the rule the redemption id has always kept); then
 * `ReferralSystem.redeem` (the inviter themself →
 * `ENGAGEMENT_INVITATION_SELF_REDEMPTION`) and ONE plan: the redemption's
 * `Create` and the invitation's `redemptionCount` `Update`. A lost create
 * race is the same answer as the read: already redeemed.
 */

export type RedeemInvitationPorts = CommitPorts & ClockPorts & TelemetryPorts;

/** The call (`InvitationCall`) & the verified caller — never the payload's. */
export type RedeemInvitationCommand = InvitationCall & {
  /** The verified session's uid; `null` without one. */
  readonly refereeUserId: UserId | null;
};

export type RedeemInvitationError = EngagementError | RepositoryError;

/** What the transaction read. */
type Snapshot = {
  readonly invitation: Invitation | null;
  readonly redemption: InvitationRedemption | null;
};

/** Where an invitation lives. */
function invitationPath(invitationId: InvitationId): readonly string[] {
  return [Collections.Invitations, invitationId];
}

/** Where one referee's redemption of it lives — its id IS the referee. */
function redemptionPath(
  invitationId: InvitationId,
  refereeUserId: UserId,
): readonly string[] {
  return [
    ...invitationPath(invitationId),
    Subcollections.Redemptions,
    refereeUserId,
  ];
}

export const redeemInvitation =
  (ports: RedeemInvitationPorts) =>
  async (
    cmd: RedeemInvitationCommand,
  ): Promise<Result<InvitationCall.Redeemed, RedeemInvitationError>> => {
    const referee = cmd.refereeUserId;
    if (referee === null) {
      return Result.err(EngagementError.invitationUnauthenticated());
    }
    // Read once, before the transaction: `decide` may run more than once.
    const nowUtcMs = ports.nowUtcMs();
    const invitationAt = invitationPath(cmd.invitationId);
    const redemptionAt = redemptionPath(cmd.invitationId, referee);
    const committed = await ports.commit(
      async (tx): Promise<Snapshot> => {
        const [invitation, redemption] = await Promise.all([
          tx.get<Invitation>(invitationAt),
          tx.get<InvitationRedemption>(redemptionAt),
        ]);
        return { invitation, redemption };
      },
      (
        snapshot,
      ): Result<
        InvitationCall.Redeemed & { readonly writes: readonly WriteOp[] },
        EngagementError
      > => {
        if (snapshot.invitation === null) {
          return Result.err(
            EngagementError.invitationNotFound(cmd.invitationId),
          );
        }
        if (snapshot.redemption !== null) {
          return Result.err(
            EngagementError.invitationAlreadyRedeemed(cmd.invitationId),
          );
        }
        const redeemed = ReferralSystem.redeem(
          snapshot.invitation,
          referee,
          nowUtcMs,
        );
        if (!redeemed.ok) return redeemed;
        const { invitation, redemption } = redeemed.value;
        return Result.ok({
          invitationId: cmd.invitationId,
          redemptionCount: invitation.redemptionCount,
          writes: [
            WriteOp.create(redemptionAt, {
              redeemedAtUtcMs: redemption.redeemedAtUtcMs,
            }),
            WriteOp.update(invitationAt, {
              redemptionCount: invitation.redemptionCount,
            }),
          ],
        });
      },
    );
    if (!committed.ok) {
      const error =
        committed.error.errorCode === RepositoryErrorCode.AlreadyExists
          ? EngagementError.invitationAlreadyRedeemed(cmd.invitationId)
          : committed.error;
      ports.log('info', 'invitation.redeem.refused', {
        invitationId: cmd.invitationId,
        errorCode: error.errorCode,
      });
      return Result.err(error);
    }
    return Result.ok({
      invitationId: committed.value.invitationId,
      redemptionCount: committed.value.redemptionCount,
    });
  };
