import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Auth, User } from 'firebase/auth';
import { IdentifierChannel } from '@core/primitives';
import { PipelineError, PipelineErrorCode } from '@core/errors';
import { Principal, PrincipalKind, Role } from '@core/components';
import { FIXTURE_TENANT_ID, unwrapErr } from '@core/testing';
import { authSessionPorts } from './auth-session.adapter';

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

/** A token's claims as `completeRegistration` mints them: tenant, stage, roles. */
const ACTIVE_CLIENT = {
  tenantId: FIXTURE_TENANT_ID,
  stage: 'active',
  roles: ['client'],
};

describe('authSessionPorts', () => {
  let auth: Auth;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    auth = { currentUser: null } as unknown as Auth;
  });

  /** Every principal the stream emitted, in order. */
  function watch(ports: ReturnType<typeof authSessionPorts>): Principal[] {
    const seen: Principal[] = [];
    ports.observePrincipal().subscribe((p) => seen.push(p));
    return seen;
  }

  function streamOf(user: User | null): void {
    onIdTokenChangedMock.mockImplementation(
      (_auth: Auth, next: (u: User | null) => void) => {
        next(user);
        return () => undefined;
      },
    );
  }

  describe('observePrincipal', () => {
    it('emits the anonymous principal when there is no user', () => {
      streamOf(null);

      const seen = watch(authSessionPorts(auth));

      expect(seen).toEqual([Principal.anonymous()]);
    });

    it('emits an active CLIENT principal with roles and tenant for a token with active claims', async () => {
      streamOf(fakeUser('user-1', ACTIVE_CLIENT));

      const seen = watch(authSessionPorts(auth));
      await vi.waitFor(() => expect(seen.length).toBe(1));

      expect(seen[0]).toEqual({
        principalKind: PrincipalKind.Client,
        userId: 'user-1',
        roles: [Role.Client],
        tenantId: FIXTURE_TENANT_ID,
      });
    });

    it('emits a STAFF principal for a token holding a staff role', async () => {
      streamOf(
        fakeUser('dev-staff-ivan', { ...ACTIVE_CLIENT, roles: ['barber'] }),
      );

      const seen = watch(authSessionPorts(auth));
      await vi.waitFor(() => expect(seen.length).toBe(1));

      expect(seen[0]?.principalKind).toBe(PrincipalKind.Staff);
      expect(Principal.hasRole(seen[0] as Principal, Role.Barber)).toBe(true);
    });

    it('emits an onboarding principal when claims have not flipped to active yet', async () => {
      streamOf(
        fakeUser('user-2', {
          tenantId: FIXTURE_TENANT_ID,
          stage: 'onboarding',
        }),
      );

      const seen = watch(authSessionPorts(auth));
      await vi.waitFor(() => expect(seen.length).toBe(1));

      expect(seen[0]).toEqual({
        principalKind: PrincipalKind.Onboarding,
        userId: 'user-2',
        tenantId: FIXTURE_TENANT_ID,
      });
    });

    // Departure 4A-2 (b): an `active` token with no tenant (or no roles) is
    // ONBOARDING through `Principal.fromClaims` — the legacy `principalFrom`
    // read it active. This app never mints such a token.
    it.each([
      ['no tenant', { stage: 'active', roles: ['client'] }],
      ['no roles', { tenantId: FIXTURE_TENANT_ID, stage: 'active', roles: [] }],
    ])(
      'reads an active token with %s as ONBOARDING (4A-2 (b))',
      async (_what, claims) => {
        streamOf(fakeUser('user-3', claims));

        const seen = watch(authSessionPorts(auth));
        await vi.waitFor(() => expect(seen.length).toBe(1));

        expect(seen[0]?.principalKind).toBe(PrincipalKind.Onboarding);
        expect(Principal.isActive(seen[0] as Principal)).toBe(false);
      },
    );

    it('emits the anonymous principal when the token cannot be read', async () => {
      const user = {
        uid: 'user-4',
        getIdTokenResult: vi.fn().mockRejectedValue(new Error('offline')),
      } as unknown as User;
      streamOf(user);

      const seen = watch(authSessionPorts(auth));
      await vi.waitFor(() => expect(seen.length).toBe(1));

      expect(seen[0]).toEqual(Principal.anonymous());
    });
  });

  describe('refreshToken', () => {
    it('fails, retryable, when there is no signed-in user — no session gone, nothing to sign out', async () => {
      const result = await authSessionPorts(auth).refreshToken();

      expect(unwrapErr(result)).toEqual(
        PipelineError.bare(PipelineErrorCode.Unavailable),
      );
    });

    it('forces a token refresh for the current user', async () => {
      auth = { currentUser: fakeUser('user-1', {}) } as unknown as Auth;
      getIdTokenMock.mockResolvedValue('a-token');

      const result = await authSessionPorts(auth).refreshToken();

      expect(result.ok).toBe(true);
      expect(getIdTokenMock).toHaveBeenCalledWith(auth.currentUser, true);
    });

    it('surfaces a network failure as retryable, never minting a token in production', async () => {
      auth = { currentUser: fakeUser('user-1', {}) } as unknown as Auth;
      getIdTokenMock.mockRejectedValue(
        Object.assign(new Error('network error'), {
          code: 'auth/network-request-failed',
        }),
      );

      const result = await authSessionPorts(auth).refreshToken();

      expect(unwrapErr(result).errorCode).toBe(PipelineErrorCode.Unavailable);
      // No emulator, no revival: production never mints a token for itself.
      expect(signInWithCustomTokenMock).not.toHaveBeenCalled();
    });

    // The SDK's codes for a session that no longer exists on the server: the
    // one refresh failure the shell's session check signs out for.
    it.each([
      'auth/user-token-expired',
      'auth/user-not-found',
      'auth/user-disabled',
      'auth/invalid-user-token',
      'auth/null-user',
    ])(
      'reads %s as the session gone: PIPELINE_UNAUTHENTICATED',
      async (code) => {
        auth = { currentUser: fakeUser('user-1', {}) } as unknown as Auth;
        getIdTokenMock.mockRejectedValue(
          Object.assign(new Error('gone'), { code }),
        );

        const result = await authSessionPorts(auth).refreshToken();

        expect(unwrapErr(result)).toEqual(
          PipelineError.bare(PipelineErrorCode.Unauthenticated),
        );
      },
    );
  });

  describe('the emulator forgetting a session', () => {
    // Owner, 2026-09-17: "why is it logging out all the time? isn't the
    // session kept forever?" — the Auth emulator drops every refresh token
    // on restart; the session signs the remembered one back in.
    const STAFF_CLAIMS = {
      tenantId: FIXTURE_TENANT_ID,
      stage: 'active',
      roles: ['barber'],
    };
    const user = () => fakeUser('dev-staff-ivan', STAFF_CLAIMS);
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

    it('signs the remembered session back in when a refresh fails, with an unsigned token carrying its uid and the TOKEN’s claims (the `stage` key)', async () => {
      const ports = authSessionPorts(auth);
      const seen = watch(ports);
      await vi.waitFor(() => expect(seen.length).toBe(1));
      getIdTokenMock.mockRejectedValue(
        Object.assign(new Error('gone'), { code: 'auth/user-token-expired' }),
      );
      signInWithCustomTokenMock.mockResolvedValue({});

      const result = await ports.refreshToken();

      expect(result.ok).toBe(true);
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
      // Never the struct (`authStage`): re-minted from it, every revived
      // session would read as onboarding (§9 R2).
      expect(payload['claims']).toEqual(STAFF_CLAIMS);
      expect(payload['iss']).toBe('firebase-auth-emulator@example.com');
    });

    it('re-reads the stored claims through the one claims rule before minting', async () => {
      localStorage.setItem(
        'creativo.emulator-session',
        JSON.stringify({
          uid: 'dev-staff-ivan',
          claims: { ...STAFF_CLAIMS, roles: ['barber', 'wizard'], extra: 1 },
        }),
      );
      auth = {
        currentUser: fakeUser('dev-staff-ivan', {}),
        emulatorConfig: { host: '127.0.0.1', port: 9099 },
      } as unknown as Auth;
      getIdTokenMock.mockRejectedValue(new Error('gone'));
      signInWithCustomTokenMock.mockResolvedValue({});

      await authSessionPorts(auth).refreshToken();

      const [, token] = signInWithCustomTokenMock.mock.calls[0] as [
        Auth,
        string,
      ];
      expect(decodeToken(token).payload['claims']).toEqual(STAFF_CLAIMS);
    });

    it('brings the session back when the SDK reports nobody, and falls to anonymous only when the emulator refuses', async () => {
      const seen = watch(authSessionPorts(auth));
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
      expect(seen[1]).toEqual(Principal.anonymous());
      await settled();
      // Refused once, forgotten: the next nobody is nobody, and no token
      // is minted for them.
      next(null);
      await vi.waitFor(() => expect(seen.length).toBe(3));
      expect(signInWithCustomTokenMock).toHaveBeenCalledTimes(2);
    });

    it('never revives a session that was ended on purpose', async () => {
      signOutMock.mockResolvedValue(undefined);
      const ports = authSessionPorts(auth);
      const seen = watch(ports);
      await vi.waitFor(() => expect(seen.length).toBe(1));

      await ports.signOut();
      next(null);
      await vi.waitFor(() => expect(seen.length).toBe(2));
      expect(seen[1]).toEqual(Principal.anonymous());
      expect(signInWithCustomTokenMock).not.toHaveBeenCalled();
      expect(localStorage.getItem('creativo.emulator-session')).toBeNull();
    });
  });

  describe('currentIdentifier', () => {
    it('returns null when no user is signed in', () => {
      expect(authSessionPorts(auth).currentIdentifier()).toBeNull();
    });

    it('derives a phone identifier from the Auth record phone number', () => {
      auth = {
        currentUser: { phoneNumber: '+359885550100', email: null },
      } as unknown as Auth;

      expect(authSessionPorts(auth).currentIdentifier()).toEqual({
        identifierChannel: IdentifierChannel.Phone,
        identifier: '+359885550100',
      });
    });

    it('derives an email identifier when only an email is set', () => {
      auth = {
        currentUser: { phoneNumber: null, email: 'ana@example.com' },
      } as unknown as Auth;

      expect(authSessionPorts(auth).currentIdentifier()).toEqual({
        identifierChannel: IdentifierChannel.Email,
        identifier: 'ana@example.com',
      });
    });

    it('prefers the phone when the record carries both', () => {
      auth = {
        currentUser: {
          phoneNumber: '+359885550100',
          email: 'ana@example.com',
        },
      } as unknown as Auth;

      expect(
        authSessionPorts(auth).currentIdentifier()?.identifierChannel,
      ).toBe(IdentifierChannel.Phone);
    });

    it('returns null for a user record carrying neither channel', () => {
      auth = {
        currentUser: { phoneNumber: null, email: null },
      } as unknown as Auth;

      expect(authSessionPorts(auth).currentIdentifier()).toBeNull();
    });
  });

  describe('currentDisplayName', () => {
    it('reads the Auth record’s name, null when signed out or never set', () => {
      expect(authSessionPorts(auth).currentDisplayName()).toBeNull();
      auth = { currentUser: { displayName: '' } } as unknown as Auth;
      expect(authSessionPorts(auth).currentDisplayName()).toBeNull();
      auth = { currentUser: { displayName: 'Ана' } } as unknown as Auth;
      expect(authSessionPorts(auth).currentDisplayName()).toBe('Ана');
    });
  });

  describe('signOut', () => {
    it('signs out successfully', async () => {
      signOutMock.mockResolvedValue(undefined);

      const result = await authSessionPorts(auth).signOut();

      expect(result.ok).toBe(true);
      expect(signOutMock).toHaveBeenCalledWith(auth);
    });

    it('surfaces a failure when the SDK call throws', async () => {
      signOutMock.mockRejectedValue(new Error('network error'));

      const result = await authSessionPorts(auth).signOut();

      expect(unwrapErr(result).errorCode).toBe(PipelineErrorCode.Unavailable);
    });
  });
});
