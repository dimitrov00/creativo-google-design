import { describe, expect, it } from 'vitest';
import { Service } from './service';

function validProps() {
  return {
    id: 'service_1',
    tenantId: 'creativo',
    name: 'Haircut',
    priceMinorUnits: 3000,
    depositMinorUnits: 500,
    currencyCode: 'USD',
    durationMinutes: 30,
  };
}

describe('Service.create', () => {
  it('accepts fully valid props', () => {
    const result = Service.create(validProps());
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.name).toBe('Haircut');
      expect(result.value.price.toMinorUnits()).toBe(3000);
      expect(result.value.deposit.toMinorUnits()).toBe(500);
      expect(result.value.durationMinutes).toBe(30);
    }
  });

  it('rejects an empty name', () => {
    expect(Service.create({ ...validProps(), name: ' ' }).isFailure()).toBe(
      true,
    );
  });

  it('rejects a zero or negative duration', () => {
    expect(
      Service.create({ ...validProps(), durationMinutes: 0 }).isFailure(),
    ).toBe(true);
    expect(
      Service.create({ ...validProps(), durationMinutes: -15 }).isFailure(),
    ).toBe(true);
  });

  it('rejects a non-integer duration', () => {
    expect(
      Service.create({ ...validProps(), durationMinutes: 30.5 }).isFailure(),
    ).toBe(true);
  });

  it('rejects an unknown currency code', () => {
    expect(
      Service.create({ ...validProps(), currencyCode: 'XXX' }).isFailure(),
    ).toBe(true);
  });

  it('rejects a negative price', () => {
    expect(
      Service.create({ ...validProps(), priceMinorUnits: -100 }).isFailure(),
    ).toBe(true);
  });
});
