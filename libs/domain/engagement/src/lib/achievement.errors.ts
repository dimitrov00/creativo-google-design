import { DomainError } from '@creativo/domain/kernel';

export class AchievementEmptyNameError extends DomainError {
  override readonly code = 'engagement.achievement.empty_name' as const;
  constructor() {
    super('Achievement name cannot be empty');
  }
}

export class AchievementEmptyRewardsError extends DomainError {
  override readonly code = 'engagement.achievement.empty_rewards' as const;
  constructor() {
    super('An achievement must carry at least one reward');
  }
}
