import { describe, expect, it } from 'vitest';
import { BarberId, LocationId, ServiceId, ServiceVariantId } from './ids';
import { Service } from './service';

const LENGTH_VARIANTS = [
  { id: 'short', name: { en: 'Short hair', bg: 'Къса коса' } },
  { id: 'long', name: { en: 'Long hair', bg: 'Дълга коса' } },
];

const terms = (priceMinorUnits: number, durationMinutes: number) => ({
  priceMinorUnits,
  currencyCode: 'EUR',
  durationMinutes,
});

/** Ivan prices long hair higher; Niko charges one rate for both. */
function withMatrix() {
  return {
    ...validProps(),
    variants: LENGTH_VARIANTS,
    offerings: [
      {
        barberId: 'ivan',
        base: terms(1450, 35),
        byVariant: { short: terms(1450, 35), long: terms(1850, 50) },
      },
      { barberId: 'niko', base: terms(1300, 30) },
    ],
  };
}

const unwrap = <T>(r: { isSuccess(): boolean; value?: T }): T => {
  if (!r.isSuccess()) throw new Error('unexpected failure in test fixture');
  return r.value as T;
};

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
    composition: { kind: 'single' as const },
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
      expect(result.value.baseTerms.price.toMinorUnits()).toBe(1500);
      expect(result.value.baseTerms.durationMinutes).toBe(30);
      expect(result.value.isBundle()).toBe(false);
    }
  });

  it('accepts a valid bundle service', () => {
    const result = Service.create({
      ...validProps(),
      composition: {
        kind: 'bundle',
        includes: ['service_haircut', 'service_beard'],
      },
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.isBundle()).toBe(true);
      expect(
        result.value.composition.kind === 'bundle' &&
          result.value.composition.includes,
      ).toHaveLength(2);
    }
  });

  it('rejects a bundle with no includes', () => {
    const result = Service.create({
      ...validProps(),
      composition: { kind: 'bundle', includes: [] },
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

describe('Service terms matrix', () => {
  it('resolves a barber + variant to that barber’s override', () => {
    const service = unwrap(Service.create(withMatrix()));
    const ivan = unwrap(BarberId.create('ivan'));
    const long = unwrap(ServiceVariantId.create('long'));
    const resolved = service.termsFor(ivan, long);
    expect(resolved.price.toMinorUnits()).toBe(1850);
    expect(resolved.durationMinutes).toBe(50);
  });

  it('falls back to the barber’s base when they don’t price that variant', () => {
    const service = unwrap(Service.create(withMatrix()));
    const niko = unwrap(BarberId.create('niko'));
    const long = unwrap(ServiceVariantId.create('long'));
    // Niko stores no overrides at all — sparse by design, not backfilled.
    expect(service.termsFor(niko, long).price.toMinorUnits()).toBe(1300);
  });

  it('falls back to the service’s base terms for an unknown or absent barber', () => {
    const service = unwrap(Service.create(withMatrix()));
    const stranger = unwrap(BarberId.create('not-a-performer'));
    expect(service.termsFor(stranger).price.toMinorUnits()).toBe(1500);
    expect(service.termsFor().price.toMinorUnits()).toBe(1500);
    expect(service.termsFor(null, null).price.toMinorUnits()).toBe(1500);
  });

  it('folds the whole matrix into a price and duration range', () => {
    const service = unwrap(Service.create(withMatrix()));
    // base 15,00 · ivan 14,50/18,50 · niko 13,00
    expect(service.priceRange().min.toMinorUnits()).toBe(1300);
    expect(service.priceRange().max.toMinorUnits()).toBe(1850);
    expect(service.durationRange()).toEqual({ min: 30, max: 50 });
  });

  it('reports who performs it', () => {
    const service = unwrap(Service.create(withMatrix()));
    const ivan = unwrap(BarberId.create('ivan'));
    const stranger = unwrap(BarberId.create('nobody'));
    expect(service.performerIds().map((id) => id.value)).toEqual([
      'ivan',
      'niko',
    ]);
    expect(service.isPerformedBy(ivan)).toBe(true);
    expect(service.isPerformedBy(stranger)).toBe(false);
  });

  it('still ranges over a service nobody is priced for yet', () => {
    const service = unwrap(Service.create(validProps()));
    expect(service.offerings).toHaveLength(0);
    expect(service.priceRange().min.toMinorUnits()).toBe(1500);
    expect(service.durationRange()).toEqual({ min: 30, max: 30 });
  });

  it('rejects an override naming a variant the service does not offer', () => {
    const result = Service.create({
      ...withMatrix(),
      offerings: [
        {
          barberId: 'ivan',
          base: terms(1450, 35),
          byVariant: { curly: terms(1600, 40) },
        },
      ],
    });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error[0]?.code).toBe(
        'catalog.service.unknown_variant_terms',
      );
    }
  });

  it('rejects a duplicate variant declaration', () => {
    const result = Service.create({
      ...validProps(),
      variants: [LENGTH_VARIANTS[0]!, LENGTH_VARIANTS[0]!],
    });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error[0]?.code).toBe('catalog.service.duplicate_variant');
    }
  });

  it('rejects the same barber offering twice', () => {
    const result = Service.create({
      ...validProps(),
      offerings: [
        { barberId: 'ivan', base: terms(1450, 35) },
        { barberId: 'ivan', base: terms(1500, 40) },
      ],
    });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error[0]?.code).toBe('catalog.service.duplicate_offering');
    }
  });

  it('rejects a matrix quoted in more than one currency', () => {
    const result = Service.create({
      ...validProps(),
      offerings: [
        {
          barberId: 'ivan',
          base: {
            priceMinorUnits: 1450,
            currencyCode: 'USD',
            durationMinutes: 35,
          },
        },
      ],
    });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error[0]?.code).toBe(
        'catalog.service.mixed_currency_terms',
      );
    }
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
