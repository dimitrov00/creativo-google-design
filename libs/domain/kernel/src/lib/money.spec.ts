import { EUR, USD } from 'dinero.js';
import { describe, expect, it } from 'vitest';
import { Money } from './money';

function usd(amount: number) {
  const result = Money.fromMinorUnits(amount, USD);
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

describe('Money.fromMinorUnits', () => {
  it('accepts a non-negative integer amount', () => {
    const result = Money.fromMinorUnits(3000, USD);
    expect(result.isSuccess()).toBe(true);
  });

  it('rejects a negative amount', () => {
    const result = Money.fromMinorUnits(-100, USD);
    expect(result.isFailure()).toBe(true);
  });

  it('rejects a non-integer amount', () => {
    const result = Money.fromMinorUnits(30.5, USD);
    expect(result.isFailure()).toBe(true);
  });
});

describe('Money arithmetic', () => {
  it('adds two amounts in the same currency', () => {
    const result = usd(1000).add(usd(500));
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.toMinorUnits()).toBe(1500);
    }
  });

  it('subtracts two amounts in the same currency', () => {
    const result = usd(1000).subtract(usd(300));
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.toMinorUnits()).toBe(700);
    }
  });

  it('rejects adding mismatched currencies instead of throwing', () => {
    const eur = Money.fromMinorUnits(1000, EUR);
    if (eur.isFailure()) throw new Error('unexpected failure in test fixture');
    const result = usd(1000).add(eur.value);
    expect(result.isFailure()).toBe(true);
  });

  it('equals() compares amount and currency', () => {
    expect(usd(1000).equals(usd(1000))).toBe(true);
    expect(usd(1000).equals(usd(999))).toBe(false);
  });

  it('currencyCode() reflects the constructed currency', () => {
    expect(usd(1000).currencyCode()).toBe('USD');
  });
});

describe('Money.fromMinorUnitsAndCode', () => {
  it('accepts a known currency code', () => {
    const result = Money.fromMinorUnitsAndCode(1000, 'usd');
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.currencyCode()).toBe('USD');
    }
  });

  it('rejects an unknown currency code', () => {
    const result = Money.fromMinorUnitsAndCode(1000, 'XXX');
    expect(result.isFailure()).toBe(true);
  });

  it('still rejects an invalid amount for a known currency code', () => {
    const result = Money.fromMinorUnitsAndCode(-100, 'USD');
    expect(result.isFailure()).toBe(true);
  });
});
