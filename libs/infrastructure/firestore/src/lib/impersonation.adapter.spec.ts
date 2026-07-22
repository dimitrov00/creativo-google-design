import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { Firestore } from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { ZonedDateTime } from '@creativo/domain/kernel';
import {
  ImpersonationSession,
  ImpersonationSessionId,
} from '@creativo/domain/governance';
import { UserId } from '@creativo/domain/accounts';
import { FirestoreImpersonationAdapter } from './impersonation.adapter';

const setMock = vi.fn();
const commitMock = vi.fn().mockResolvedValue(undefined);
const getDocMock = vi.fn();
const getDocsMock = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, ...segments: string[]) => ({
    path: segments.join('/'),
  })),
  doc: vi.fn((_db, ...segments: string[]) => ({ path: segments.join('/') })),
  getDoc: (...args: unknown[]) => getDocMock(...args),
  getDocs: (...args: unknown[]) => getDocsMock(...args),
  query: vi.fn((ref) => ref),
  where: vi.fn((field, op, value) => ({ field, op, value })),
  limit: vi.fn((n) => ({ limit: n })),
  writeBatch: vi.fn(() => ({
    set: setMock,
    commit: commitMock,
  })),
}));

function buildSession(): ImpersonationSession {
  const now = ZonedDateTime.now('UTC');
  if (now.isFailure()) throw new Error('bad now');
  const result = ImpersonationSession.start({
    id: ImpersonationSessionId.generate().value,
    adminUserId: UserId.generate().value,
    targetUserId: UserId.generate().value,
    scope: 'write',
    reason: 'support ticket #123',
    startedAtIso: now.value.toISO(),
    expiresAtIso: now.value.plusMinutes(30).toISO(),
    adminRoles: ['admin'],
  });
  if (result.isFailure()) {
    throw new Error(`fixture build failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function createAdapter(fakeDb: Firestore): FirestoreImpersonationAdapter {
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_FIRESTORE, useValue: fakeDb },
      FirestoreImpersonationAdapter,
    ],
  });
  return TestBed.inject(FirestoreImpersonationAdapter);
}

describe('FirestoreImpersonationAdapter', () => {
  const fakeDb = {} as Firestore;

  beforeEach(() => {
    setMock.mockClear();
    commitMock.mockClear();
    getDocMock.mockReset();
    getDocsMock.mockReset();
  });

  it('save() batches the session write with an audit log entry', async () => {
    const adapter = createAdapter(fakeDb);
    const session = buildSession();

    const result = await adapter.save(session);

    expect(result.isSuccess()).toBe(true);
    expect(setMock).toHaveBeenCalledTimes(2);
    expect(commitMock).toHaveBeenCalledTimes(1);

    const [, sessionDoc] = setMock.mock.calls[0] ?? [];
    expect(sessionDoc).toMatchObject({
      adminUserId: session.adminUserId.value,
      targetUserId: session.targetUserId.value,
      scope: 'write',
      status: { kind: 'active' },
    });

    const [, auditDoc] = setMock.mock.calls[1] ?? [];
    expect(auditDoc).toMatchObject({
      action: 'impersonation.started',
      targetUserId: session.targetUserId.value,
      resourceId: session.id.value,
      actor: { kind: 'admin', adminUserId: session.adminUserId.value },
    });
  });

  it('findById() returns null for a missing document', async () => {
    getDocMock.mockResolvedValue({ exists: () => false });
    const adapter = createAdapter(fakeDb);

    const result = await adapter.findById(ImpersonationSessionId.generate());

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value).toBeNull();
    }
  });

  it('findById() reconstitutes a found document', async () => {
    const session = buildSession();
    getDocMock.mockResolvedValue({
      exists: () => true,
      id: session.id.value,
      data: () => ({
        adminUserId: session.adminUserId.value,
        targetUserId: session.targetUserId.value,
        scope: session.scope,
        reason: session.reason,
        startedAt: session.startedAt.toISO(),
        expiresAt: session.expiresAt.toISO(),
        status: { kind: 'active' },
      }),
    });
    const adapter = createAdapter(fakeDb);

    const result = await adapter.findById(session.id);

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value?.id.value).toBe(session.id.value);
      expect(result.value?.isActive()).toBe(true);
    }
  });

  it('findActiveForAdmin() returns null when no active session exists', async () => {
    getDocsMock.mockResolvedValue({ empty: true, docs: [] });
    const adapter = createAdapter(fakeDb);

    const result = await adapter.findActiveForAdmin(UserId.generate());

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value).toBeNull();
    }
  });

  it('surfaces a RepositoryError when the batch commit rejects', async () => {
    commitMock.mockRejectedValueOnce(new Error('offline'));
    const adapter = createAdapter(fakeDb);

    const result = await adapter.save(buildSession());

    expect(result.isFailure()).toBe(true);
  });
});
