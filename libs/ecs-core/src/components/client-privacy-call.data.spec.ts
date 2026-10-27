import { describe, expect, it } from 'vitest';
import { PipelineErrorCode } from '@core/errors';
import { ClientOperationId, CustomerId } from '@core/primitives';
import { deepFreeze, unwrapOk } from '@core/testing';
import { ClientPrivacyCall } from './client-privacy-call.data';

/*
 * The privacy wire (audit-hardening Phase 3, WS-C): the export's answer
 * through its primitives' smart constructors and the format version; anything
 * else `PIPELINE_UNKNOWN`. The round trip with the server's encoder lives in
 * `privacy.wire.spec.ts`.
 */
const unusable = (result: { readonly ok: boolean; readonly error?: unknown }) =>
  !result.ok &&
  (result.error as { errorCode: string }).errorCode ===
    PipelineErrorCode.Unknown;

/** A usable answer as the server encodes it — the JSON text kept verbatim. */
const ANSWER = deepFreeze({
  clientExportVersion: 1,
  exportedCustomerId: 'cus_0123456789abcdef0123',
  exportedAtUtcMs: 1_793_000_000_000,
  exportDocumentCount: 3,
  exportByteCount: 41,
  exportJson: '{"clientExportVersion":1,"customers":[{"id":"cus_1"}]}',
});

describe('ClientPrivacyCall — the export call', () => {
  it('carries the record and the act’s own id — both required, both brands', () => {
    const call: ClientPrivacyCall = {
      customerId: CustomerId.of('cus_0123456789abcdef0123'),
      operationId: unwrapOk(ClientOperationId.parse('op_privacy_000001')),
    };
    expect(Object.keys(call).sort()).toEqual(['customerId', 'operationId']);
  });

  it('the bundle’s format version is 1', () => {
    expect(ClientPrivacyCall.EXPORT_VERSION).toBe(1);
  });
});

describe('ClientPrivacyCall.decodeExported', () => {
  it('decodes a usable answer, the JSON text byte for byte', () => {
    expect(ClientPrivacyCall.decodeExported(ANSWER)).toEqual({
      ok: true,
      value: ANSWER,
    });
    const decoded = unwrapOk(ClientPrivacyCall.decodeExported(ANSWER));
    expect(decoded.exportJson).toBe(ANSWER.exportJson);
    expect(decoded.clientExportVersion).toBe(ClientPrivacyCall.EXPORT_VERSION);
  });

  it('reads only the answer’s own fields — an extra one is dropped', () => {
    expect(
      unwrapOk(ClientPrivacyCall.decodeExported({ ...ANSWER, extra: 'x' })),
    ).toEqual(ANSWER);
  });

  it('refuses an answer missing any field', () => {
    for (const field of Object.keys(ANSWER)) {
      const partial = Object.fromEntries(
        Object.entries(ANSWER).filter(([name]) => name !== field),
      );
      expect(unusable(ClientPrivacyCall.decodeExported(partial)), field).toBe(
        true,
      );
    }
  });

  it('refuses another format version — never hands on a bundle it cannot read', () => {
    for (const clientExportVersion of [0, 2, 1.5, '1', null]) {
      expect(
        unusable(
          ClientPrivacyCall.decodeExported({ ...ANSWER, clientExportVersion }),
        ),
        String(clientExportVersion),
      ).toBe(true);
    }
  });

  it('refuses a malformed field', () => {
    for (const bad of [
      { exportedCustomerId: '' },
      { exportedCustomerId: 'a/b' },
      { exportedCustomerId: 42 },
      { exportedAtUtcMs: 1.5 },
      { exportedAtUtcMs: '1793000000000' },
      { exportDocumentCount: -1 },
      { exportDocumentCount: 2.5 },
      { exportByteCount: -1 },
      { exportByteCount: '41' },
      { exportJson: 7 },
      { exportJson: null },
    ]) {
      expect(
        unusable(ClientPrivacyCall.decodeExported({ ...ANSWER, ...bad })),
        JSON.stringify(bad),
      ).toBe(true);
    }
  });

  it('refuses an answer that is no object', () => {
    for (const raw of [undefined, null, 'x', 1, [ANSWER]]) {
      expect(unusable(ClientPrivacyCall.decodeExported(raw))).toBe(true);
    }
  });

  it('is pure: the answer is untouched and decodes the same twice', () => {
    const first = ClientPrivacyCall.decodeExported(ANSWER);
    expect(ClientPrivacyCall.decodeExported(ANSWER)).toEqual(first);
  });
});
