import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { createEmulatorTestEnv } from '../testing/emulator-test-env';

describe('firestore.rules', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await createEmulatorTestEnv('demo-firestore-rules');
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  describe('users/{uid} — owner-only', () => {
    it('lets a signed-in user read their own doc', async () => {
      const uid = 'user-1';
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'users', uid), {
          roles: ['client'],
        });
      });
      const alice = testEnv.authenticatedContext(uid);
      await assertSucceeds(getDoc(doc(alice.firestore(), 'users', uid)));
    });

    it('denies a signed-in user reading someone else’s doc', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'users', 'user-1'), {
          roles: ['client'],
        });
      });
      const bob = testEnv.authenticatedContext('user-2');
      await assertFails(getDoc(doc(bob.firestore(), 'users', 'user-1')));
    });

    it('denies an anonymous (unauthenticated) read', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'users', 'user-1'), {
          roles: ['client'],
        });
      });
      const anon = testEnv.unauthenticatedContext();
      await assertFails(getDoc(doc(anon.firestore(), 'users', 'user-1')));
    });

    it('lets staff read any client profile', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'users', 'user-1'), {
          roles: ['client'],
        });
      });
      const receptionist = testEnv.authenticatedContext('staff-1', {
        roles: ['receptionist'],
      });
      await assertSucceeds(
        getDoc(doc(receptionist.firestore(), 'users', 'user-1')),
      );
    });

    it('lets a user self-register as a plain client', async () => {
      const uid = 'user-3';
      const alice = testEnv.authenticatedContext(uid);
      await assertSucceeds(
        setDoc(doc(alice.firestore(), 'users', uid), { roles: ['client'] }),
      );
    });

    it('denies self-registration with a non-client role', async () => {
      const uid = 'user-4';
      const alice = testEnv.authenticatedContext(uid);
      await assertFails(
        setDoc(doc(alice.firestore(), 'users', uid), { roles: ['admin'] }),
      );
    });

    it('denies a client self-granting an extra role via update', async () => {
      const uid = 'user-5';
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'users', uid), {
          roles: ['client'],
          firstName: 'Alice',
        });
      });
      const alice = testEnv.authenticatedContext(uid);
      await assertFails(
        updateDoc(doc(alice.firestore(), 'users', uid), {
          roles: ['client', 'admin'],
        }),
      );
    });

    it('lets a client update their own non-role/status fields', async () => {
      const uid = 'user-6';
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'users', uid), {
          roles: ['client'],
          firstName: 'Alice',
        });
      });
      const alice = testEnv.authenticatedContext(uid);
      await assertSucceeds(
        updateDoc(doc(alice.firestore(), 'users', uid), {
          firstName: 'Alicia',
        }),
      );
    });
  });

  describe('programs (positions/courses/events) — public read, content-manager write', () => {
    it.each(['positions', 'courses', 'events'])(
      'lets an anonymous, unauthenticated visitor read %s',
      async (collectionName) => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          await setDoc(doc(ctx.firestore(), collectionName, 'doc-1'), {
            title: { en: 'Title', bg: 'Заглавие' },
          });
        });
        const anon = testEnv.unauthenticatedContext();
        await assertSucceeds(
          getDoc(doc(anon.firestore(), collectionName, 'doc-1')),
        );
      },
    );

    it.each(['positions', 'courses', 'events'])(
      'denies a plain client from writing %s',
      async (collectionName) => {
        const client = testEnv.authenticatedContext('client-1', {
          roles: ['client'],
        });
        await assertFails(
          setDoc(doc(client.firestore(), collectionName, 'doc-2'), {
            title: { en: 'Title', bg: 'Заглавие' },
          }),
        );
      },
    );

    it.each(['positions', 'courses', 'events'])(
      'lets a content_manager write %s',
      async (collectionName) => {
        const manager = testEnv.authenticatedContext('manager-1', {
          roles: ['content_manager'],
        });
        await assertSucceeds(
          setDoc(doc(manager.firestore(), collectionName, 'doc-3'), {
            title: { en: 'Title', bg: 'Заглавие' },
          }),
        );
      },
    );
  });

  describe('server-only collections', () => {
    it.each(['otps', 'rateLimits', 'blocklist'])(
      'denies every client read/write on %s',
      async (collectionName) => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          await setDoc(doc(ctx.firestore(), collectionName, 'doc-1'), {
            any: 'value',
          });
        });
        const admin = testEnv.authenticatedContext('admin-1', {
          roles: ['admin'],
        });
        await assertFails(
          getDoc(doc(admin.firestore(), collectionName, 'doc-1')),
        );
        await assertFails(
          setDoc(doc(admin.firestore(), collectionName, 'doc-2'), {
            any: 'value',
          }),
        );
      },
    );
  });
});
