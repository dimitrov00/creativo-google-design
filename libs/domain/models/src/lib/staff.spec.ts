import { describe, expect, it } from 'vitest';
import { Staff } from './staff';

function validProps() {
  return {
    id: 'staff_1',
    uid: 'uid_1',
    tenantId: 'creativo',
    displayName: 'Ivo',
    serviceIds: ['service_1', 'service_2'],
    workingHours: { monday: { start: '09:00', end: '18:00' } },
  };
}

describe('Staff.create', () => {
  it('accepts fully valid props', () => {
    const result = Staff.create(validProps());
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.displayName).toBe('Ivo');
      expect(result.value.serviceIds).toHaveLength(2);
      expect(result.value.workingHours.rangeFor('monday')?.start).toBe('09:00');
    }
  });

  it('accepts an empty serviceIds list and empty working hours', () => {
    const result = Staff.create({
      ...validProps(),
      serviceIds: [],
      workingHours: {},
    });
    expect(result.isSuccess()).toBe(true);
  });

  it('rejects an empty display name', () => {
    expect(
      Staff.create({ ...validProps(), displayName: '  ' }).isFailure(),
    ).toBe(true);
  });

  it('rejects an empty serviceId in the list', () => {
    expect(
      Staff.create({
        ...validProps(),
        serviceIds: ['service_1', ''],
      }).isFailure(),
    ).toBe(true);
  });

  it('rejects malformed working hours', () => {
    const result = Staff.create({
      ...validProps(),
      workingHours: { monday: { start: 'bad', end: '18:00' } },
    });
    expect(result.isFailure()).toBe(true);
  });
});
