import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { Auth, User } from 'firebase/auth';
import { FIREBASE_AUTH } from '@creativo/infrastructure/firebase-app';
import { FirebaseAuthGateway } from './auth-gateway.adapter';

const {
  onIdTokenChangedMock,
  getIdTokenMock,
  signOutMock,
  signInWithCustomTokenMock,
} = vi.hoisted(() => ({
  onIdTokenChangedMock: vi.fn(),
  getIdTokenMock: vi.fn(),
  signOutMock: vi.fn(),
  signInWithCustomTokenMock: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  onIdTokenChanged: onIdTokenChangedMock,
  getIdToken: getIdTokenMock,
  signOut: signOutMock,
  signInWithCustomToken: signInWithCustomTokenMock,
}));

/** The payload of an unsigned custom token, as the emulator would read it. */
function decodeToken(token: string): {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: string;
} {
  const [header = '', payload = '', signature = ''] = token.split('.');
  const read = (part: string) =>
    JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as Record<
      string,
      unknown
    >;
  return { header: read(header), payload: read(payload), signature };
}

function fakeUser(uid: string, claims: Record<string, unknown>): User {
  return {
    uid,
    getIdTokenResult: vi.fn().mockResolvedValue({ claims }),
    // refreshToken reloads the record before refreshing the token (the
    // displayName stamp must land session-side).
    reload: vi.fn().mockResolvedValue(undefined),
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
    localStorage.clear();
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
      // No emulator, no revival: production never mints a token for itself.
      expect(signInWithCustomTokenMock).not.toHaveBeenCalled();
    });
  });

  describe('the emulator forgetting a session', () => {
    // Owner, 2026-09-17: "why is it logging out all the time? isn't the
    // session kept forever?" — the Auth emulator drops every refresh token
    // on restart; the gateway signs the remembered session back in.
    const user = () =>
      fakeUser('dev-staff-ivan', { stage: 'active', roles: ['barber'] });
    /** A task boundary, so a sign-in on its way has landed. */
    const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
    let next: (u: User | null) => void = () => undefined;

    beforeEach(() => {
      auth = {
        currentUser: user(),
        emulatorConfig: { host: '127.0.0.1', port: 9099 },
      } as unknown as Auth;
      onIdTokenChangedMock.mockImplementation(
        (_auth: Auth, listener: (u: User | null) => void) => {
          next = listener;
          listener(user());
          return () => undefined;
        },
      );
    });

    it('signs the remembered session back in when a refresh fails, with an unsigned token carrying its uid and claims', async () => {
      const gateway = createGateway(auth);
      const seen: unknown[] = [];
      gateway.observePrincipal().subscribe((p) => seen.push(p));
      await vi.waitFor(() => expect(seen.length).toBe(1));
      getIdTokenMock.mockRejectedValue(
        Object.assign(new Error('gone'), { code: 'auth/user-token-expired' }),
      );
      signInWithCustomTokenMock.mockResolvedValue({});

      const result = await gateway.refreshToken();

      expect(result.isSuccess()).toBe(true);
      expect(signInWithCustomTokenMock).toHaveBeenCalledTimes(1);
      const [target, token] = signInWithCustomTokenMock.mock.calls[0] as [
        Auth,
        string,
      ];
      expect(target).toBe(auth);
      const { header, payload, signature } = decodeToken(token);
      expect(header).toEqual({ alg: 'none', typ: 'JWT' });
      expect(signature).toBe('');
      expect(payload['uid']).toBe('dev-staff-ivan');
      expect(payload['claims']).toEqual({ stage: 'active', roles: ['barber'] });
      expect(payload['iss']).toBe('firebase-auth-emulator@example.com');
    });

    it('brings the session back when the SDK reports nobody, and falls to anonymous only when the emulator refuses', async () => {
      const gateway = createGateway(auth);
      const seen: unknown[] = [];
      gateway.observePrincipal().subscribe((p) => seen.push(p));
      await vi.waitFor(() => expect(seen.length).toBe(1));

      signInWithCustomTokenMock.mockResolvedValue({});
      next(null);
      await vi.waitFor(() =>
        expect(signInWithCustomTokenMock).toHaveBeenCalledTimes(1),
      );
      // Nothing anonymous was emitted while the sign-in was on its way.
      expect(seen.length).toBe(1);
      // The sign-in lands (the SDK would now report the user again); the
      // SDK's next report comes a task later, never in the same tick.
      await settled();

      signInWithCustomTokenMock.mockRejectedValue(new Error('refused'));
      next(null);
      await vi.waitFor(() => expect(seen.length).toBe(2));
      expect(seen[1]).toEqual({ kind: 'anonymous' });
      await settled();
      // Refused once, forgotten: the next nobody is nobody, and no token
      // is minted for them.
      next(null);
      await vi.waitFor(() => expect(seen.length).toBe(3));
      expect(signInWithCustomTokenMock).toHaveBeenCalledTimes(2);
    });

    it('never revives a session that was ended on purpose', async () => {
      signOutMock.mockResolvedValue(undefined);
      const gateway = createGateway(auth);
      const seen: unknown[] = [];
      gateway.observePrincipal().subscribe((p) => seen.push(p));
      await vi.waitFor(() => expect(seen.length).toBe(1));

      await gateway.signOut();
      next(null);
      await vi.waitFor(() => expect(seen.length).toBe(2));
      expect(seen[1]).toEqual({ kind: 'anonymous' });
      expect(signInWithCustomTokenMock).not.toHaveBeenCalled();
      expect(localStorage.getItem('creativo.emulator-session')).toBeNull();
    });
  });

  describe('currentIdentifier', () => {
    it('returns null when no user is signed in', () => {
      const gateway = createGateway(auth);
      expect(gateway.currentIdentifier()).toBeNull();
    });

    it('derives a phone identifier from the Auth record phone number', () => {
      auth = {
        currentUser: { phoneNumber: '+359885550100', email: null },
      } as unknown as Auth;
      const gateway = createGateway(auth);

      const identifier = gateway.currentIdentifier();

      expect(identifier?.kind).toBe('phone');
      expect(identifier?.value.toString()).toBe('+359885550100');
    });

    it('derives an email identifier when only an email is set', () => {
      auth = {
        currentUser: { phoneNumber: null, email: 'ana@example.com' },
      } as unknown as Auth;
      const gateway = createGateway(auth);

      const identifier = gateway.currentIdentifier();

      expect(identifier?.kind).toBe('email');
      expect(identifier?.value.toString()).toBe('ana@example.com');
    });

    it('returns null for a user record carrying neither channel', () => {
      auth = {
        currentUser: { phoneNumber: null, email: null },
      } as unknown as Auth;
      const gateway = createGateway(auth);

      expect(gateway.currentIdentifier()).toBeNull();
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
