import { ImpersonationEndReason, ImpersonationScope } from '@core/components';
import {
  GovernanceError,
  GovernanceErrorCode,
  ImpersonationSessionId,
  PrimitiveErrorCode,
  RepositoryError,
  type Result,
  UserId,
} from '@core/primitives';
import { type EdgeError, toHttpsError } from '../edge';
import {
  decodeEndImpersonation,
  decodeStartImpersonation,
  encodeEndImpersonationAnswer,
  encodeStartImpersonationAnswer,
  endImpersonationRefusal,
  startImpersonationRefusal,
} from './governance.wire';
import type { WireRequest } from './wire-read';

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

  it('hands an absent reason — or one that is no text — on as empty, for the system to refuse', () => {
    for (const reason of [undefined, 42]) {
      expect(
        valueOf(decodeStartImpersonation(admin({ ...START, reason }))).reason,
      ).toBe('');
    }
  });

  it('answers `{ sessionId }`, a start’s refusal as itself (the pipeline picked its first fault), and throws a store failure', () => {
    expect(
      encodeStartImpersonationAnswer({
        sessionId: ImpersonationSessionId.of('imp-1'),
      }),
    ).toEqual({ sessionId: 'imp-1' });
    expect(
      startImpersonationRefusal(GovernanceError.impersonationSelf()),
    ).toEqual(GovernanceError.impersonationSelf());
    expect(
      startImpersonationRefusal(
        GovernanceError.impersonationForbidden(UserId.of('u-1')),
      ),
    ).toEqual(GovernanceError.impersonationForbidden(UserId.of('u-1')));
    const down = RepositoryError.writeFailed(
      'impersonationSessions/x',
      'aborted',
    );
    expect(() => startImpersonationRefusal(down)).toThrow(
      'REPOSITORY_WRITE_FAILED',
    );
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
    });
  });

  it('refuses a request that names no session', () => {
    for (const data of [{}, { sessionId: '' }, { sessionId: 7 }, null]) {
      expect(wire(decodeEndImpersonation(admin(data))).code).toBe(
        'invalid-argument',
      );
    }
  });

  it('answers the session and how it ended, and throws a store failure', () => {
    expect(
      encodeEndImpersonationAnswer({
        sessionId: ImpersonationSessionId.of('imp-1'),
        impersonationEndReason: ImpersonationEndReason.AdminEnded,
      }),
    ).toEqual({ sessionId: 'imp-1', impersonationEndReason: 'ADMIN_ENDED' });
    expect(() =>
      endImpersonationRefusal(
        RepositoryError.readFailed(
          'impersonationSessions/imp-1',
          'unavailable',
        ),
      ),
    ).toThrow('REPOSITORY_READ_FAILED');
  });
});
