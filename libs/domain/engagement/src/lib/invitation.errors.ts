import { DomainError } from '@creativo/domain/kernel';

export class InvitationEmptyInviterNameError extends DomainError {
  override readonly code = 'engagement.invitation.empty_inviter_name' as const;
  constructor() {
    super('An invitation must carry a non-empty inviter name');
  }
}

export class InvitationInvalidRedemptionCountError extends DomainError {
  override readonly code =
    'engagement.invitation.invalid_redemption_count' as const;
  constructor(public readonly attempted: number) {
    super(
      `Invitation redemption count must be a non-negative integer, got ${attempted}`,
      { attempted },
    );
  }
}

export class InvitationSelfRedemptionError extends DomainError {
  override readonly code = 'engagement.invitation.self_redemption' as const;
  constructor() {
    super('A user cannot redeem their own invitation');
  }
}
