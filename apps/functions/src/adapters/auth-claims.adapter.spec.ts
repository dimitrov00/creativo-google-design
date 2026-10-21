import type { Auth } from 'firebase-admin/auth';
import { PipelineErrorCode, TenantId, UserId } from '@core/primitives';
import {
  AuthClaims,
  AuthStage,
  E164,
  Email,
  ParsedIdentifier,
  Role,
} from '@core/components';
import type { AuthAdminPorts, AuthUserLookupPorts } from '@core/ports';
import { authClaimsPorts } from './auth-claims.adapter';

type FakeAuth = {
  readonly createCustomToken: ReturnType<typeof vi.fn>;
  readonly setCustomUserClaims: ReturnType<typeof vi.fn>;
  readonly createUser: ReturnType<typeof vi.fn>;
  readonly getUserByEmail: ReturnType<typeof vi.fn>;
  readonly getUserByPhoneNumber: ReturnType<typeof vi.fn>;
  readonly updateUser: ReturnType<typeof vi.fn>;
};

function fakeAuth(): FakeAuth {
  return {
    createCustomToken: vi.fn(async () => 'token-1'),
    setCustomUserClaims: vi.fn(async () => undefined),
    createUser: vi.fn(async () => ({ uid: 'uid-new' })),
    getUserByEmail: vi.fn(async () => ({ uid: 'uid-mail' })),
    getUserByPhoneNumber: vi.fn(async () => ({ uid: 'uid-phone' })),
    updateUser: vi.fn(async () => ({ uid: 'u-1' })),
  };
}

const asAuth = (auth: FakeAuth): Auth => auth as unknown as Auth;

/** An Admin SDK error as it is thrown: a code on an Error. */
const authError = (code: string | number): Error =>
  Object.assign(new Error(`auth failed: ${code}`), { code });

const TENANT = TenantId.of('creativo');
const UID = UserId.of('u-1');
const PHONE = ParsedIdentifier.phone(E164.of('+359888123456'));
const EMAIL = ParsedIdentifier.email(Email.of('ana@example.com'));

function unwrapActive(roles: readonly Role[]): AuthClaims {
  const claims = AuthClaims.active(TENANT, roles);
  if (!claims.ok) throw new Error('fixture');
  return claims.value;
}

function activeClaims(): AuthClaims {
  return unwrapActive([Role.Barber, Role.Admin]);
}

