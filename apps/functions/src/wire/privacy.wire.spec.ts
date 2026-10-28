import { CustomerId, OperationId, type Result } from '@core/primitives';
import {
  PipelineError,
  PipelineErrorCode,
  PrivacyError,
  PrivacyErrorCode,
  RepositoryError,
} from '@core/errors';
import {
  type ClientPrivacyCall,
  ErasureCensus,
  ErasureStatus,
} from '@core/components';
import { FIXTURE_NOW_UTC_MS } from '@core/testing';
import { type EdgeError, toHttpsError } from '../edge';
import {
  decodeEraseClient,
  decodeExportClientData,
  decodePreviewClientErasure,
  encodeEraseClientAnswer,
  encodeErasurePreviewAnswer,
  encodeExportClientDataAnswer,
  ERASE_CLIENT_TIMEOUT_SECONDS,
  eraseClientRefusal,
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
 * struct, a store failure is thrown. The erasure's two decoders (WS-D)
 * read the SAME call by the same one reading — gate, fields, command — and
 * its answers leave with exactly their fields.
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

describe('the erasure’s decoders — the privacy call, read by the export’s one reading', () => {
  const decoders = [
    ['decodePreviewClientErasure', decodePreviewClientErasure],
    ['decodeEraseClient', decodeEraseClient],
  ] as const;

  it.each(decoders)(
    '%s answers exactly what the export’s decoder answers — the command, and every refusal before the payload is read',
    (_name, decode) => {
      for (const request of [
        admin(CALL),
        signedIn(CALL, 'u-owner', ['barber', 'admin']),
        admin({ ...CALL, customerId: '' }),
        admin({ ...CALL, operationId: 'short' }),
        admin({ customerId: 'cus-privacy-1' }),
        admin(null),
      ]) {
        expect(decode(request)).toEqual(decodeExportClientData(request));
      }
      expect(valueOf(decode(admin(CALL)))).toEqual({
        callerUserId: 'u-owner',
        callerRoles: ['admin'],
        customerId: CustomerId.of('cus-privacy-1'),
        operationId: OperationId.of(OPERATION_TEXT),
      });
    },
  );

  it.each(decoders)(
    '%s refuses nobody and every non-admin — the sysadmin included — without reading the payload',
    (_name, decode) => {
      expect(wire(decode(unreadable(null)))).toEqual({
        code: 'unauthenticated',
        details: { errorCode: PrivacyErrorCode.Unauthenticated },
      });
      for (const roles of [['sysadmin'], ['barber'], ['client'], []]) {
        expect(wire(decode(unreadable('u-1', roles)))).toEqual({
          code: 'permission-denied',
          details: { errorCode: PrivacyErrorCode.Forbidden },
        });
      }
    },
  );

  it.each(decoders)(
    '%s requires the act’s own id — a retry of the same act resends it',
    (_name, decode) => {
      expect(wire(decode(admin({ customerId: 'cus-privacy-1' })))).toEqual({
        code: 'invalid-argument',
        details: {
          errorCode: PrivacyErrorCode.InvalidInput,
          field: 'operationId',
        },
      });
    },
  );
});

describe('the erasure’s answers', () => {
  const census: ErasureCensus = {
    ...ErasureCensus.EMPTY,
    erasureNoteCount: 2,
    erasurePhotoCount: 3,
    erasureVisitCount: 4,
    erasureJournalCount: 5,
  };

  it('answers the preview’s tag, the sibling ids and the eleven counts — and nothing else', () => {
    const answer: ClientPrivacyCall.ErasurePreview = {
      erasureStatus: ErasureStatus.None,
      erasureSiblingCustomerIds: [CustomerId.of('cus-walkin-sibling')],
      ...census,
    };
    const encoded = encodeErasurePreviewAnswer({
      ...answer,
      internal: 'never on the wire',
    } as ClientPrivacyCall.ErasurePreview);
    expect(encoded).toEqual(answer);
    expect(Object.keys(encoded)).toHaveLength(13);
  });

  it('answers one erasure call’s tag, whether it is done and the residue — and nothing else', () => {
    const answer: ClientPrivacyCall.Erasure = {
      erasureStatus: ErasureStatus.Erasing,
      erasureDone: false,
      ...census,
    };
    const encoded = encodeEraseClientAnswer({
      ...answer,
      customerId: 'cus-never-on-the-wire',
    } as ClientPrivacyCall.Erasure);
    expect(encoded).toEqual(answer);
    expect(Object.keys(encoded)).toHaveLength(13);
  });

  it('budgets the erasure by the timeout it deploys with — the runBackfill idiom', () => {
    expect(ERASE_CLIENT_TIMEOUT_SECONDS).toBe(540);
  });
});

describe('eraseClientRefusal', () => {
  it('answers each erasure refusal as itself — a state that forbids the act is `failed-precondition`, its code alone', () => {
    const cases: readonly (readonly [PrivacyError, string])[] = [
      [PrivacyError.unavailable(), 'failed-precondition'],
      [PrivacyError.forbidden(), 'permission-denied'],
      [PrivacyError.clientNotFound(), 'not-found'],
      [PrivacyError.erasureStaffAccount(), 'failed-precondition'],
      [PrivacyError.accountLinkMismatch(), 'failed-precondition'],
      [PrivacyError.erasureTooLarge(5_001), 'failed-precondition'],
    ];
    for (const [error, code] of cases) {
      const refused = eraseClientRefusal(error);
      expect(refused).toEqual(error);
      expect(toHttpsError(refused)).toMatchObject({
        code,
        details: { errorCode: error.errorCode },
      });
    }
    // The listed count stays on the server.
    expect(
      toHttpsError(eraseClientRefusal(PrivacyError.erasureTooLarge(5_001)))
        .details,
    ).toEqual({ errorCode: PrivacyErrorCode.ErasureTooLarge });
  });

  it('answers the Auth eraser’s failure as itself — its SDK code stays on the server', () => {
    const transient = PipelineError.of(
      PipelineErrorCode.Unavailable,
      null,
      'auth/internal-error',
      null,
    );
    expect(toHttpsError(eraseClientRefusal(transient))).toMatchObject({
      code: 'unavailable',
      details: { errorCode: PipelineErrorCode.Unavailable },
    });
    const permanent = PipelineError.of(
      PipelineErrorCode.Unknown,
      null,
      'auth/insufficient-permission',
      null,
    );
    const thrown = toHttpsError(eraseClientRefusal(permanent));
    expect(thrown.code).toBe('internal');
    expect(JSON.stringify(thrown.details)).not.toContain('auth/');
  });

  it('throws a store failure for the edge to answer as internal — never a refusal', () => {
    expect(() =>
      eraseClientRefusal(
        RepositoryError.writeFailed('customers/cus-1', 'aborted'),
      ),
    ).toThrow('REPOSITORY_WRITE_FAILED');
  });
});
