import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { ZonedDateTime } from '@creativo/domain/kernel';
import {
  ImpersonationSession,
  ImpersonationSessionId,
} from '@creativo/domain/governance';
import { UserId } from '@creativo/domain/accounts';
import { createEmulatorTestEnv } from '../testing/emulator-test-env';
import { FirestoreImpersonationAdapter } from './impersonation.adapter';

function createAdapter(db: Firestore): FirestoreImpersonationAdapter {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_FIRESTORE, useValue: db },
      FirestoreImpersonationAdapter,
    ],
  });
  return TestBed.inject(FirestoreImpersonationAdapter);
}

function buildSession(
  adminUserId: UserId,
  targetUserId: UserId,
): ImpersonationSession {
  const now = ZonedDateTime.now('UTC');
  if (now.isFailure()) throw new Error('bad now');
  const result = ImpersonationSession.start({
    id: ImpersonationSessionId.generate().value,
    adminUserId: adminUserId.value,
    targetUserId: targetUserId.value,
    scope: 'write',
    reason: 'support ticket #42',
    startedAtIso: now.value.toISO(),
    expiresAtIso: now.value.plusMinutes(30).toISO(),
    adminRoles: ['admin'],
  });
  if (result.isFailure()) {
    throw new Error(`fixture build failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

describe('FirestoreImpersonationAdapter (emulator)', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await createEmulatorTestEnv('demo-firestore-impersonation');
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  it('saves a session and its paired audit entry, then finds it by id', async () => {
    const adminUserId = UserId.generate();
    const targetUserId = UserId.generate();
    const session = buildSession(adminUserId, targetUserId);

    const adminDb = testEnv
      .authenticatedContext(adminUserId.value, { roles: ['admin'] })
      .firestore() as unknown as Firestore;
    const adapter = createAdapter(adminDb);

    const saveResult = await adapter.save(session);
    expect(saveResult.isSuccess()).toBe(true);

    const findResult = await adapter.findById(session.id);
    expect(findResult.isSuccess()).toBe(true);
    if (findResult.isSuccess()) {
      expect(findResult.value?.id.value).toBe(session.id.value);
    }

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const auditDocs = await ctx.firestore().collection('auditLog').get();
      expect(auditDocs.empty).toBe(false);
      const [firstAuditDoc] = auditDocs.docs;
      expect(firstAuditDoc?.data()['action']).toBe('impersonation.started');
    });
  });

  it('finds the one active session for an admin', async () => {
    const adminUserId = UserId.generate();
    const targetUserId = UserId.generate();
    const session = buildSession(adminUserId, targetUserId);

    const adminDb = testEnv
      .authenticatedContext(adminUserId.value, { roles: ['admin'] })
      .firestore() as unknown as Firestore;
    const adapter = createAdapter(adminDb);
    await adapter.save(session);

    const result = await adapter.findActiveForAdmin(adminUserId);
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value?.id.value).toBe(session.id.value);
    }
  });

  it('denies a non-admin from reading or writing impersonation sessions', async () => {
    const adminUserId = UserId.generate();
    const targetUserId = UserId.generate();
    const session = buildSession(adminUserId, targetUserId);

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const { setDoc, doc } = await import('firebase/firestore');
      await setDoc(
        doc(
          ctx.firestore() as unknown as Firestore,
          'impersonationSessions',
          session.id.value,
        ),
        { adminUserId: adminUserId.value },
      );
    });

    const clientDb = testEnv
      .authenticatedContext('some-client', { roles: ['client'] })
      .firestore() as unknown as Firestore;
    const adapter = createAdapter(clientDb);

    const result = await adapter.findById(session.id);
    expect(result.isFailure()).toBe(true);
  });
});
