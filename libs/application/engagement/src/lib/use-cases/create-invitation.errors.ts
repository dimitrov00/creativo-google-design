import { DomainError } from '@creativo/domain/kernel';
import { InvitationError } from '@creativo/domain/engagement';
import { RepositoryError } from '@creativo/application/shared';

export class CreateInvitationValidationFailure extends DomainError {
  readonly code = 'engagement.create_invitation.validation_failed' as const;
  constructor(public readonly errors: readonly InvitationError[]) {
    super('Invitation validation failed');
  }
}

export class CreateInvitationRepositoryFailure extends DomainError {
  readonly code = 'engagement.create_invitation.repository_failure' as const;
  constructor(public override readonly cause: RepositoryError) {
    super('Failed to save the new invitation');
  }
}

export type CreateInvitationError =
  CreateInvitationValidationFailure | CreateInvitationRepositoryFailure;
