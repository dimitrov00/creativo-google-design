import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import { MilestoneId, RewardProgramId } from './ids';
import { RewardProgram } from './reward-program';
import {
  RewardProgressMilestoneNotPendingError,
  RewardProgressUnknownMilestoneError,
} from './reward-progress.errors';

/**
 * Status of a single milestone within a user's enrollment. Ports v2's
 * `RewardProgress.MilestoneStatus` — monotone transitions:
 * `pending → completed` or `pending → expired`; terminal states never
 * revert. Deviation from v2: the `reverted`/clawback terminal state and
 * its audit-event-id chains are dropped for this pass (Goal 03's
 * materialization use-case owns clawback orchestration; this pure VO
 * only tracks milestone lifecycle).
 */
export type MilestoneStatus =
  MilestoneStatusPending | MilestoneStatusCompleted | MilestoneStatusExpired;

export interface MilestoneStatusPending {
  readonly kind: 'pending';
  readonly milestoneId: MilestoneId;
}
export interface MilestoneStatusCompleted {
  readonly kind: 'completed';
  readonly milestoneId: MilestoneId;
  readonly completedAt: ZonedDateTime;
}
export interface MilestoneStatusExpired {
  readonly kind: 'expired';
  readonly milestoneId: MilestoneId;
  readonly expiredAt: ZonedDateTime;
}

/**
 * **Aggregate root.** Per-user enrollment in a `RewardProgram` with
 * per-milestone status tracking (ports v2's `RewardProgress.ts`).
 */
export class RewardProgress {
  private constructor(
    readonly userId: UserId,
    readonly programId: RewardProgramId,
    readonly enrolledAt: ZonedDateTime,
    readonly milestones: readonly MilestoneStatus[],
  ) {}

  /** Fresh enrollment — every milestone in the program starts `pending`. */
  static enroll(
    userId: UserId,
    program: RewardProgram,
    enrolledAt: ZonedDateTime,
  ): RewardProgress {
    const milestones: MilestoneStatus[] = program.milestones.map((m) => ({
      kind: 'pending',
      milestoneId: m.id,
    }));
    return new RewardProgress(userId, program.id, enrolledAt, milestones);
  }

  /** Rebuild from persistence — same shape, no re-derivation needed. */
  static reconstitute(
    userId: UserId,
    programId: RewardProgramId,
    enrolledAt: ZonedDateTime,
    milestones: MilestoneStatus[],
  ): RewardProgress {
    return new RewardProgress(userId, programId, enrolledAt, milestones);
  }

  statusOf(milestoneId: MilestoneId): MilestoneStatus | undefined {
    return this.milestones.find((s) => s.milestoneId.equals(milestoneId));
  }

  completionRatio(): { completed: number; total: number } {
    const completed = this.milestones.filter(
      (s) => s.kind === 'completed',
    ).length;
    return { completed, total: this.milestones.length };
  }

  isFullyResolved(): boolean {
    return this.milestones.every((s) => s.kind !== 'pending');
  }

  /** Advance a single milestone from `pending` to `completed`. */
  advanceMilestone(
    milestoneId: MilestoneId,
    completedAt: ZonedDateTime,
  ): Result<
    RewardProgress,
    RewardProgressUnknownMilestoneError | RewardProgressMilestoneNotPendingError
  > {
    return this.transition(milestoneId, () => ({
      kind: 'completed',
      milestoneId,
      completedAt,
    }));
  }

  /** Expire a single pending milestone — used by a future deadline sweep. */
  expireMilestone(
    milestoneId: MilestoneId,
    expiredAt: ZonedDateTime,
  ): Result<
    RewardProgress,
    RewardProgressUnknownMilestoneError | RewardProgressMilestoneNotPendingError
  > {
    return this.transition(milestoneId, () => ({
      kind: 'expired',
      milestoneId,
      expiredAt,
    }));
  }

  private transition(
    milestoneId: MilestoneId,
    build: (current: MilestoneStatusPending) => MilestoneStatus,
  ): Result<
    RewardProgress,
    RewardProgressUnknownMilestoneError | RewardProgressMilestoneNotPendingError
  > {
    const current = this.statusOf(milestoneId);
    if (!current) {
      return fail(
        new RewardProgressUnknownMilestoneError(milestoneId.toString()),
      );
    }
    if (current.kind !== 'pending') {
      return fail(
        new RewardProgressMilestoneNotPendingError(
          milestoneId.toString(),
          current.kind,
        ),
      );
    }
    const milestones = this.milestones.map((s) =>
      s.milestoneId.equals(milestoneId) ? build(current) : s,
    );
    return ok(
      new RewardProgress(
        this.userId,
        this.programId,
        this.enrolledAt,
        milestones,
      ),
    );
  }
}
