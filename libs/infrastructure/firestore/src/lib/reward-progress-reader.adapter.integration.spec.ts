import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import type {
  RulesTestContext,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { UserId } from '@creativo/domain/accounts';
import { RewardProgramId } from '@creativo/domain/engagement';
import {
  createEmulatorTestEnv,
  modularFirestore,
} from '../testing/emulator-test-env';
import { FirestoreRewardProgressReader } from './reward-progress-reader.adapter';

function readerFor(context: RulesTestContext): FirestoreRewardProgressReader {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_FIRESTORE, useValue: modularFirestore(context) },
      FirestoreRewardProgressReader,
    ],
  });
  return TestBed.inject(FirestoreRewardProgressReader);
}

describe('FirestoreRewardProgressReader (emulator)', () => {
  let testEnv: RulesTestEnvironment;

  const userId = UserId.create('user-1');
  const programId = RewardProgramId.create('program-1');
  if (userId.isFailure() || programId.isFailure()) {
    throw new Error('unreachable — fixture ids are valid');
  }

  beforeAll(async () => {
    testEnv = await createEmulatorTestEnv('demo-firestore-reward-progress');
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  it('emits ok(null) when the user has no enrollment yet', async () => {
    const owner = testEnv.authenticatedContext(userId.value.value, {
      roles: ['client'],
    });
    const reader = readerFor(owner);

    const result = await firstValueFrom(
      reader.observeForUser(userId.value, programId.value),
    );

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value).toBeNull();
    }
  });

  it('lets the owner observe their own reward progress', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(
          ctx.firestore(),
          'users',
          userId.value.value,
          'rewardProgress',
          programId.value.value,
        ),
        {
          enrolledAt: '2026-01-01T00:00:00.000+02:00',
          milestones: [{ kind: 'pending', milestoneId: 'milestone-1' }],
        },
      );
    });

    const owner = testEnv.authenticatedContext(userId.value.value, {
      roles: ['client'],
    });
    const reader = readerFor(owner);

    const result = await firstValueFrom(
      reader.observeForUser(userId.value, programId.value),
    );

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess() && result.value !== null) {
      expect(result.value.milestones).toHaveLength(1);
    }
  });

  it('denies a different user reading someone else’s reward progress', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(
          ctx.firestore(),
          'users',
          userId.value.value,
          'rewardProgress',
          programId.value.value,
        ),
        {
          enrolledAt: '2026-01-01T00:00:00.000+02:00',
          milestones: [],
        },
      );
    });

    const intruder = testEnv.authenticatedContext('someone-else', {
      roles: ['client'],
    });
    const reader = readerFor(intruder);

    const result = await firstValueFrom(
      reader.observeForUser(userId.value, programId.value),
    );

    expect(result.isFailure()).toBe(true);
  });
});