describe('auth-claims adapter', () => {
  it('is the intersection of the two bundles it serves — AuthAdminPorts & AuthUserLookupPorts', () => {
    const ports: AuthAdminPorts & AuthUserLookupPorts = authClaimsPorts(
      asAuth(fakeAuth()),
    );
    expect(Object.keys(ports).sort()).toEqual([
      'findAuthUserByDestination',
      'mintCustomToken',
      'provisionAuthUser',
      'setClaims',
      'setDisplayName',
    ]);
  });

  describe('the claims on the token — today’s shape', () => {
    it('mints an active token with { tenantId, stage, roles }', async () => {
      const auth = fakeAuth();
      const result = await authClaimsPorts(asAuth(auth)).mintCustomToken(
        UID,
        activeClaims(),
      );
      expect(result).toEqual({ ok: true, value: 'token-1' });
      expect(auth.createCustomToken).toHaveBeenCalledWith('u-1', {
        tenantId: 'creativo',
        stage: 'active',
        roles: ['barber', 'admin'],
      });
    });

    it('mints an onboarding token WITHOUT a roles key', async () => {
      const auth = fakeAuth();
      await authClaimsPorts(asAuth(auth)).mintCustomToken(
        UID,
        AuthClaims.onboarding(TENANT),
      );
      const [, claims] = auth.createCustomToken.mock.calls[0] ?? [];
      expect(claims).toEqual({ tenantId: 'creativo', stage: 'onboarding' });
      expect(claims).not.toHaveProperty('roles');
    });

    it('writes exactly what the pre-flip token adapter wrote — its recorded calls, pinned', async () => {
      // Recorded from the deleted Admin-Auth token adapter before the
      // identity flip removed it: a mint and a claims-set, byte for byte.
      const auth = fakeAuth();
      const ports = authClaimsPorts(asAuth(auth));
      await ports.mintCustomToken(UID, activeClaims());
      await ports.setClaims(UID, AuthClaims.onboarding(TENANT));
      expect(auth.createCustomToken.mock.calls).toEqual([
        [
          'u-1',
          { tenantId: 'creativo', stage: 'active', roles: ['barber', 'admin'] },
        ],
      ]);
      expect(auth.setCustomUserClaims.mock.calls).toEqual([
        ['u-1', { tenantId: 'creativo', stage: 'onboarding' }],
      ]);
    });

    it('sets custom claims for an already-signed-in user — the active claims with roles', async () => {
      const auth = fakeAuth();
      const result = await authClaimsPorts(asAuth(auth)).setClaims(
        UserId.of('uid_3'),
        unwrapActive([Role.Client]),
      );
      expect(result).toEqual({ ok: true, value: undefined });
      expect(auth.setCustomUserClaims).toHaveBeenCalledWith('uid_3', {
        tenantId: 'creativo',
        stage: 'active',
        roles: ['client'],
      });
    });

    it('leaves out a tenant the claims do not carry', async () => {
      const auth = fakeAuth();
      await authClaimsPorts(asAuth(auth)).setClaims(UID, {
        tenantId: null,
        authStage: AuthStage.Onboarding,
        roles: [],
      });
      expect(auth.setCustomUserClaims).toHaveBeenCalledWith('u-1', {
        stage: 'onboarding',
      });
    });
  });

  it('writes the component’s own stored shape — AuthClaims.toToken, nothing mapped here', async () => {
    const auth = fakeAuth();
    const ports = authClaimsPorts(asAuth(auth));
    for (const claims of [activeClaims(), AuthClaims.onboarding(TENANT)]) {
      await ports.mintCustomToken(UID, claims);
      await ports.setClaims(UID, claims);
      expect(auth.createCustomToken).toHaveBeenLastCalledWith(
        'u-1',
        AuthClaims.toToken(claims),
      );
      expect(auth.setCustomUserClaims).toHaveBeenLastCalledWith(
        'u-1',
        AuthClaims.toToken(claims),
      );
    }
  });

  describe('the Auth user’s display name', () => {
    it('sets it with updateUser — the one call the pre-flip setDisplayName made', async () => {
      const auth = fakeAuth();
      const result = await authClaimsPorts(asAuth(auth)).setDisplayName(
        UID,
        'Ана Петрова',
      );
      expect(result).toEqual({ ok: true, value: undefined });
      expect(auth.updateUser.mock.calls).toEqual([
        ['u-1', { displayName: 'Ана Петрова' }],
      ]);
    });

    it('answers a failure as a value — the caller ignores it, as today', async () => {
      const auth = fakeAuth();
      auth.updateUser.mockRejectedValueOnce(authError('auth/user-not-found'));
      const result = await authClaimsPorts(asAuth(auth)).setDisplayName(
        UID,
        'Ана Петрова',
      );
      expect(result).toEqual({
        ok: false,
        error: {
          errorCode: PipelineErrorCode.Unknown,
          serverErrorCode: null,
          refusal: 'auth/user-not-found',
          field: null,
        },
      });
    });
  });

  describe('failures are values', () => {
    it('a permanent Admin SDK refusal is `unknown`, its code as the refusal', async () => {
      const auth = fakeAuth();
      auth.createCustomToken.mockRejectedValueOnce(
        authError('auth/invalid-uid'),
      );
      const result = await authClaimsPorts(asAuth(auth)).mintCustomToken(
        UID,
        activeClaims(),
      );
      expect(result).toEqual({
        ok: false,
        error: {
          errorCode: PipelineErrorCode.Unknown,
          serverErrorCode: null,
          refusal: 'auth/invalid-uid',
          field: null,
        },
      });
    });

    it('a transient one is `unavailable` — the same call later is the fix', async () => {
      const auth = fakeAuth();
      auth.setCustomUserClaims.mockRejectedValueOnce(authError(14));
      const result = await authClaimsPorts(asAuth(auth)).setClaims(
        UID,
        activeClaims(),
      );
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error.errorCode).toBe(PipelineErrorCode.Unavailable);
    });
  });

  describe('the first-verification race', () => {
    it('provisions a phone user by phoneNumber and an e-mail user by email', async () => {
      const auth = fakeAuth();
      const ports = authClaimsPorts(asAuth(auth));
      expect(await ports.provisionAuthUser(PHONE)).toEqual({
        ok: true,
        value: 'uid-new',
      });
      await ports.provisionAuthUser(EMAIL);
      expect(auth.createUser.mock.calls).toEqual([
        [{ phoneNumber: '+359888123456' }],
        [{ email: 'ana@example.com' }],
      ]);
    });

    it('answers null to the race loser — Auth already holds the destination', async () => {
      const auth = fakeAuth();
      auth.createUser
        .mockRejectedValueOnce(authError('auth/phone-number-already-exists'))
        .mockRejectedValueOnce(authError('auth/email-already-exists'));
      const ports = authClaimsPorts(asAuth(auth));
      expect(await ports.provisionAuthUser(PHONE)).toEqual({
        ok: true,
        value: null,
      });
      expect(await ports.provisionAuthUser(EMAIL)).toEqual({
        ok: true,
        value: null,
      });
    });

    it('refuses any other createUser failure', async () => {
      const auth = fakeAuth();
      auth.createUser.mockRejectedValueOnce(
        authError('auth/invalid-phone-number'),
      );
      const result = await authClaimsPorts(asAuth(auth)).provisionAuthUser(
        PHONE,
      );
      expect(result.ok).toBe(false);
    });

    it('finds the winner by the destination’s own lookup', async () => {
      const auth = fakeAuth();
      const ports = authClaimsPorts(asAuth(auth));
      expect(await ports.findAuthUserByDestination(PHONE)).toEqual({
        ok: true,
        value: 'uid-phone',
      });
      expect(await ports.findAuthUserByDestination(EMAIL)).toEqual({
        ok: true,
        value: 'uid-mail',
      });
      expect(auth.getUserByPhoneNumber).toHaveBeenCalledWith('+359888123456');
      expect(auth.getUserByEmail).toHaveBeenCalledWith('ana@example.com');
    });

    it('answers null when nobody holds the destination, and refuses other failures', async () => {
      const auth = fakeAuth();
      auth.getUserByEmail.mockRejectedValueOnce(
        authError('auth/user-not-found'),
      );
      auth.getUserByPhoneNumber.mockRejectedValueOnce(authError(14));
      const ports = authClaimsPorts(asAuth(auth));
      expect(await ports.findAuthUserByDestination(EMAIL)).toEqual({
        ok: true,
        value: null,
      });
      const failed = await ports.findAuthUserByDestination(PHONE);
      expect(failed.ok).toBe(false);
      if (!failed.ok)
        expect(failed.error.errorCode).toBe(PipelineErrorCode.Unavailable);
    });
  });
});
