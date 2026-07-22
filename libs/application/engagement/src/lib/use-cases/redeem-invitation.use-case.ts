import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import {
  Invitation,
  InvitationId,
  InvitationRedemption,
} from '@creativo/domain/engagement';
import { UserId } from '@creativo/domain/accounts';
import { InvitationPort } from '../ports/invitation.port';
import {
  InvitationNotFoundError,
  RedeemInvitationError,
  RedeemInvitationRepositoryFailure,
} from './redeem-invitation.errors';

export interface RedeemInvitationInput {
  readonly invitationId: InvitationId;
  readonly refereeUserId: UserId;
  readonly now: ZonedDateTime;
}

/** Loads the invitation, guards self-redemption, records the redemption, and bumps the invitation's counter — all three writes or none. */
export class RedeemInvitationUseCase {
  constructor(private readonly invitations: InvitationPort) {}

  async execute(
    input: RedeemInvitationInput,
  ): Promise<Result<Invitation, RedeemInvitationError>> {
    const foundResult = await this.invitations.findById(input.invitationId);
    if (foundResult.isFailure()) {
      return fail(new RedeemInvitationRepositoryFailure(foundResult.error));
    }
    const invitation = foundResult.value;
    if (!invitation) {
      return fail(new InvitationNotFoundError());
    }

    const redemptionResult = InvitationRedemption.forInvitation(
      invitation,
      input.refereeUserId,
      input.now,
    );
    if (redemptionResult.isFailure()) {
      return fail(redemptionResult.error);
    }

    const saveRedemptionResult = await this.invitations.saveRedemption(
      redemptionResult.value,
    );
    if (saveRedemptionResult.isFailure()) {
      return fail(
        new RedeemInvitationRepositoryFailure(saveRedemptionResult.error),
      );
    }

    const updated = invitation.recordRedemption();
    const saveInvitationResult = await this.invitations.save(updated);
    if (saveInvitationResult.isFailure()) {
      return fail(
        new RedeemInvitationRepositoryFailure(saveInvitationResult.error),
      );
    }

    return ok(updated);
  }
}
