import { InjectionToken } from '@angular/core';
import { Result } from '@creativo/domain/kernel';
import {
  ImpersonationSession,
  ImpersonationSessionId,
} from '@creativo/domain/governance';
import { UserId } from '@creativo/domain/accounts';
import { RepositoryError } from '@creativo/application/shared';

export interface ImpersonationPort {
  save(session: ImpersonationSession): Promise<Result<void, RepositoryError>>;
  findById(
    id: ImpersonationSessionId,
  ): Promise<Result<ImpersonationSession | null, RepositoryError>>;
  /** At most one active session per admin at a time — the seam a "resume/end current session" UI reads from. */
  findActiveForAdmin(
    adminUserId: UserId,
  ): Promise<Result<ImpersonationSession | null, RepositoryError>>;
}

export const IMPERSONATION_PORT = new InjectionToken<ImpersonationPort>(
  'ImpersonationPort',
);
