import { DomainError } from '@creativo/domain/kernel';
import { InvitationSelfRedemptionError } from '@creativo/domain/engagement';
import { RepositoryError } from '@creativo/application/shared';

export class InvitationNotFoundError extends DomainError {
  readonly code = 'engagement.redeem_invitation.not_found' as const;
  constructor() {
    super('No such invitation.');
  }
}

export class RedeemInvitationRepositoryFailure extends DomainError {
  readonly code = 'engagement.redeem_invitation.repository_failure' as const;
  constructor(public override readonly cause: RepositoryError) {
    super('Repository operation failed');
  }
}

export type RedeemInvitationError =
  | InvitationNotFoundError
  | InvitationSelfRedemptionError
  | RedeemInvitationRepositoryFailure;
