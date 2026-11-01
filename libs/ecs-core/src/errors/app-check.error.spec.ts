import { describe, expect, it } from 'vitest';
import { AppCheckOutcome } from '@core/primitives';
import { AppCheckError, AppCheckErrorCode } from './app-check.error';

describe('AppCheckError', () => {
  it('uses the two SCREAMING codes, each with the APP_CHECK_ prefix (S-RU-24)', () => {
    expect(Object.values(AppCheckErrorCode)).toEqual([
      'APP_CHECK_REQUIRED',
      'APP_CHECK_REPLAYED',
    ]);
    for (const code of Object.values(AppCheckErrorCode)) {
      expect(code).toMatch(/^APP_CHECK_[A-Z_]+$/);
    }
  });

  it('builds a flat REQUIRED refusal naming its outcome — MISSING or INVALID', () => {
    expect(AppCheckError.required(AppCheckOutcome.Missing)).toEqual({
      errorCode: 'APP_CHECK_REQUIRED',
      appCheckOutcome: 'MISSING',
    });
    expect(AppCheckError.required(AppCheckOutcome.Invalid)).toEqual({
      errorCode: 'APP_CHECK_REQUIRED',
      appCheckOutcome: 'INVALID',
    });
  });

  it('builds a flat REPLAYED refusal whose outcome is always REPLAYED', () => {
    expect(AppCheckError.replayed()).toEqual({
      errorCode: 'APP_CHECK_REPLAYED',
      appCheckOutcome: 'REPLAYED',
    });
  });

  it('carries the outcome tag only — never a token or any other field', () => {
    expect(
      Object.keys(AppCheckError.required(AppCheckOutcome.Missing)).sort(),
    ).toEqual(['appCheckOutcome', 'errorCode']);
    expect(Object.keys(AppCheckError.replayed()).sort()).toEqual([
      'appCheckOutcome',
      'errorCode',
    ]);
  });

  it('is serialisable and prototype-free (Law 7.5)', () => {
    for (const error of [
      AppCheckError.required(AppCheckOutcome.Invalid),
      AppCheckError.replayed(),
    ]) {
      expect(Object.getPrototypeOf(error)).toBe(Object.prototype);
      expect(JSON.parse(JSON.stringify(error))).toEqual(error);
    }
  });
});
