import type { Auth } from 'firebase-admin/auth';
import { UserId } from '@core/primitives';
import { PipelineErrorCode } from '@core/errors';
import { Role } from '@core/components';
import type { AuthEraserPorts, AuthRolesPorts } from '@core/ports';
import { PRIVACY_SENTINELS } from '@core/testing';
import { authEraserPorts } from './firebase-auth-eraser.adapter';

/*
 * The erasure's Admin-Auth bundles (audit-hardening Phase 3, WS-D, §4 PD3):
 * the Auth user's claim roles (`null` when no Auth user exists) and its
 * deletion (`auth/user-not-found` is done); any other failure is a value
 * carrying the SDK's CODE only — never its message, which may quote the
 * person's phone or e-mail.
 */

type FakeAuth = {
  readonly getUser: ReturnType<typeof vi.fn>;
  readonly deleteUser: ReturnType<typeof vi.fn>;
};

function fakeAuth(customClaims: unknown = undefined): FakeAuth {
  return {
    getUser: vi.fn(async (uid: string) => ({ uid, customClaims })),
    deleteUser: vi.fn(async () => undefined),
  };
}

const asAuth = (auth: FakeAuth): Auth => auth as unknown as Auth;

/** An Admin SDK error as it is thrown: a code on an Error whose message names the person. */
const authError = (code: string | number): Error =>
  Object.assign(
    new Error(`auth failed for ${PRIVACY_SENTINELS.phone}: ${code}`),
    { code },
  );

const UID = UserId.of('u-erased');

describe('firebase-auth-eraser adapter', () => {
  it('is the intersection of the two bundles it serves — AuthEraserPorts & AuthRolesPorts', () => {
    const ports: AuthEraserPorts & AuthRolesPorts = authEraserPorts(
      asAuth(fakeAuth()),
    );
    expect(Object.keys(ports).sort()).toEqual([
      'deleteAuthUser',
      'loadAuthRoles',
    ]);
  });

  describe('loadAuthRoles', () => {
    it('answers the custom claims’ known roles, by the uid it was asked for', async () => {
      const auth = fakeAuth({
        tenantId: 'creativo',
        stage: 'active',
        roles: ['barber', 'admin', 'barber', 'wizard', 7],
      });
      const result = await authEraserPorts(asAuth(auth)).loadAuthRoles(UID);
      expect(result).toEqual({ ok: true, value: [Role.Barber, Role.Admin] });
      expect(auth.getUser).toHaveBeenCalledWith('u-erased');
    });

    it('reads the roles whatever the stage — a staff claim on a provisioned token still counts (fail-closed)', async () => {
      const auth = fakeAuth({ stage: 'provisioned', roles: ['receptionist'] });
      expect(await authEraserPorts(asAuth(auth)).loadAuthRoles(UID)).toEqual({
        ok: true,
        value: [Role.Receptionist],
      });
    });

    it.each([
      ['no claims', undefined],
      ['claims without roles', { tenantId: 'creativo' }],
      ['roles that are no list', { roles: 'admin' }],
      ['claims that are no object', 'admin'],
    ])('answers no roles for %s', async (_case, claims) => {
      expect(
        await authEraserPorts(asAuth(fakeAuth(claims))).loadAuthRoles(UID),
      ).toEqual({ ok: true, value: [] });
    });

    it('answers null when no Auth user holds the uid — auth/user-not-found is an answer', async () => {
      const auth = fakeAuth();
      auth.getUser.mockRejectedValueOnce(authError('auth/user-not-found'));
      expect(await authEraserPorts(asAuth(auth)).loadAuthRoles(UID)).toEqual({
        ok: true,
        value: null,
      });
    });

    it('answers any other failure as a value — its code only, never the message', async () => {
      const auth = fakeAuth();
      auth.getUser.mockRejectedValueOnce(authError('auth/internal-error'));
      const result = await authEraserPorts(asAuth(auth)).loadAuthRoles(UID);
      expect(result).toEqual({
        ok: false,
        error: {
          errorCode: PipelineErrorCode.Unknown,
          serverErrorCode: null,
          refusal: 'auth/internal-error',
          field: null,
          wireStatus: null,
          serverParams: {},
          operationId: null,
        },
      });
      expect(JSON.stringify(result)).not.toContain(PRIVACY_SENTINELS.phone);
    });

    it('answers a transient failure as `unavailable` — the next call is the fix', async () => {
      const auth = fakeAuth();
      auth.getUser.mockRejectedValueOnce(authError(14));
      const result = await authEraserPorts(asAuth(auth)).loadAuthRoles(UID);
      expect(!result.ok && result.error.errorCode).toBe(
        PipelineErrorCode.Unavailable,
      );
      expect(JSON.stringify(result)).not.toContain(PRIVACY_SENTINELS.phone);
    });
  });

  describe('deleteAuthUser', () => {
    it('deletes the Auth user by its uid — deleted, never disabled (P3-L-9)', async () => {
      const auth = fakeAuth();
      expect(await authEraserPorts(asAuth(auth)).deleteAuthUser(UID)).toEqual({
        ok: true,
        value: undefined,
      });
      expect(auth.deleteUser).toHaveBeenCalledTimes(1);
      expect(auth.deleteUser).toHaveBeenCalledWith('u-erased');
    });

    it('answers done when the Auth user is already gone — a resumed erasure deletes again', async () => {
      const auth = fakeAuth();
      auth.deleteUser.mockRejectedValueOnce(authError('auth/user-not-found'));
      expect(await authEraserPorts(asAuth(auth)).deleteAuthUser(UID)).toEqual({
        ok: true,
        value: undefined,
      });
    });

    it('answers any other failure as a value — its code only, never the message', async () => {
      const auth = fakeAuth();
      auth.deleteUser.mockRejectedValueOnce(
        authError('auth/insufficient-permission'),
      );
      const result = await authEraserPorts(asAuth(auth)).deleteAuthUser(UID);
      expect(result).toEqual({
        ok: false,
        error: {
          errorCode: PipelineErrorCode.Unknown,
          serverErrorCode: null,
          refusal: 'auth/insufficient-permission',
          field: null,
          wireStatus: null,
          serverParams: {},
          operationId: null,
        },
      });
      expect(JSON.stringify(result)).not.toContain(PRIVACY_SENTINELS.phone);
    });

    it('answers a transient failure as `unavailable`', async () => {
      const auth = fakeAuth();
      auth.deleteUser.mockRejectedValueOnce(authError(14));
      const result = await authEraserPorts(asAuth(auth)).deleteAuthUser(UID);
      expect(!result.ok && result.error.errorCode).toBe(
        PipelineErrorCode.Unavailable,
      );
    });
  });
});
