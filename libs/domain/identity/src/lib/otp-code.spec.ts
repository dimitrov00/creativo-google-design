import { describe, expect, it } from 'vitest';
import { OtpCode } from './otp-code';

describe('OtpCode.create', () => {
  it('accepts a 6-digit code', () => {
    const result = OtpCode.create('123456');
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.value).toBe('123456');
    }
  });

  it('accepts a code with leading zeros', () => {
    const result = OtpCode.create('000123');
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.value).toBe('000123');
    }
  });

  it('trims surrounding whitespace', () => {
    const result = OtpCode.create('  654321  ');
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.value).toBe('654321');
    }
  });

  it('rejects a code that is not exactly 6 digits', () => {
    expect(OtpCode.create('12345').isFailure()).toBe(true);
    expect(OtpCode.create('1234567').isFailure()).toBe(true);
    expect(OtpCode.create('12a456').isFailure()).toBe(true);
    expect(OtpCode.create('').isFailure()).toBe(true);
  });
});

describe('OtpCode.fromPrimitive / equals / toString', () => {
  it('wraps a trusted value and compares by value', () => {
    const a = OtpCode.fromPrimitive('123456');
    const b = OtpCode.fromPrimitive('123456');
    const c = OtpCode.fromPrimitive('654321');
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
    expect(a.toString()).toBe('123456');
  });
});
