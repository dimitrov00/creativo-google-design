import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { DocumentData } from 'firebase/firestore';
import { onSnapshot } from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import {
  MilestoneId,
  MilestoneStatus,
  RewardProgramId,
  RewardProgress,
} from '@creativo/domain/engagement';
import { RewardProgressReader } from '@creativo/application/engagement';
import { RepositoryError } from '@creativo/application/shared';
import { rewardProgressDocRef } from './firestore-paths';
import { subscribeWithRetry } from './subscribe-with-retry';

/** Every timestamp in this schema is reconstructed against the product's fixed zone. */
const ZONE = 'Europe/Sofia';

function toMilestoneStatus(
  raw: unknown,
): Result<MilestoneStatus, RepositoryError> {
  if (typeof raw !== 'object' || raw === null) {
    return fail(new RepositoryError('Malformed milestone status'));
  }
  const data = raw as Record<string, unknown>;
  const milestoneIdResult = MilestoneId.create(String(data['milestoneId']));
  if (milestoneIdResult.isFailure()) {
    return fail(
      new RepositoryError(
        'Malformed milestone status',
        milestoneIdResult.error,
      ),
    );
  }
  const milestoneId = milestoneIdResult.value;

  switch (data['kind']) {
    case 'pending':
      return ok({ kind: 'pending', milestoneId });
    case 'completed': {
      const completedAtResult = ZonedDateTime.fromISO(
        String(data['completedAt']),
        ZONE,
      );
      if (completedAtResult.isFailure()) {
        return fail(
          new RepositoryError(
            'Malformed milestone status',
            completedAtResult.error,
          ),
        );
      }
      return ok({
        kind: 'completed',
        milestoneId,
        completedAt: completedAtResult.value,
      });
    }
    case 'expired': {
      const expiredAtResult = ZonedDateTime.fromISO(
        String(data['expiredAt']),
        ZONE,
      );
      if (expiredAtResult.isFailure()) {
        return fail(
          new RepositoryError(
            'Malformed milestone status',
            expiredAtResult.error,
          ),
        );
      }
      return ok({
        kind: 'expired',
        milestoneId,
        expiredAt: expiredAtResult.value,
      });
    }
    default:
      return fail(
        new RepositoryError(
          `Unknown milestone status kind: ${String(data['kind'])}`,
        ),
      );
  }
}

function toDomain(
  userId: UserId,
  programId: RewardProgramId,
  data: DocumentData,
): Result<RewardProgress, RepositoryError> {
  const enrolledAtResult = ZonedDateTime.fromISO(
    String(data['enrolledAt']),
    ZONE,
  );
  if (enrolledAtResult.isFailure()) {
    return fail(
      new RepositoryError(
        'Malformed reward progress document',
        enrolledAtResult.error,
      ),
    );
  }

  const rawMilestones: unknown[] = Array.isArray(data['milestones'])
    ? data['milestones']
    : [];
  const milestones: MilestoneStatus[] = [];
  for (const rawMilestone of rawMilestones) {
    const result = toMilestoneStatus(rawMilestone);
    if (result.isFailure()) {
      return fail(result.error);
    }
    milestones.push(result.value);
  }

  return ok(
    RewardProgress.reconstitute(
      userId,
      programId,
      enrolledAtResult.value,
      milestones,
    ),
  );
}

/**
 * Live read of a user's enrollment/progress in a single reward program.
 * `users/{uid}/rewardProgress/{programId}` is materialized server-side only
 * (Cloud Functions milestone sweep, Phase 7) — this adapter never writes.
 */
@Injectable()
export class FirestoreRewardProgressReader implements RewardProgressReader {
  private readonly db = inject(FIREBASE_FIRESTORE);

  observeForUser(
    userId: UserId,
    programId: RewardProgramId,
  ): Observable<Result<RewardProgress | null, RepositoryError>> {
    const ref = rewardProgressDocRef(this.db, userId, programId);
    return subscribeWithRetry<RewardProgress | null>((onNext, onError) =>
      onSnapshot(
        ref,
        (snapshot) => {
          if (!snapshot.exists()) {
            onNext(null);
            return;
          }
          const result = toDomain(userId, programId, snapshot.data());
          if (result.isFailure()) {
            onError(result.error);
            return;
          }
          onNext(result.value);
        },
        onError,
      ),
    );
  }
}
