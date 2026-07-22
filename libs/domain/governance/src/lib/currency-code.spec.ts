import { describe, expect, it } from 'vitest';
import { CurrencyCode } from './currency-code';

describe('CurrencyCode.create', () => {
  it('accepts a known, curated currency code', () => {
    const result = CurrencyCode.create('eur');
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.value).toBe('EUR');
    }
  });

  it('rejects an unknown currency code', () => {
    const result = CurrencyCode.create('XYZ');
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.code).toBe('governance.currency_code.unknown');
    }
  });
});

describe('CurrencyCode.fromPrimitive / equals / toString', () => {
  it('normalizes to uppercase and compares by value', () => {
    const a = CurrencyCode.fromPrimitive('bgn');
    const b = CurrencyCode.create('BGN');
    if (b.isFailure()) throw new Error('unexpected failure in test fixture');
    expect(a.equals(b.value)).toBe(true);
    expect(a.toString()).toBe('BGN');
  });
});
