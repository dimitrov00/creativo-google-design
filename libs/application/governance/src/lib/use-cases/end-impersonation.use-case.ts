import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import {
  ImpersonationEndReason,
  ImpersonationSession,
  ImpersonationSessionId,
} from '@creativo/domain/governance';
import { UserId } from '@creativo/domain/accounts';
import {
  ImpersonationEndReason as EcsEndReason,
  ImpersonationEndReasonKind,
  type ImpersonationSessionEntity,
  ImpersonationSessionId as EcsSessionId,
  ImpersonationState,
  ImpersonationStatus,
  ImpersonationSystem,
  UserId as EcsUserId,
} from '@creativo/ecs-core';
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

    // The decision is `ImpersonationSystem.endByAdmin`: `expired` when the
    // window had lapsed by the time the call arrived, `admin_ended` by the
    // caller otherwise. The class then stamps that reason on its own copy;
    // an already-ended session is refused by `end` with its own error.
    const decided = ImpersonationSystem.endByAdmin(
      entityOf(session),
      EcsUserId.of(input.endedBy.value),
      input.now.toMillis(),
    );
    const reason =
      decided.ok && expiredIn(decided.value)
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

// ── The bridge: the legacy session → ecs-core's entity (Phase 4 deletes it) ─

function entityOf(session: ImpersonationSession): ImpersonationSessionEntity {
  return {
    id: EcsSessionId.of(session.id.value),
    adminUserId: EcsUserId.of(session.adminUserId.value),
    targetUserId: EcsUserId.of(session.targetUserId.value),
    scope: session.scope,
    reason: session.reason,
    startedAtMs: session.startedAt.toMillis(),
    expiresAtMs: session.expiresAt.toMillis(),
    status:
      session.status.kind === 'active'
        ? ImpersonationStatus.active()
        : {
            kind: ImpersonationState.Ended,
            endedAtMs: session.status.endedAt.toMillis(),
            // Only `active` is read by the end; an ended row is refused.
            reason: EcsEndReason.expired(),
          },
  };
}

/** Did the system end the session as `expired`? */
function expiredIn(ended: ImpersonationSessionEntity): boolean {
  return (
    ended.status.kind === ImpersonationState.Ended &&
    ended.status.reason.kind === ImpersonationEndReasonKind.Expired
  );
}
