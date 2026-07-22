import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import {
  ImpersonationEndReason,
  ImpersonationSession,
  ImpersonationSessionId,
} from '@creativo/domain/governance';
import { UserId } from '@creativo/domain/accounts';
import { ImpersonationPort } from '../ports/impersonation.port';
import {
  EndImpersonationError,
  EndImpersonationRepositoryFailure,
  ImpersonationSessionNotFoundError,
} from './end-impersonation.errors';

export interface EndImpersonationInput {
  readonly sessionId: ImpersonationSessionId;
  readonly endedBy: UserId;
  readonly now: ZonedDateTime;
}

/**
 * Ends a session — tagging the audit reason as `expired` rather than
 * `admin_ended` when the window had already lapsed by the time the
 * end-call arrived, per the one shared `isExpired` rule (blueprint §7.8).
 */
export class EndImpersonationUseCase {
  constructor(private readonly impersonation: ImpersonationPort) {}

  async execute(
    input: EndImpersonationInput,
  ): Promise<Result<ImpersonationSession, EndImpersonationError>> {
    const foundResult = await this.impersonation.findById(input.sessionId);
    if (foundResult.isFailure()) {
      return fail(new EndImpersonationRepositoryFailure(foundResult.error));
    }
    const session = foundResult.value;
    if (!session) {
      return fail(new ImpersonationSessionNotFoundError());
    }

    const clock = { now: () => input.now };
    const reason = session.isExpired(clock)
      ? ImpersonationEndReason.expired()
      : ImpersonationEndReason.adminEnded(input.endedBy);

    const endResult = session.end(input.now, reason);
    if (endResult.isFailure()) {
      return fail(endResult.error);
    }
    const ended = endResult.value;

    const saveResult = await this.impersonation.save(ended);
    if (saveResult.isFailure()) {
      return fail(new EndImpersonationRepositoryFailure(saveResult.error));
    }

    return ok(ended);
  }
}
