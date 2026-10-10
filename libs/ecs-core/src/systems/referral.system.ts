import { EngagementError } from '../components/engagement-errors.data';
import { RedemptionCount } from '../components/redemption-count.data';
import { Result } from '../components/result.data';
import type { InvitationEntity } from '../entities/invitation.entity';
import type { InvitationRedemptionEntity } from '../entities/invitation-redemption.entity';
import type { UserId } from '../entities/user.entity';

/*
 * AN INVITATION REDEEMED (`invitation.ts:105-115`,
 * `invitation-redemption.ts:58-70`) — the pure half of the
 * `redeemInvitation` pipeline: the self-redemption guard, the redemption
 * record (its id is the referee's uid, so a second redemption is a no-op
 * at the store), and the invitation with its count bumped — never a raw
 * `+1` in an adapter.
 */

/** What one redemption writes: the record and the invitation, counted once more. */
export type ReferralRedemption<I extends InvitationEntity = InvitationEntity> =
  {
    readonly invitation: I;
    readonly redemption: InvitationRedemptionEntity;
  };

export const ReferralSystem = {
  /** Whether the given user is the original inviter — guards self-invitation. */
  isSelfInvitation(
    invitation: Pick<InvitationEntity, 'inviterUserId'>,
    candidate: UserId,
  ): boolean {
    return invitation.inviterUserId === candidate;
  },

  /** The per-redemption counter bump, as a new struct. */
  recordRedemption<I extends InvitationEntity>(invitation: I): I {
    return {
      ...invitation,
      redemptionCount: RedemptionCount.next(invitation.redemptionCount),
    };
  },

  /**
   * `referee` redeems `invitation` at `redeemedAtMs`: refused when the
   * referee is the inviter; else the redemption record and the invitation
   * counted once more.
   */
  redeem<I extends InvitationEntity>(
    invitation: I,
    referee: UserId,
    redeemedAtMs: number,
  ): Result<ReferralRedemption<I>, EngagementError.InvitationSelfRedemption> {
    if (ReferralSystem.isSelfInvitation(invitation, referee)) {
      return Result.err(EngagementError.invitationSelfRedemption());
    }
    return Result.ok({
      invitation: ReferralSystem.recordRedemption(invitation),
      redemption: { id: referee, redeemedAtMs },
    });
  },
} as const;
