import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import { Invitation } from '@creativo/domain/engagement';
import { UserId } from '@creativo/domain/accounts';
import { IdGenerator } from '@creativo/application/shared';
import { InvitationPort } from '../ports/invitation.port';
import {
  CreateInvitationError,
  CreateInvitationRepositoryFailure,
  CreateInvitationValidationFailure,
} from './create-invitation.errors';

export interface CreateInvitationInput {
  readonly inviterUserId: UserId;
  readonly inviterName: string;
  readonly now: ZonedDateTime;
}

export class CreateInvitationUseCase {
  constructor(
    private readonly invitations: InvitationPort,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(
    input: CreateInvitationInput,
  ): Promise<Result<Invitation, CreateInvitationError>> {
    const invitationResult = Invitation.create({
      id: this.idGenerator.next(),
      inviterUserId: input.inviterUserId.value,
      inviterName: input.inviterName,
      createdAt: input.now,
    });
    if (invitationResult.isFailure()) {
      return fail(
        new CreateInvitationValidationFailure(invitationResult.error),
      );
    }
    const invitation = invitationResult.value;

    const saveResult = await this.invitations.save(invitation);
    if (saveResult.isFailure()) {
      return fail(new CreateInvitationRepositoryFailure(saveResult.error));
    }

    return ok(invitation);
  }
}
