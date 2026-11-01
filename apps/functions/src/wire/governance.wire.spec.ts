import { ImpersonationScope } from '@core/components';
import {
  OperationId,
  PrimitiveErrorCode,
  type Result,
  UserId,
} from '@core/primitives';
import {
  GovernanceError,
  GovernanceErrorCode,
  RepositoryError,
} from '@core/errors';
import { type EdgeError, toHttpsError } from '../edge';
import {
  decodeEndImpersonation,
  decodeSetRoles,
  decodeStartImpersonation,
} from './governance.wire';
import { refusalOf, type WireRequest } from './wire-read';

/*
 * The impersonation callables' wire (Phase 4a 4A-3 (4)) — new with the
 * rules tightening that took the admin's direct write away: the caller is
 * read off the VERIFIED token BEFORE the payload (a stranger learns nothing
 * of their asking), the requests are `GovernanceCall` / `GovernanceCall.End`,
 * a refusal leaves as its struct projected — the caller's uid never.
 */

const EXPIRES = Date.UTC(2026, 9, 11, 8);

const signedIn = (
  data: unknown,
  uid: string | null,
  roles: readonly unknown[] = [],
): WireRequest => ({
  data,
  ...(uid === null ? {} : { auth: { uid, token: { roles } } }),
});
const admin = (data: unknown) => signedIn(data, 'u-owner', ['barber', 'admin']);

