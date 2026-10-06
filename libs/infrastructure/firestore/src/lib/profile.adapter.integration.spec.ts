import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { filter, firstValueFrom, shareReplay } from 'rxjs';
import type { Firestore } from 'firebase/firestore';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { AccountStatus, User } from '@creativo/domain/accounts';
import { ZonedDateTime } from '@creativo/domain/kernel';
import {
  createEmulatorTestEnv,
  modularFirestore,
} from '../testing/emulator-test-env';
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

function buildUser(
  id: string,
  overrides: Partial<Parameters<typeof User.create>[0]> = {},
): User {
  const created = User.create(
    {
      id,
      phone: '+359888123456',
      firstName: 'Ivan',
      lastName: 'Petrov',
      roles: ['client'],
      status: AccountStatus.active(),
      ...overrides,
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

/** A registered `users/{uid}`, as registration (Admin SDK) writes it. */
const REGISTERED = {
  phone: '+359888123456',
  firstName: 'Ivan',
  lastName: 'Petrov',
  roles: ['client'],
  status: { kind: 'active' },
  email: null,
  birthDate: null,
  searchName: 'ivan petrov',
  searchPrefixes: ['i', 'iv', 'ivan'],
};

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

  async function seed(
    uid: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(modularFirestore(ctx), 'users', uid), data);
    });
  }

  async function stored(uid: string): Promise<Record<string, unknown>> {
    let data: Record<string, unknown> = {};
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      data =
        (await getDoc(doc(modularFirestore(ctx), 'users', uid))).data() ?? {};
    });
    return data;
  }

  function ownerAdapter(uid: string): FirestoreProfileAdapter {
    return createAdapter(
      modularFirestore(
        testEnv.authenticatedContext(uid, { roles: ['client'] }),
      ),
    );
  }

  it('round-trips an owner name edit through saveProfile/getProfile', async () => {
    const uid = 'user-1';
    await seed(uid, REGISTERED);
    const adapter = ownerAdapter(uid);

    const saveResult = await adapter.saveProfile(
      buildUser(uid, { firstName: 'Georgi', birthDate: '1990-05-17' }),
    );
    expect(saveResult.isSuccess()).toBe(true);

    const getResult = await adapter.getProfile(buildUser(uid).id);
    expect(getResult.isSuccess()).toBe(true);
    if (getResult.isSuccess()) {
      expect(getResult.value?.fullName()).toBe('Georgi Petrov');
      expect(getResult.value?.birthDate?.toISODate()).toBe('1990-05-17');
    }
    expect((await stored(uid))['searchPrefixes']).toEqual(
      expect.arrayContaining(['georgi', 'petrov', '359888123456']),
    );
  });

  it('lets staff read a client profile they do not own', async () => {
    const uid = 'user-2';
    await seed(uid, REGISTERED);

    const receptionist = testEnv.authenticatedContext('staff-1', {
      roles: ['receptionist'],
    });
    const adapter = createAdapter(modularFirestore(receptionist));

    const result = await adapter.getProfile(buildUser(uid).id);

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value?.fullName()).toBe('Ivan Petrov');
    }
  });

  it('never carries roles, phone or email from the passed User to the document', async () => {
    const uid = 'user-3';
    await seed(uid, REGISTERED);
    const adapter = ownerAdapter(uid);

    const result = await adapter.saveProfile(
      buildUser(uid, {
        roles: ['client', 'admin'],
        phone: '+359877000111',
        email: 'someone-else@example.com',
      }),
    );

    // The save succeeds because none of those keys is sent at all.
    expect(result.isSuccess()).toBe(true);
    const data = await stored(uid);
    expect(data['roles']).toEqual(['client']);
    expect(data['phone']).toBe('+359888123456');
    expect(data['email']).toBeNull();
  });

  it("leaves a server-written status untouched by the owner's name save", async () => {
    const uid = 'user-4';
    // Richer than the web mapper round-trips: a whole-document set would
    // have to re-send (and could only drop) the extra key.
    const status = {
      kind: 'blocked',
      reason: 'manual',
      untilIso: null,
      pauseId: 'pause-1',
    };
    await seed(uid, { ...REGISTERED, status });
    const adapter = ownerAdapter(uid);

    const result = await adapter.saveProfile(
      buildUser(uid, { firstName: 'Georgi' }),
    );

    expect(result.isSuccess()).toBe(true);
    const data = await stored(uid);
    expect(data['firstName']).toBe('Georgi');
    expect(data['status']).toEqual(status);
  });

  it('never creates the document: saving a missing profile fails', async () => {
    const uid = 'user-5';
    const adapter = ownerAdapter(uid);

    const result = await adapter.saveProfile(buildUser(uid));

    expect(result.isFailure()).toBe(true);
    let exists = true;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      exists = (
        await getDoc(doc(modularFirestore(ctx), 'users', uid))
      ).exists();
    });
    expect(exists).toBe(false);
  });

  it('observeProfile delivers a server-side status change live', async () => {
    const uid = 'user-6';
    await seed(uid, REGISTERED);
    // ONE listener for the whole test, so the change must arrive on it — a
    // second subscription's first snapshot would prove nothing about "live".
    const live = ownerAdapter(uid)
      .observeProfile(buildUser(uid).id)
      .pipe(shareReplay({ bufferSize: 1, refCount: true }));
    const keepAlive = live.subscribe();

    const first = await firstValueFrom(live);
    expect(first.isSuccess() && first.value?.status.kind).toBe('active');

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(modularFirestore(ctx), 'users', uid), {
        status: { kind: 'blocked', reason: 'manual', untilIso: null },
      });
    });

    const result = await firstValueFrom(
      live.pipe(
        filter(
          (next) => next.isSuccess() && next.value?.status.kind === 'blocked',
        ),
      ),
    );
    keepAlive.unsubscribe();
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value?.status).toEqual(
        AccountStatus.blocked({ reason: 'manual' }),
      );
    }
  });

  it('observeProfile reads the pre-registration stub as no profile yet', async () => {
    const uid = 'user-7';
    await seed(uid, { phone: '+359888123456', email: null });

    const result = await firstValueFrom(
      ownerAdapter(uid).observeProfile(buildUser(uid).id),
    );

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value).toBeNull();
    }
  });
});
