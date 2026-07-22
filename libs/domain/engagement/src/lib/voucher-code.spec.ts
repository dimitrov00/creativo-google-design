import { describe, expect, it } from 'vitest';
import { VoucherCode } from './voucher-code';
import { VoucherCodeInvalidError } from './voucher-code.errors';

describe('VoucherCode', () => {
  it('accepts a well-formed code', () => {
    const result = VoucherCode.create('PROMO-2026');
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.value).toBe('PROMO-2026');
    }
  });

  it('rejects a code shorter than 4 characters', () => {
    const result = VoucherCode.create('ab');
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(VoucherCodeInvalidError);
    }
  });

  it('rejects a code longer than 32 characters', () => {
    const result = VoucherCode.create('a'.repeat(33));
    expect(result.isFailure()).toBe(true);
  });

  it('rejects invalid characters', () => {
    const result = VoucherCode.create('promo 2026!');
    expect(result.isFailure()).toBe(true);
  });

  it('preserves case', () => {
    const result = VoucherCode.create('MiXeD-Case1');
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.toString()).toBe('MiXeD-Case1');
    }
  });

  it('equals compares by value', () => {
    const a = VoucherCode.create('SAME-CODE');
    const b = VoucherCode.fromPrimitive('SAME-CODE');
    expect(a.isSuccess()).toBe(true);
    if (a.isSuccess()) {
      expect(a.value.equals(b)).toBe(true);
    }
  });
});