function valueOf<T>(result: Result<T, EdgeError>): T {
  if (!result.ok) {
    throw new Error(`expected a command: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function wire(result: Result<unknown, EdgeError>) {
  if (result.ok) throw new Error('expected a refusal');
  const thrown = toHttpsError(result.error);
  return { code: thrown.code, details: thrown.details };
}

/** A client-minted transport id (WS-4.1) — the key's shape, a plain id. */
const OPERATION_TEXT = 'operation-0123456789ab';
/** Absent, `null`, malformed and reserved (OR-44): none of them an id. */
const NOT_AN_OPERATION_ID: readonly unknown[] = [
  undefined,
  null,
  'short',
  'x'.repeat(65),
  'has spaces in it, sixteen+',
  1234567890123456,
  { id: OPERATION_TEXT },
  '_'.repeat(16),
];

const START = {
  targetUserId: 'u-client',
  impersonationScope: ImpersonationScope.Read,
  reason: 'support ticket 42',
  expiresAtUtcMs: EXPIRES,
};

describe.each([
  ['startImpersonation', decodeStartImpersonation],
  ['endImpersonation', decodeEndImpersonation],
] as const)('%s — the caller, before the payload', (_name, decode) => {
  it('refuses nobody as GOVERNANCE_IMPERSONATION_UNAUTHENTICATED, whatever the payload says', () => {
    for (const data of [null, START, { sessionId: 'imp-1' }]) {
      expect(wire(decode(signedIn(data, null)))).toEqual({
        code: 'unauthenticated',
        details: {
          errorCode: GovernanceErrorCode.ImpersonationUnauthenticated,
        },
      });
    }
  });

  it.each([
    ['a barber', ['barber']],
    ['the front desk', ['receptionist']],
    ['a client', ['client']],
    ['no claim', []],
    ['a list inside the claim', [['admin']]],
  ])(
    'refuses %s as GOVERNANCE_IMPERSONATION_FORBIDDEN — the uid stays on the server',
    (_who, roles) => {
      expect(wire(decode(signedIn(START, 'u-1', roles)))).toEqual({
        code: 'permission-denied',
        details: { errorCode: GovernanceErrorCode.ImpersonationForbidden },
      });
    },
  );
});

describe('decodeStartImpersonation', () => {
  it('decodes the call component and the verified admin — the owner and the vendor alike', () => {
    expect(valueOf(decodeStartImpersonation(admin(START)))).toEqual({
      adminUserId: 'u-owner',
      adminRoles: ['barber', 'admin'],
      targetUserId: 'u-client',
      impersonationScope: ImpersonationScope.Read,
      reason: 'support ticket 42',
      expiresAtUtcMs: EXPIRES,
      operationId: null,
    });
    expect(
      valueOf(
        decodeStartImpersonation(signedIn(START, 'u-vendor', ['sysadmin'])),
      ),
    ).toMatchObject({ adminUserId: 'u-vendor', adminRoles: ['sysadmin'] });
  });

  it('refuses a payload that is no call, field by field', () => {
    for (const targetUserId of ['', 42, undefined]) {
      expect(
        wire(decodeStartImpersonation(admin({ ...START, targetUserId }))),
      ).toEqual({
        code: 'invalid-argument',
        details: { errorCode: PrimitiveErrorCode.IdEmpty },
      });
    }
    expect(
      wire(
        decodeStartImpersonation(
          admin({ ...START, impersonationScope: 'read' }),
        ),
      ).details,
    ).toMatchObject({
      errorCode: GovernanceErrorCode.ImpersonationScopeInvalid,
    });
    for (const expiresAtUtcMs of [undefined, 'soon', Number.NaN]) {
      expect(
        wire(decodeStartImpersonation(admin({ ...START, expiresAtUtcMs })))
          .details,
      ).toEqual({ errorCode: GovernanceErrorCode.ImpersonationInvalidExpiry });
    }
  });

  it('reads the transport operation id OPTIONALLY — a well-formed one as the OperationId, anything else none, never refused (RU-21)', () => {
    expect(
      valueOf(
        decodeStartImpersonation(
          admin({ ...START, operationId: OPERATION_TEXT }),
        ),
      ).operationId,
    ).toBe(OperationId.of(OPERATION_TEXT));
    for (const operationId of NOT_AN_OPERATION_ID) {
      expect(
        valueOf(decodeStartImpersonation(admin({ ...START, operationId })))
          .operationId,
      ).toBeNull();
    }
  });

  it('hands an absent reason — or one that is no text — on as empty, for the system to refuse', () => {
    for (const reason of [undefined, 42]) {
      expect(
        valueOf(decodeStartImpersonation(admin({ ...START, reason }))).reason,
      ).toBe('');
    }
  });

  it('leaves a start’s refusal as itself (`refusalOf` — the pipeline picked its first fault), and throws a store failure', () => {
    expect(refusalOf(GovernanceError.impersonationSelf())).toEqual(
      GovernanceError.impersonationSelf(),
    );
    expect(
      refusalOf(GovernanceError.impersonationForbidden(UserId.of('u-1'))),
    ).toEqual(GovernanceError.impersonationForbidden(UserId.of('u-1')));
    const down = RepositoryError.writeFailed(
      'impersonationSessions/x',
      'aborted',
    );
    expect(() => refusalOf(down)).toThrow('REPOSITORY_WRITE_FAILED');
  });
});

describe('decodeEndImpersonation', () => {
  it('decodes the session and the verified admin', () => {
    expect(
      valueOf(decodeEndImpersonation(admin({ sessionId: 'imp-1' }))),
    ).toEqual({
      sessionId: 'imp-1',
      adminUserId: 'u-owner',
      adminRoles: ['barber', 'admin'],
      operationId: null,
    });
  });

  it('reads the transport operation id OPTIONALLY — a well-formed one as the OperationId, anything else none, never refused (RU-21)', () => {
    expect(
      valueOf(
        decodeEndImpersonation(
          admin({ sessionId: 'imp-1', operationId: OPERATION_TEXT }),
        ),
      ).operationId,
    ).toBe(OperationId.of(OPERATION_TEXT));
    for (const operationId of NOT_AN_OPERATION_ID) {
      expect(
        valueOf(
          decodeEndImpersonation(admin({ sessionId: 'imp-1', operationId })),
        ).operationId,
      ).toBeNull();
    }
  });

  it('refuses a request that names no session', () => {
    for (const data of [{}, { sessionId: '' }, { sessionId: 7 }, null]) {
      expect(wire(decodeEndImpersonation(admin(data))).code).toBe(
        'invalid-argument',
      );
    }
  });

  it('throws an end’s store failure (`refusalOf`)', () => {
    expect(() =>
      refusalOf(
        RepositoryError.readFailed(
          'impersonationSessions/imp-1',
          'unavailable',
        ),
      ),
    ).toThrow('REPOSITORY_READ_FAILED');
  });
});

describe('decodeSetRoles (security hardening S-WS-E)', () => {
  const ROLES_CALL = { targetUserId: 'u-client', roles: ['barber', 'client'] };

  /** A payload whose every read throws — proof the gate refuses before reading it. */
  const unreadable = (): unknown =>
    new Proxy(
      {},
      {
        get: () => {
          throw new Error('the payload was read');
        },
        has: () => {
          throw new Error('the payload was read');
        },
      },
    );

  it('refuses nobody as GOVERNANCE_ROLES_UNAUTHENTICATED, before the payload is read', () => {
    for (const data of [null, ROLES_CALL, unreadable()]) {
      expect(wire(decodeSetRoles(signedIn(data, null)))).toEqual({
        code: 'unauthenticated',
        details: { errorCode: GovernanceErrorCode.RolesUnauthenticated },
      });
    }
  });

  it.each([
    ['a barber', ['barber']],
    ['the front desk', ['receptionist']],
    ['the vendor’s sysadmin (S-RU-14)', ['sysadmin']],
    ['a client', ['client']],
    ['no claim', []],
    ['a list inside the claim', [['admin']]],
  ])(
    'refuses %s as GOVERNANCE_ROLES_FORBIDDEN before the payload is read — the uid stays on the server',
    (_who, roles) => {
      expect(
        wire(decodeSetRoles(signedIn(unreadable(), 'u-1', roles))),
      ).toEqual({
        code: 'permission-denied',
        details: { errorCode: GovernanceErrorCode.RolesForbidden },
      });
    },
  );

  it('decodes the call component and the verified admin — the roles as sent, for the system to order', () => {
    expect(valueOf(decodeSetRoles(admin(ROLES_CALL)))).toEqual({
      adminUserId: 'u-owner',
      adminRoles: ['barber', 'admin'],
      targetUserId: 'u-client',
      roles: ['barber', 'client'],
      operationId: null,
    });
    // An empty set and the sysadmin are the SYSTEM's refusals: they pass the wire.
    expect(
      valueOf(decodeSetRoles(admin({ ...ROLES_CALL, roles: [] }))).roles,
    ).toEqual([]);
    expect(
      valueOf(decodeSetRoles(admin({ ...ROLES_CALL, roles: ['sysadmin'] })))
        .roles,
    ).toEqual(['sysadmin']);
  });

  it('refuses a target that is no uid as the id’s own refusal', () => {
    for (const targetUserId of ['', 42, undefined]) {
      expect(
        wire(decodeSetRoles(admin({ ...ROLES_CALL, targetUserId }))),
      ).toEqual({
        code: 'invalid-argument',
        details: { errorCode: PrimitiveErrorCode.IdEmpty },
      });
    }
  });

  it('refuses a set that is no array, or names anything but a role, as GOVERNANCE_ROLES_INVALID', () => {
    for (const roles of [
      undefined,
      null,
      'admin',
      { 0: 'admin' },
      ['admin', 'owner'],
      ['ADMIN'],
      [['admin']],
      [null],
    ]) {
      expect(wire(decodeSetRoles(admin({ ...ROLES_CALL, roles })))).toEqual({
        code: 'invalid-argument',
        details: { errorCode: GovernanceErrorCode.RolesInvalid },
      });
    }
  });

  it('reads the transport operation id OPTIONALLY — a well-formed one as the OperationId, anything else none, never refused (RU-21)', () => {
    expect(
      valueOf(
        decodeSetRoles(admin({ ...ROLES_CALL, operationId: OPERATION_TEXT })),
      ).operationId,
    ).toBe(OperationId.of(OPERATION_TEXT));
    for (const operationId of NOT_AN_OPERATION_ID) {
      expect(
        valueOf(decodeSetRoles(admin({ ...ROLES_CALL, operationId })))
          .operationId,
      ).toBeNull();
    }
  });

  it('leaves its refusals as themselves — the uids stay on the server — and throws a store failure (`refusalOf`)', () => {
    const target = UserId.of('u-client');
    for (const [refusal, code] of [
      [GovernanceError.rolesSelf(UserId.of('u-owner')), 'failed-precondition'],
      [GovernanceError.rolesTargetNotFound(target), 'not-found'],
      [GovernanceError.rolesTargetErased(target), 'failed-precondition'],
      [GovernanceError.rolesTargetNotRegistered(target), 'failed-precondition'],
      [GovernanceError.rolesTargetSysadmin(target), 'failed-precondition'],
      [GovernanceError.rolesSessionsNotRevoked(target), 'unavailable'],
    ] as const) {
      expect(refusalOf(refusal)).toEqual(refusal);
      expect(toHttpsError(refusalOf(refusal))).toMatchObject({
        code,
        details: { errorCode: refusal.errorCode },
      });
    }
    expect(() =>
      refusalOf(RepositoryError.writeFailed('users/u-client', 'aborted')),
    ).toThrow('REPOSITORY_WRITE_FAILED');
  });
});
