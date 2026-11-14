import { ImpersonationScope } from '@core/components';
import {
  BarberId,
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
  decodeSetStaffPermissions,
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
      barberLinkChange: 'KEEP',
      linkedBarberId: null,
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

  it('decodes the barber link: absent is KEEP (an older client never unlinks), CLEAR, and SET with its record', () => {
    const linkOf = (data: object) => {
      const cmd = valueOf(decodeSetRoles(admin({ ...ROLES_CALL, ...data })));
      return {
        barberLinkChange: cmd.barberLinkChange,
        linkedBarberId: cmd.linkedBarberId,
      };
    };
    expect(linkOf({})).toEqual({
      barberLinkChange: 'KEEP',
      linkedBarberId: null,
    });
    // A record named beside KEEP or CLEAR is ignored; absent is never a clear.
    expect(linkOf({ linkedBarberId: 'ivan' })).toEqual({
      barberLinkChange: 'KEEP',
      linkedBarberId: null,
    });
    expect(
      linkOf({ barberLinkChange: 'KEEP', linkedBarberId: 'ivan' }),
    ).toEqual({ barberLinkChange: 'KEEP', linkedBarberId: null });
    expect(
      linkOf({ barberLinkChange: 'CLEAR', linkedBarberId: 'ivan' }),
    ).toEqual({ barberLinkChange: 'CLEAR', linkedBarberId: null });
    expect(linkOf({ barberLinkChange: 'SET', linkedBarberId: 'ivan' })).toEqual(
      {
        barberLinkChange: 'SET',
        linkedBarberId: BarberId.of('ivan'),
      },
    );
  });

  it('refuses a SET naming no record as the id’s own refusal, and an unknown link change as GOVERNANCE_ROLES_INVALID', () => {
    for (const linkedBarberId of [undefined, null, '', 42]) {
      expect(
        wire(
          decodeSetRoles(
            admin({ ...ROLES_CALL, barberLinkChange: 'SET', linkedBarberId }),
          ),
        ),
      ).toEqual({
        code: 'invalid-argument',
        details: { errorCode: PrimitiveErrorCode.IdEmpty },
      });
    }
    expect(
      wire(
        decodeSetRoles(
          admin({
            ...ROLES_CALL,
            barberLinkChange: 'SET',
            linkedBarberId: 'a/b',
          }),
        ),
      ),
    ).toEqual({
      code: 'invalid-argument',
      details: { errorCode: PrimitiveErrorCode.IdHasSlash },
    });
    for (const barberLinkChange of [null, 'set', 'UNLINK', 1, ['SET']]) {
      expect(
        wire(decodeSetRoles(admin({ ...ROLES_CALL, barberLinkChange }))),
      ).toEqual({
        code: 'invalid-argument',
        details: { errorCode: GovernanceErrorCode.RolesInvalid },
      });
    }
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
      [GovernanceError.rolesBarberLinkRequired(target), 'invalid-argument'],
      [GovernanceError.rolesBarberUnknown(BarberId.of('niko')), 'not-found'],
      [GovernanceError.rolesLinkWithoutBarber(target), 'invalid-argument'],
      [
        GovernanceError.rolesBarberAlreadyLinked(BarberId.of('ivan')),
        'failed-precondition',
      ],
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

describe('decodeSetStaffPermissions (staff permissions P6)', () => {
  const OP = 'operation-0123456789ab';
  const CELL = {
    staffCapability: 'HOURS',
    role: 'receptionist',
    accessScope: 'NONE',
  };
  const SAVE = { changes: [CELL], operationId: OP };

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

  it('refuses nobody as GOVERNANCE_PERMISSIONS_UNAUTHENTICATED, before the payload is read', () => {
    for (const data of [null, SAVE, unreadable()]) {
      expect(wire(decodeSetStaffPermissions(signedIn(data, null)))).toEqual({
        code: 'unauthenticated',
        details: { errorCode: GovernanceErrorCode.PermissionsUnauthenticated },
      });
    }
  });

  it.each([
    ['a barber', ['barber']],
    ['the front desk', ['receptionist']],
    ['the content editor', ['content_manager']],
    ['the vendor’s sysadmin', ['sysadmin']],
    ['a client', ['client']],
    ['no claim', []],
    ['a list inside the claim', [['admin']]],
  ])(
    'refuses %s as GOVERNANCE_PERMISSIONS_FORBIDDEN before the payload is read — the uid stays on the server',
    (_who, roles) => {
      expect(
        wire(decodeSetStaffPermissions(signedIn(unreadable(), 'u-1', roles))),
      ).toEqual({
        code: 'permission-denied',
        details: { errorCode: GovernanceErrorCode.PermissionsForbidden },
      });
    },
  );

  it('decodes the changes as sent — the caller and their roles off the token, the act’s name required', () => {
    expect(valueOf(decodeSetStaffPermissions(admin(SAVE)))).toEqual({
      adminUserId: 'u-owner',
      adminRoles: ['barber', 'admin'],
      changes: [CELL],
      operationId: OP,
    });
    // An empty save is a save: the pipeline answers it changed nothing.
    expect(
      valueOf(
        decodeSetStaffPermissions(admin({ changes: [], operationId: OP })),
      ).changes,
    ).toEqual([]);
    // A level the owner does not edit, and "own" off the barber level, are
    // well-formed: whether a cell is on offer is the system's question.
    for (const cell of [
      { ...CELL, role: 'admin' },
      { ...CELL, accessScope: 'OWN' },
    ]) {
      expect(
        decodeSetStaffPermissions(admin({ changes: [cell], operationId: OP }))
          .ok,
      ).toBe(true);
    }
  });

  it.each([
    ['changes', { changes: undefined }],
    ['changes', { changes: 'HOURS' }],
    ['changes', { changes: { 0: CELL } }],
    // Longer than the grid has cells.
    ['changes', { changes: Array.from({ length: 19 }, () => CELL) }],
    ['staffCapability', { changes: [{ ...CELL, staffCapability: 'BOOKING' }] }],
    ['staffCapability', { changes: [{ ...CELL, staffCapability: undefined }] }],
    // A capability whose stage has not shipped is no capability (P13).
    [
      'staffCapability',
      { changes: [{ ...CELL, staffCapability: 'BOOKING_MANAGE' }] },
    ],
    ['staffCapability', { changes: ['HOURS'] }],
    ['role', { changes: [{ ...CELL, role: 'owner' }] }],
    ['role', { changes: [{ ...CELL, role: ['receptionist'] }] }],
    ['accessScope', { changes: [{ ...CELL, accessScope: 'EVERYONE' }] }],
    ['accessScope', { changes: [{ ...CELL, accessScope: null }] }],
    // The first cell at fault, in the request's order.
    [
      'role',
      {
        changes: [
          CELL,
          { ...CELL, role: 'nobody' },
          { ...CELL, accessScope: 7 },
        ],
      },
    ],
    ['operationId', { operationId: 'short' }],
    ['operationId', { operationId: undefined }],
  ])('names the unreadable %s', (field, broken) => {
    expect(
      wire(decodeSetStaffPermissions(admin({ ...SAVE, ...broken }))),
    ).toEqual({
      code: 'invalid-argument',
      details: { errorCode: GovernanceErrorCode.PermissionsInvalid, field },
    });
  });
});
