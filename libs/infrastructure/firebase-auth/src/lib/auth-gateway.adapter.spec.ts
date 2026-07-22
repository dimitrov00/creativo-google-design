import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { Auth, User } from 'firebase/auth';
import { FIREBASE_AUTH } from '@creativo/infrastructure/firebase-app';
import { FirebaseAuthGateway } from './auth-gateway.adapter';

const { onIdTokenChangedMock, getIdTokenMock, signOutMock } = vi.hoisted(
  () => ({
    onIdTokenChangedMock: vi.fn(),
    getIdTokenMock: vi.fn(),
    signOutMock: vi.fn(),
  }),
);

vi.mock('firebase/auth', () => ({
  onIdTokenChanged: onIdTokenChangedMock,
  getIdToken: getIdTokenMock,
  signOut: signOutMock,
}));

function fakeUser(uid: string, claims: Record<string, unknown>): User {
  return {
    uid,
    getIdTokenResult: vi.fn().mockResolvedValue({ claims }),
  } as unknown as User;
}

function createGateway(auth: Auth): FirebaseAuthGateway {
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_AUTH, useValue: auth },
      FirebaseAuthGateway,
    ],
  });
  return TestBed.inject(FirebaseAuthGateway);
}

describe('FirebaseAuthGateway', () => {
  let auth: Auth;

  beforeEach(() => {
    vi.clearAllMocks();
    auth = { currentUser: null } as unknown as Auth;
  });

  describe('observePrincipal', () => {
    it('emits the anonymous principal when there is no user', () => {
      onIdTokenChangedMock.mockImplementation(
        (_auth: Auth, next: (u: User | null) => void) => {
          next(null);
          return () => undefined;
        },
      );
      const gateway = createGateway(auth);

      const seen: unknown[] = [];
      gateway.observePrincipal().subscribe((p) => seen.push(p));

      expect(seen).toEqual([{ kind: 'anonymous' }]);
    });

    it('emits an active principal with roles for a token with active claims', async () => {
      onIdTokenChangedMock.mockImplementation(
        (_auth: Auth, next: (u: User | null) => void) => {
          next(fakeUser('user-1', { stage: 'active', roles: ['client'] }));
          return () => undefined;
        },
      );
      const gateway = createGateway(auth);

      const seen: unknown[] = [];
      gateway.observePrincipal().subscribe((p) => seen.push(p));
      await vi.waitFor(() => expect(seen.length).toBe(1));

      expect(seen[0]).toEqual({
        kind: 'active',
        uid: expect.objectContaining({ value: 'user-1' }),
        roles: ['client'],
      });
    });

    it('emits an onboarding principal when claims have not flipped to active yet', async () => {
      onIdTokenChangedMock.mockImplementation(
        (_auth: Auth, next: (u: User | null) => void) => {
          next(fakeUser('user-2', { stage: 'onboarding' }));
          return () => undefined;
        },
      );
      const gateway = createGateway(auth);

      const seen: unknown[] = [];
      gateway.observePrincipal().subscribe((p) => seen.push(p));
      await vi.waitFor(() => expect(seen.length).toBe(1));

      expect(seen[0]).toEqual({
        kind: 'onboarding',
        uid: expect.objectContaining({ value: 'user-2' }),
      });
    });
  });

  describe('refreshToken', () => {
    it('fails when there is no signed-in user', async () => {
      const gateway = createGateway(auth);
      const result = await gateway.refreshToken();
      expect(result.isFailure()).toBe(true);
    });

    it('forces a token refresh for the current user', async () => {
      auth = { currentUser: fakeUser('user-1', {}) } as unknown as Auth;
      getIdTokenMock.mockResolvedValue('a-token');
      const gateway = createGateway(auth);

      const result = await gateway.refreshToken();

      expect(result.isSuccess()).toBe(true);
      expect(getIdTokenMock).toHaveBeenCalledWith(auth.currentUser, true);
    });

    it('surfaces a failure when the SDK call throws', async () => {
      auth = { currentUser: fakeUser('user-1', {}) } as unknown as Auth;
      getIdTokenMock.mockRejectedValue(new Error('network error'));
      const gateway = createGateway(auth);

      const result = await gateway.refreshToken();

      expect(result.isFailure()).toBe(true);
    });
  });

  describe('signOut', () => {
    it('signs out successfully', async () => {
      signOutMock.mockResolvedValue(undefined);
      const gateway = createGateway(auth);

      const result = await gateway.signOut();

      expect(result.isSuccess()).toBe(true);
      expect(signOutMock).toHaveBeenCalledWith(auth);
    });

    it('surfaces a failure when the SDK call throws', async () => {
      signOutMock.mockRejectedValue(new Error('network error'));
      const gateway = createGateway(auth);

      const result = await gateway.signOut();

      expect(result.isFailure()).toBe(true);
    });
  });
});
