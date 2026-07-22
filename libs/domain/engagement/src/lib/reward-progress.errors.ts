import { DomainError } from '@creativo/domain/kernel';

export class RewardProgressUnknownMilestoneError extends DomainError {
  override readonly code =
    'engagement.reward_progress.unknown_milestone' as const;
  constructor(public readonly milestoneId: string) {
    super(`Milestone "${milestoneId}" is not part of this enrollment`, {
      milestoneId,
    });
  }
}

export class RewardProgressMilestoneNotPendingError extends DomainError {
  override readonly code =
    'engagement.reward_progress.milestone_not_pending' as const;
  constructor(
    public readonly milestoneId: string,
    public readonly currentState: string,
  ) {
    super(
      `Cannot advance/expire milestone "${milestoneId}" from state "${currentState}" — it is not pending`,
      { milestoneId, currentState },
    );
  }
}
