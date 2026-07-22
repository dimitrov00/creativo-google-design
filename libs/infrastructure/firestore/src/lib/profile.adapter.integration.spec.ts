import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase/firestore';
import { doc, setDoc } from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { AccountStatus, User } from '@creativo/domain/accounts';
import { ZonedDateTime } from '@creativo/domain/kernel';
import { createEmulatorTestEnv } from '../testing/emulator-test-env';
import { FirestoreProfileAdapter } from './profile.adapter';

function createAdapter(db: Firestore): FirestoreProfileAdapter {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_FIRESTORE, useValue: db },
      FirestoreProfileAdapter,
    ],
  });
  return TestBed.inject(FirestoreProfileAdapter);
}

function today(): ZonedDateTime {
  const result = ZonedDateTime.now('Europe/Sofia');
  if (result.isFailure()) throw new Error('bad fixture zone');
  return result.value;
}

function buildUser(id: string, roles: string[] = ['client']): User {
  const created = User.create(
    {
      id,
      phone: '+359888123456',
      firstName: 'Ivan',
      lastName: 'Petrov',
      roles,
      status: AccountStatus.active(),
    },
    today(),
  );
  if (created.isFailure()) {
    throw new Error(
      `fixture construction failed: ${JSON.stringify(created.error)}`,
    );
  }
  return created.value;
}

describe('FirestoreProfileAdapter (emulator)', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await createEmulatorTestEnv('demo-firestore-profile');
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  it('round-trips saveProfile/getProfile for the owner', async () => {
    const uid = 'user-1';
    const owner = testEnv.authenticatedContext(uid, { roles: ['client'] });
    const adapter = createAdapter(owner.firestore() as unknown as Firestore);

    const saveResult = await adapter.saveProfile(buildUser(uid));
    expect(saveResult.isSuccess()).toBe(true);

    const getResult = await adapter.getProfile(buildUser(uid).id);
    expect(getResult.isSuccess()).toBe(true);
    if (getResult.isSuccess()) {
      expect(getResult.value?.fullName()).toBe('Ivan Petrov');
    }
  });

  it('lets staff read a client profile they do not own', async () => {
    const uid = 'user-2';
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', uid), {
        phone: '+359888123456',
        firstName: 'Ivan',
        lastName: 'Petrov',
        roles: ['client'],
        status: { kind: 'active' },
        email: null,
        birthDate: null,
        searchName: 'ivan petrov',
        searchPrefixes: ['i', 'iv', 'ivan'],
      });
    });

    const receptionist = testEnv.authenticatedContext('staff-1', {
      roles: ['receptionist'],
    });
    const adapter = createAdapter(
      receptionist.firestore() as unknown as Firestore,
    );

    const result = await adapter.getProfile(buildUser(uid).id);

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value?.fullName()).toBe('Ivan Petrov');
    }
  });

  it('rejects a client trying to self-grant an extra role via saveProfile', async () => {
    const uid = 'user-3';
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', uid), {
        phone: '+359888123456',
        firstName: 'Ivan',
        lastName: 'Petrov',
        roles: ['client'],
        status: { kind: 'active' },
        email: null,
        birthDate: null,
        searchName: 'ivan petrov',
        searchPrefixes: ['i', 'iv', 'ivan'],
      });
    });

    const owner = testEnv.authenticatedContext(uid, { roles: ['client'] });
    const adapter = createAdapter(owner.firestore() as unknown as Firestore);

    const result = await adapter.saveProfile(
      buildUser(uid, ['client', 'admin']),
    );

    expect(result.isFailure()).toBe(true);
  });
});
