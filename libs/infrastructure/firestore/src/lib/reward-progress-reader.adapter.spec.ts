import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { UserId } from '@creativo/domain/accounts';
import { RewardProgramId } from '@creativo/domain/engagement';

const { onSnapshotMock, docMock } = vi.hoisted(() => ({
  onSnapshotMock: vi.fn(),
  docMock: vi.fn(() => ({ id: 'fake-doc-ref' })),
}));

vi.mock('firebase/firestore', () => ({
  doc: docMock,
  onSnapshot: onSnapshotMock,
}));

import { FirestoreRewardProgressReader } from './reward-progress-reader.adapter';

function createReader(): FirestoreRewardProgressReader {
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_FIRESTORE, useValue: {} },
      FirestoreRewardProgressReader,
    ],
  });
  return TestBed.inject(FirestoreRewardProgressReader);
}

describe('FirestoreRewardProgressReader', () => {
  const userId = UserId.create('user-1');
  const programId = RewardProgramId.create('program-1');
  if (userId.isFailure() || programId.isFailure()) {
    throw new Error('unreachable — fixture ids are valid');
  }

  it('emits ok(null) when the enrollment doc does not exist', async () => {
    onSnapshotMock.mockImplementation(
      (_ref, onNext: (snap: unknown) => void) => {
        onNext({ exists: () => false });
        return () => undefined;
      },
    );

    const reader = createReader();
    const result = await firstValueFrom(
      reader.observeForUser(userId.value, programId.value),
    );

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value).toBeNull();
    }
  });

  it('emits ok(RewardProgress) reconstituted from a well-formed doc', async () => {
    onSnapshotMock.mockImplementation(
      (_ref, onNext: (snap: unknown) => void) => {
        onNext({
          exists: () => true,
          data: () => ({
            enrolledAt: '2026-01-01T00:00:00.000+02:00',
            milestones: [
              { kind: 'pending', milestoneId: 'milestone-1' },
              {
                kind: 'completed',
                milestoneId: 'milestone-2',
                completedAt: '2026-02-01T00:00:00.000+02:00',
              },
            ],
          }),
        });
        return () => undefined;
      },
    );

    const reader = createReader();
    const result = await firstValueFrom(
      reader.observeForUser(userId.value, programId.value),
    );

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess() && result.value !== null) {
      expect(result.value.userId.equals(userId.value)).toBe(true);
      expect(result.value.programId.equals(programId.value)).toBe(true);
      expect(result.value.milestones).toHaveLength(2);
      expect(result.value.completionRatio()).toEqual({
        completed: 1,
        total: 2,
      });
    }
  });

  it('emits a fail Result when the doc is malformed', async () => {
    onSnapshotMock.mockImplementation(
      (_ref, onNext: (snap: unknown) => void) => {
        onNext({
          exists: () => true,
          data: () => ({ enrolledAt: 'not-a-date', milestones: [] }),
        });
        return () => undefined;
      },
    );

    const reader = createReader();
    const result = await firstValueFrom(
      reader.observeForUser(userId.value, programId.value),
    );

    expect(result.isFailure()).toBe(true);
  });
});
