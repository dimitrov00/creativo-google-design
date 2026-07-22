import { DomainError } from '@creativo/domain/kernel';

export class RewardProgramEmptyNameError extends DomainError {
  override readonly code = 'engagement.reward_program.empty_name' as const;
  constructor() {
    super('Reward program name cannot be empty');
  }
}

export class RewardProgramEmptyMilestonesError extends DomainError {
  override readonly code =
    'engagement.reward_program.empty_milestones' as const;
  constructor() {
    super('A reward program must define at least one milestone');
  }
}
