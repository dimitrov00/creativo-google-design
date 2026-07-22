import { describe, expect, it } from 'vitest';
import { LocationId, ServiceId } from './ids';
import { Service } from './service';

function validProps() {
  return {
    id: 'service_1',
    name: { en: 'Haircut', bg: 'Подстригване' },
    description: { en: 'Scissor or clipper cut', bg: 'Ножица или машинка' },
    categoryId: 'category_hair',
    priceMinorUnits: 1500,
    currencyCode: 'EUR',
    durationMinutes: 30,
    locationIds: ['loc_center'],
    conflictsWith: [],
    offering: { kind: 'single' as const },
    upsellOnly: false,
    popular: true,
    status: 'active' as const,
    sortOrder: 0,
  };
}

describe('Service.create', () => {
  it('accepts fully valid single-service props', () => {
    const result = Service.create(validProps());
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.name.en).toBe('Haircut');
      expect(result.value.price.toMinorUnits()).toBe(1500);
      expect(result.value.durationMinutes).toBe(30);
      expect(result.value.isBundle()).toBe(false);
    }
  });

  it('accepts a valid bundle service', () => {
    const result = Service.create({
      ...validProps(),
      offering: {
        kind: 'bundle',
        includes: ['service_haircut', 'service_beard'],
      },
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.isBundle()).toBe(true);
      expect(
        result.value.offering.kind === 'bundle' &&
          result.value.offering.includes,
      ).toHaveLength(2);
    }
  });

  it('rejects a bundle with no includes', () => {
    const result = Service.create({
      ...validProps(),
      offering: { kind: 'bundle', includes: [] },
    });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error[0]?.code).toBe(
        'catalog.service.empty_bundle_includes',
      );
    }
  });

  it('rejects an empty id', () => {
    expect(Service.create({ ...validProps(), id: '' }).isFailure()).toBe(true);
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

  it('rejects a negative sort order', () => {
    expect(Service.create({ ...validProps(), sortOrder: -1 }).isFailure()).toBe(
      true,
    );
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

  it('rejects a blank localized name/description field', () => {
    expect(
      Service.create({
        ...validProps(),
        description: { en: '', bg: 'Ножица' },
      }).isFailure(),
    ).toBe(true);
  });

  it('rejects an empty locationId in the list', () => {
    expect(
      Service.create({
        ...validProps(),
        locationIds: ['loc_1', ''],
      }).isFailure(),
    ).toBe(true);
  });

  it('rejects an empty conflictsWith id', () => {
    expect(
      Service.create({
        ...validProps(),
        conflictsWith: [''],
      }).isFailure(),
    ).toBe(true);
  });

  it('collects every invalid field at once', () => {
    const result = Service.create({
      ...validProps(),
      id: '',
      durationMinutes: 0,
      sortOrder: -1,
      currencyCode: 'XXX',
    });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.length).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('Service.reconstitute', () => {
  it('validates identically to create()', () => {
    expect(Service.reconstitute(validProps()).isSuccess()).toBe(true);
  });
});

describe('Service.servesLocation / conflictsWithService', () => {
  it('treats an empty locationIds as "available everywhere"', () => {
    const result = Service.create({ ...validProps(), locationIds: [] });
    const someLocation = LocationId.create('loc_mladost');
    expect(result.isSuccess() && someLocation.isSuccess()).toBe(true);
    if (result.isSuccess() && someLocation.isSuccess()) {
      expect(result.value.servesLocation(someLocation.value)).toBe(true);
    }
  });

  it('matches only listed locations when scoped', () => {
    const result = Service.create({
      ...validProps(),
      locationIds: ['loc_center'],
    });
    const center = LocationId.create('loc_center');
    const mladost = LocationId.create('loc_mladost');
    expect(
      result.isSuccess() && center.isSuccess() && mladost.isSuccess(),
    ).toBe(true);
    if (result.isSuccess() && center.isSuccess() && mladost.isSuccess()) {
      expect(result.value.servesLocation(center.value)).toBe(true);
      expect(result.value.servesLocation(mladost.value)).toBe(false);
    }
  });

  it('flags a conflicting service id', () => {
    const conflict = ServiceId.create('service_shave');
    expect(conflict.isSuccess()).toBe(true);
    if (!conflict.isSuccess()) return;

    const result = Service.create({
      ...validProps(),
      conflictsWith: ['service_shave'],
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.conflictsWithService(conflict.value)).toBe(true);
    }
  });

  it('does not flag a non-conflicting service id', () => {
    const other = ServiceId.create('service_other');
    expect(other.isSuccess()).toBe(true);
    if (!other.isSuccess()) return;

    const result = Service.create(validProps());
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.conflictsWithService(other.value)).toBe(false);
    }
  });
});
