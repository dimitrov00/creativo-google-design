import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import {
  ImpersonationScope,
  ImpersonationSession,
} from '@creativo/domain/governance';
import { UserId, UserRole } from '@creativo/domain/accounts';
import { IdGenerator } from '@creativo/application/shared';
import { ImpersonationPort } from '../ports/impersonation.port';
import {
  StartImpersonationError,
  StartImpersonationRepositoryFailure,
  StartImpersonationValidationFailure,
} from './start-impersonation.errors';

export interface StartImpersonationInput {
  readonly adminUserId: UserId;
  readonly adminRoles: readonly UserRole[];
  readonly targetUserId: UserId;
  readonly scope: ImpersonationScope;
  readonly reason: string;
  readonly startedAt: ZonedDateTime;
  readonly expiresAt: ZonedDateTime;
}

export class StartImpersonationUseCase {
  constructor(
    private readonly impersonation: ImpersonationPort,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(
    input: StartImpersonationInput,
  ): Promise<Result<ImpersonationSession, StartImpersonationError>> {
    const sessionResult = ImpersonationSession.start({
      id: this.idGenerator.next(),
      adminUserId: input.adminUserId.value,
      targetUserId: input.targetUserId.value,
      adminRoles: input.adminRoles,
      scope: input.scope,
      reason: input.reason,
      startedAtIso: input.startedAt.toISO(),
      expiresAtIso: input.expiresAt.toISO(),
    });
    if (sessionResult.isFailure()) {
      return fail(new StartImpersonationValidationFailure(sessionResult.error));
    }
    const session = sessionResult.value;

    const saveResult = await this.impersonation.save(session);
    if (saveResult.isFailure()) {
      return fail(new StartImpersonationRepositoryFailure(saveResult.error));
    }

    return ok(session);
  }
}
