import { DomainError } from '@creativo/domain/kernel';

export class MilestoneInvalidOrderError extends DomainError {
  override readonly code = 'engagement.milestone.invalid_order' as const;
  constructor(public readonly attempted: number) {
    super(`Milestone order must be a non-negative integer, got ${attempted}`, {
      attempted,
    });
  }
}

export class MilestoneEmptyRewardsError extends DomainError {
  override readonly code = 'engagement.milestone.empty_rewards' as const;
  constructor() {
    super('A milestone must carry at least one reward');
  }
}

export class MilestoneInvalidCriteriaThresholdError extends DomainError {
  override readonly code =
    'engagement.milestone.invalid_criteria_threshold' as const;
  constructor(public readonly attempted: number) {
    super(
      `Milestone criteria threshold must be a positive integer, got ${attempted}`,
      { attempted },
    );
  }
}
