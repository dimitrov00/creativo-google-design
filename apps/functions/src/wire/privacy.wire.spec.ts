import { CustomerId, OperationId, type Result } from '@core/primitives';
import { PrivacyError, PrivacyErrorCode, RepositoryError } from '@core/errors';
import type { ClientPrivacyCall } from '@core/components';
import { FIXTURE_NOW_UTC_MS } from '@core/testing';
import { type EdgeError, toHttpsError } from '../edge';
import {
  decodeExportClientData,
  encodeExportClientDataAnswer,
  exportClientDataRefusal,
} from './privacy.wire';
import type { WireRequest } from './wire-read';

/*
 * The privacy callables' wire (audit-hardening Phase 3, WS-C): the caller
 * is read off the VERIFIED token BEFORE the payload — no session, then a
 * token that is not the shop's admin (the sysadmin included) — so a
 * stranger learns nothing of the person asked for; both payload fields are
 * required, a missing or malformed one refused by its NAME; the answer is
 * the pipeline's, `exportJson` byte for byte; a refusal leaves as its
 * struct, a store failure is thrown.
 */

const OPERATION_TEXT = 'operation-0123456789ab';
const CALL = { customerId: 'cus-privacy-1', operationId: OPERATION_TEXT };

const signedIn = (
  data: unknown,
  uid: string | null,
  roles: readonly unknown[] = [],
): WireRequest => ({
  data,
  ...(uid === null ? {} : { auth: { uid, token: { roles } } }),
});
const admin = (data: unknown) => signedIn(data, 'u-owner', ['admin']);

/**
 * A request whose payload cannot be read — reading it throws, so a refusal
 * answered from it proves the gate never touched the payload.
 */
const unreadable = (
  uid: string | null,
  roles: readonly unknown[] = [],
): WireRequest =>
  Object.defineProperty(
    uid === null ? {} : { auth: { uid, token: { roles } } },
    'data',
    {
      get: () => {
        throw new Error('the payload was read before the gate');
      },
    },
  );

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

describe('decodeExportClientData — the caller, before the payload', () => {
  it('refuses nobody as PRIVACY_UNAUTHENTICATED without reading the payload', () => {
    expect(wire(decodeExportClientData(unreadable(null)))).toEqual({
      code: 'unauthenticated',
      details: { errorCode: PrivacyErrorCode.Unauthenticated },
    });
    // An empty uid is nobody too.
    expect(wire(decodeExportClientData(unreadable('', ['admin'])))).toEqual({
      code: 'unauthenticated',
      details: { errorCode: PrivacyErrorCode.Unauthenticated },
    });
  });

  it.each([
    ['the sysadmin', ['sysadmin']],
    ['a barber', ['barber']],
    ['the front desk', ['receptionist']],
    ['the content manager', ['content_manager']],
    ['a client', ['client']],
    ['no claim', []],
    ['a list inside the claim', [['admin']]],
  ])(
    'refuses %s as PRIVACY_FORBIDDEN without reading the payload — the uid stays on the server',
    (_who, roles) => {
      expect(wire(decodeExportClientData(unreadable('u-1', roles)))).toEqual({
        code: 'permission-denied',
        details: { errorCode: PrivacyErrorCode.Forbidden },
      });
    },
  );
});

describe('decodeExportClientData — the call', () => {
  it('decodes the record, the act’s own id and the verified admin — beside other roles too', () => {
    expect(valueOf(decodeExportClientData(admin(CALL)))).toEqual({
      callerUserId: 'u-owner',
      callerRoles: ['admin'],
      customerId: CustomerId.of('cus-privacy-1'),
      operationId: OperationId.of(OPERATION_TEXT),
    });
    expect(
      valueOf(
        decodeExportClientData(signedIn(CALL, 'u-owner', ['barber', 'admin'])),
      ),
    ).toMatchObject({ callerRoles: ['barber', 'admin'] });
  });

  it.each([undefined, null, '', 42, { id: 'cus-1' }, ['cus-1']])(
    'refuses a customerId of %j as PRIVACY_INVALID_INPUT naming the field',
    (customerId) => {
      expect(
        wire(decodeExportClientData(admin({ ...CALL, customerId }))),
      ).toEqual({
        code: 'invalid-argument',
        details: {
          errorCode: PrivacyErrorCode.InvalidInput,
          field: 'customerId',
        },
      });
    },
  );

  it.each([
    undefined,
    null,
    'short',
    'x'.repeat(65),
    'has spaces in it, sixteen+',
    1234567890123456,
    { id: OPERATION_TEXT },
    '_'.repeat(16),
  ])(
    'refuses an operationId of %j as PRIVACY_INVALID_INPUT naming the field — the id is REQUIRED',
    (operationId) => {
      expect(
        wire(decodeExportClientData(admin({ ...CALL, operationId }))),
      ).toEqual({
        code: 'invalid-argument',
        details: {
          errorCode: PrivacyErrorCode.InvalidInput,
          field: 'operationId',
        },
      });
    },
  );

  it('refuses a payload that is no object — the record first', () => {
    for (const data of [undefined, null, 'cus-1', 7, []]) {
      expect(wire(decodeExportClientData(admin(data)))).toEqual({
        code: 'invalid-argument',
        details: {
          errorCode: PrivacyErrorCode.InvalidInput,
          field: 'customerId',
        },
      });
    }
  });

  it('never carries a sent value onto the wire — only the field’s name', () => {
    const refused = wire(
      decodeExportClientData(
        admin({ customerId: 'cus-1', operationId: 'sentinel@example.invalid' }),
      ),
    );
    expect(JSON.stringify(refused)).not.toContain('sentinel');
  });
});

describe('encodeExportClientDataAnswer', () => {
  it('answers the six fields of the export, the JSON byte for byte — and nothing else', () => {
    const answer: ClientPrivacyCall.Exported = {
      clientExportVersion: 1,
      exportedCustomerId: CustomerId.of('cus-privacy-1'),
      exportedAtUtcMs: FIXTURE_NOW_UTC_MS,
      exportDocumentCount: 3,
      exportByteCount: 26,
      exportJson: '{"a":"Сентинел","b":[1,2]}',
    };
    const extra = { ...answer, internal: 'never on the wire' };
    expect(encodeExportClientDataAnswer(extra)).toEqual(answer);
    expect(encodeExportClientDataAnswer(answer).exportJson).toBe(
      answer.exportJson,
    );
  });
});

describe('exportClientDataRefusal', () => {
  it('answers each pipeline refusal as itself, its status by the wire table', () => {
    const cases: readonly (readonly [PrivacyError, string])[] = [
      [PrivacyError.unavailable(), 'failed-precondition'],
      [PrivacyError.forbidden(), 'permission-denied'],
      [PrivacyError.clientNotFound(), 'not-found'],
      [PrivacyError.exportTooLarge(20_001, 0), 'failed-precondition'],
    ];
    for (const [error, code] of cases) {
      const refused = exportClientDataRefusal(error);
      expect(refused).toEqual(error);
      expect(toHttpsError(refused)).toMatchObject({
        code,
        details: { errorCode: error.errorCode },
      });
    }
  });

  it('throws a store failure for the edge to answer as internal — never a refusal', () => {
    expect(() =>
      exportClientDataRefusal(
        RepositoryError.readFailed('customers/cus-1', 'unavailable'),
      ),
    ).toThrow('REPOSITORY_READ_FAILED');
  });
});
