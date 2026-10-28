import { describe, expect, it } from 'vitest';
import { PipelineErrorCode } from '@core/errors';
import { ClientOperationId, CustomerId } from '@core/primitives';
import { deepFreeze, unwrapOk } from '@core/testing';
import { ClientPrivacyCall } from './client-privacy-call.data';

/*
 * The privacy wire (audit-hardening Phase 3, WS-C / WS-D): the export's
 * answer through its primitives' smart constructors and the format version,
 * the erasure's two answers through the erasure tag and the census counts;
 * anything else `PIPELINE_UNKNOWN`. The round trip with the server's encoder
 * lives in `privacy.wire.spec.ts`.
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

/** A census as the server encodes it — every count distinct, so a swapped field shows. */
const CENSUS = {
  erasureRecordCount: 1,
  erasureAccountCount: 1,
  erasureContactCount: 3,
  erasureLabelCount: 2,
  erasureNoteCount: 4,
  erasurePhotoCount: 5,
  erasureDocumentCount: 6,
  erasurePseudonymCount: 7,
  erasureVisitCount: 9,
  erasureContactKeptCount: 8,
  erasureJournalCount: 12,
} as const;

/** A usable preview answer — a NONE record with one sibling walk-in record. */
const PREVIEW = deepFreeze({
  erasureStatus: 'NONE',
  erasureSiblingCustomerIds: ['cus_aaaaaaaaaaaaaaaaaaaa'],
  ...CENSUS,
});

/** A usable erasure answer — a call that left work. */
const ERASURE = deepFreeze({
  erasureStatus: 'ERASING',
  erasureDone: false,
  ...CENSUS,
});

/** One census field set to each malformed value — every one refused. */
const BAD_COUNTS: readonly unknown[] = [-1, 2.5, '3', null, undefined];

describe('ClientPrivacyCall.decodeErasurePreview', () => {
  it('decodes a usable answer — the tag, the eleven counts and the sibling ids', () => {
    expect(ClientPrivacyCall.decodeErasurePreview(PREVIEW)).toEqual({
      ok: true,
      value: PREVIEW,
    });
    expect(
      unwrapOk(
        ClientPrivacyCall.decodeErasurePreview({
          ...PREVIEW,
          erasureStatus: 'ERASING',
          erasureSiblingCustomerIds: [],
        }),
      ).erasureSiblingCustomerIds,
    ).toEqual([]);
  });

  it('reads only the answer’s own fields — an extra one is dropped', () => {
    expect(
      unwrapOk(
        ClientPrivacyCall.decodeErasurePreview({
          ...PREVIEW,
          displayName: 'Sentinel Firstname',
        }),
      ),
    ).toEqual(PREVIEW);
  });

  it('refuses an answer missing any field', () => {
    for (const field of Object.keys(PREVIEW)) {
      const partial = Object.fromEntries(
        Object.entries(PREVIEW).filter(([name]) => name !== field),
      );
      expect(
        unusable(ClientPrivacyCall.decodeErasurePreview(partial)),
        field,
      ).toBe(true);
    }
  });

  it('refuses a foreign tag, a malformed count and a malformed sibling list', () => {
    for (const bad of [
      { erasureStatus: 'GONE' },
      { erasureStatus: 'none' },
      { erasureStatus: 7 },
      ...Object.keys(CENSUS).flatMap((field) =>
        BAD_COUNTS.map((value) => ({ [field]: value })),
      ),
      { erasureSiblingCustomerIds: 'cus_aaaaaaaaaaaaaaaaaaaa' },
      { erasureSiblingCustomerIds: [''] },
      { erasureSiblingCustomerIds: ['a/b'] },
      { erasureSiblingCustomerIds: [42] },
      { erasureSiblingCustomerIds: null },
    ]) {
      expect(
        unusable(
          ClientPrivacyCall.decodeErasurePreview({ ...PREVIEW, ...bad }),
        ),
        JSON.stringify(bad),
      ).toBe(true);
    }
  });

  it('refuses an answer that is no object', () => {
    for (const raw of [undefined, null, 'x', 1, [PREVIEW]]) {
      expect(unusable(ClientPrivacyCall.decodeErasurePreview(raw))).toBe(true);
    }
  });
});

describe('ClientPrivacyCall.decodeErasure', () => {
  it('decodes a usable answer — the tag, done or not, and the residue census', () => {
    expect(ClientPrivacyCall.decodeErasure(ERASURE)).toEqual({
      ok: true,
      value: ERASURE,
    });
    const done = {
      ...ERASURE,
      erasureStatus: 'ERASED',
      erasureDone: true,
      erasureRecordCount: 0,
      erasureAccountCount: 0,
    };
    expect(unwrapOk(ClientPrivacyCall.decodeErasure(done))).toEqual(done);
  });

  it('reads only the answer’s own fields — an extra one is dropped', () => {
    expect(
      unwrapOk(
        ClientPrivacyCall.decodeErasure({
          ...ERASURE,
          erasureSiblingCustomerIds: ['cus_aaaaaaaaaaaaaaaaaaaa'],
        }),
      ),
    ).toEqual(ERASURE);
  });

  it('refuses an answer missing any field', () => {
    for (const field of Object.keys(ERASURE)) {
      const partial = Object.fromEntries(
        Object.entries(ERASURE).filter(([name]) => name !== field),
      );
      expect(unusable(ClientPrivacyCall.decodeErasure(partial)), field).toBe(
        true,
      );
    }
  });

  it('refuses a foreign tag, a non-boolean done and a malformed count', () => {
    for (const bad of [
      { erasureStatus: 'ERASE' },
      { erasureStatus: null },
      { erasureDone: 'true' },
      { erasureDone: 1 },
      { erasureDone: null },
      ...Object.keys(CENSUS).flatMap((field) =>
        BAD_COUNTS.map((value) => ({ [field]: value })),
      ),
    ]) {
      expect(
        unusable(ClientPrivacyCall.decodeErasure({ ...ERASURE, ...bad })),
        JSON.stringify(bad),
      ).toBe(true);
    }
  });

  it('refuses an answer that is no object; is pure', () => {
    for (const raw of [undefined, null, 'x', 1, [ERASURE]]) {
      expect(unusable(ClientPrivacyCall.decodeErasure(raw))).toBe(true);
    }
    expect(ClientPrivacyCall.decodeErasure(ERASURE)).toEqual(
      ClientPrivacyCall.decodeErasure(ERASURE),
    );
    expect(ClientPrivacyCall.decodeErasurePreview(PREVIEW)).toEqual(
      ClientPrivacyCall.decodeErasurePreview(PREVIEW),
    );
  });
});
