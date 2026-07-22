import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import { Result } from '@creativo/domain/kernel';
import { RewardProgramId, RewardProgress } from '@creativo/domain/engagement';
import { UserId } from '@creativo/domain/accounts';
import { RepositoryError } from '@creativo/application/shared';

/** Live read of a user's enrollment/progress in a reward program, for a dashboard widget. */
export interface RewardProgressReader {
  observeForUser(
    userId: UserId,
    programId: RewardProgramId,
  ): Observable<Result<RewardProgress | null, RepositoryError>>;
}

export const REWARD_PROGRESS_READER = new InjectionToken<RewardProgressReader>(
  'RewardProgressReader',
);
