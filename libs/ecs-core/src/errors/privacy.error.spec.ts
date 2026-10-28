import { describe, expect, it } from 'vitest';
import { PrivacyError, PrivacyErrorCode } from './privacy.error';

/* The data-subject requests' refusals (audit-hardening Phase 3, WS-C / WS-D):
 * flat structs, the `PRIVACY_` domain, context fields that are a field NAME
 * or a count — never a value of the person (R36 / T5). */

describe('PrivacyError', () => {
  it('builds each struct with its errorCode and its scalar params', () => {
    expect(PrivacyError.unauthenticated()).toEqual({
      errorCode: 'PRIVACY_UNAUTHENTICATED',
    });
    expect(PrivacyError.forbidden()).toEqual({
      errorCode: 'PRIVACY_FORBIDDEN',
    });
    expect(PrivacyError.unavailable()).toEqual({
      errorCode: 'PRIVACY_UNAVAILABLE',
    });
    expect(PrivacyError.clientNotFound()).toEqual({
      errorCode: 'PRIVACY_CLIENT_NOT_FOUND',
    });
    expect(PrivacyError.exportTooLarge(20_001, 0)).toEqual({
      errorCode: 'PRIVACY_EXPORT_TOO_LARGE',
      exportDocumentCount: 20_001,
      exportByteCount: 0,
    });
  });

  it('builds the erasure’s refusals — a code, and the listed count past the cap (Phase 3 WS-D)', () => {
    expect(PrivacyError.erasureStaffAccount()).toEqual({
      errorCode: 'PRIVACY_ERASURE_STAFF_ACCOUNT',
    });
    expect(PrivacyError.erasureTooLarge(5_001)).toEqual({
      errorCode: 'PRIVACY_ERASURE_TOO_LARGE',
      erasureListedCount: 5_001,
    });
  });

  it('the link mismatch is ONE code for every privacy callable and names neither id (P3-RU-37 (h))', () => {
    expect(PrivacyError.accountLinkMismatch()).toEqual({
      errorCode: 'PRIVACY_ACCOUNT_LINK_MISMATCH',
    });
    expect(Object.keys(PrivacyError.accountLinkMismatch())).toEqual([
      'errorCode',
    ]);
    // Renamed from the erasure-only spelling: no `ERASURE_LINK` code remains.
    expect(
      Object.values(PrivacyErrorCode).filter((code) => code.includes('LINK')),
    ).toEqual(['PRIVACY_ACCOUNT_LINK_MISMATCH']);
  });

  it('an invalid input names the payload field, never its value', () => {
    expect(PrivacyError.invalidInput('customerId')).toEqual({
      errorCode: 'PRIVACY_INVALID_INPUT',
      field: 'customerId',
    });
    expect(PrivacyError.invalidInput('operationId')).toEqual({
      errorCode: 'PRIVACY_INVALID_INPUT',
      field: 'operationId',
    });
  });

  it('keeps every code in the PRIVACY_ domain, SCREAMING_SNAKE, each once', () => {
    const codes = Object.values(PrivacyErrorCode);
    expect(codes).toEqual([
      'PRIVACY_UNAUTHENTICATED',
      'PRIVACY_FORBIDDEN',
      'PRIVACY_INVALID_INPUT',
      'PRIVACY_UNAVAILABLE',
      'PRIVACY_CLIENT_NOT_FOUND',
      'PRIVACY_EXPORT_TOO_LARGE',
      'PRIVACY_ERASURE_STAFF_ACCOUNT',
      'PRIVACY_ACCOUNT_LINK_MISMATCH',
      'PRIVACY_ERASURE_TOO_LARGE',
    ]);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^PRIVACY_[A-Z_]+$/);
  });

  it('every struct is flat and serialisable — a JSON round trip is the identity', () => {
    for (const error of [
      PrivacyError.unauthenticated(),
      PrivacyError.forbidden(),
      PrivacyError.invalidInput('customerId'),
      PrivacyError.unavailable(),
      PrivacyError.clientNotFound(),
      PrivacyError.exportTooLarge(3, 4_194_305),
      PrivacyError.erasureStaffAccount(),
      PrivacyError.accountLinkMismatch(),
      PrivacyError.erasureTooLarge(5_001),
    ]) {
      expect(JSON.parse(JSON.stringify(error))).toEqual(error);
      expect(Object.getPrototypeOf(error)).toBe(Object.prototype);
      for (const value of Object.values(error)) {
        expect(['string', 'number']).toContain(typeof value);
      }
    }
  });

  it('is() narrows by errorCode', () => {
    const error: PrivacyError = PrivacyError.exportTooLarge(7, 4_194_305);
    expect(PrivacyError.is(error, PrivacyErrorCode.ExportTooLarge)).toBe(true);
    expect(PrivacyError.is(error, PrivacyErrorCode.ClientNotFound)).toBe(false);
    if (PrivacyError.is(error, PrivacyErrorCode.ExportTooLarge)) {
      expect(error.exportByteCount).toBe(4_194_305);
    }
    const tooMany: PrivacyError = PrivacyError.erasureTooLarge(5_001);
    expect(PrivacyError.is(tooMany, PrivacyErrorCode.ExportTooLarge)).toBe(
      false,
    );
    if (PrivacyError.is(tooMany, PrivacyErrorCode.ErasureTooLarge)) {
      expect(tooMany.erasureListedCount).toBe(5_001);
    }
  });
});
