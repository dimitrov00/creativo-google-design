import { InjectionToken } from '@angular/core';
import { Result } from '@creativo/domain/kernel';
import {
  Invitation,
  InvitationId,
  InvitationRedemption,
} from '@creativo/domain/engagement';
import { RepositoryError } from '@creativo/application/shared';

export interface InvitationPort {
  save(invitation: Invitation): Promise<Result<void, RepositoryError>>;
  findById(
    id: InvitationId,
  ): Promise<Result<Invitation | null, RepositoryError>>;
  saveRedemption(
    redemption: InvitationRedemption,
  ): Promise<Result<void, RepositoryError>>;
}

export const INVITATION_PORT = new InjectionToken<InvitationPort>(
  'InvitationPort',
);
