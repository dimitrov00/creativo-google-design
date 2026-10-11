import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import {
  ImpersonationEndReason,
  ImpersonationSession,
  ImpersonationSessionId,
} from '@creativo/domain/governance';
import { UserId } from '@creativo/domain/accounts';
import {
  ImpersonationSessionId as EcsSessionId,
  UserId as EcsUserId,
  UtcEpochMs,
  defect,
} from '@core/primitives';
import {
  EndReasonFields,
  ImpersonationEndReason as EcsEndReason,
  ImpersonationLifecycle,
  ImpersonationScope as EcsScope,
  ImpersonationStatus,
} from '@core/components';
import { type ImpersonationSession as EcsSession } from '@core/entities';
import { ImpersonationSystem } from '@core/systems';
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
      utcOf(input.now.toMillis()),
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

/** The legacy lowercase scope → the SCREAMING tag (flatten-spec §8.9). */
const ECS_IMPERSONATION_SCOPE = {
  read: EcsScope.Read,
  write: EcsScope.Write,
} as const;

/** A legacy instant's epoch ms as the brand — every `ZonedDateTime` is inside its window. */
function utcOf(epochMs: number): UtcEpochMs {
  const instant = UtcEpochMs.of(epochMs);
  return instant.ok ? instant.value : defect(`${epochMs} is not an instant`);
}

function entityOf(session: ImpersonationSession): EcsSession {
  const meta = {
    id: EcsSessionId.of(session.id.value),
    adminUserId: EcsUserId.of(session.adminUserId.value),
    targetUserId: EcsUserId.of(session.targetUserId.value),
    impersonationScope: ECS_IMPERSONATION_SCOPE[session.scope],
    reason: session.reason,
    startedAtUtcMs: utcOf(session.startedAt.toMillis()),
    expiresAtUtcMs: utcOf(session.expiresAt.toMillis()),
  };
  return session.status.kind === 'active'
    ? { ...meta, ...ImpersonationLifecycle.active() }
    : {
        ...meta,
        impersonationStatus: ImpersonationStatus.Ended,
        endedAtUtcMs: utcOf(session.status.endedAt.toMillis()),
        // Only `ACTIVE` is read by the end; an ended row is refused.
        ...EndReasonFields.expired(),
      };
}

/** Did the system end the session as `EXPIRED`? */
function expiredIn(ended: EcsSession): boolean {
  return (
    ended.impersonationStatus === ImpersonationStatus.Ended &&
    ended.impersonationEndReason === EcsEndReason.Expired
  );
}
