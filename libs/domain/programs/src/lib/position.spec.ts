import { describe, expect, it } from 'vitest';
import { LocationId } from '@creativo/domain/catalog';
import { Position } from './position';

function validProps() {
  return {
    id: 'position_1',
    title: { en: 'Barber', bg: 'Бръснар' },
    summary: {
      en: 'Full-time chair, Center location',
      bg: 'Пълен работен ден',
    },
    locationIds: ['loc_center'],
    status: 'open' as const,
    applyUrl: 'https://instagram.com/creativo.barbershop',
    sortOrder: 0,
  };
}

describe('Position.create', () => {
  it('accepts fully valid props', () => {
    const result = Position.create(validProps());
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.title.en).toBe('Barber');
      expect(result.value.isOpen()).toBe(true);
    }
  });

  it('accepts a missing applyUrl as null', () => {
    const result = Position.create({
      id: 'position_1',
      title: { en: 'Barber', bg: 'Бръснар' },
      summary: {
        en: 'Full-time chair, Center location',
        bg: 'Пълен работен ден',
      },
      locationIds: ['loc_center'],
      status: 'open',
      sortOrder: 0,
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.applyUrl).toBeNull();
    }
  });

  it('rejects an empty id', () => {
    expect(Position.create({ ...validProps(), id: '' }).isFailure()).toBe(true);
  });

  it('rejects a blank localized title field', () => {
    expect(
      Position.create({
        ...validProps(),
        title: { en: '', bg: 'Бръснар' },
      }).isFailure(),
    ).toBe(true);
  });

  it('rejects a negative sort order', () => {
    expect(
      Position.create({ ...validProps(), sortOrder: -1 }).isFailure(),
    ).toBe(true);
  });

  it('rejects a malformed apply URL', () => {
    expect(
      Position.create({ ...validProps(), applyUrl: 'not a url' }).isFailure(),
    ).toBe(true);
  });

  it('rejects an empty locationId in the list', () => {
    expect(
      Position.create({
        ...validProps(),
        locationIds: ['loc_1', ''],
      }).isFailure(),
    ).toBe(true);
  });

  it('collects every invalid field at once', () => {
    const result = Position.create({
      ...validProps(),
      id: '',
      sortOrder: -1,
      applyUrl: 'not a url',
    });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('Position.reconstitute', () => {
  it('validates identically to create()', () => {
    expect(Position.reconstitute(validProps()).isSuccess()).toBe(true);
  });
});

describe('Position.servesLocation', () => {
  it('treats an empty locationIds as "available everywhere"', () => {
    const result = Position.create({ ...validProps(), locationIds: [] });
    const someLocation = LocationId.create('loc_mladost');
    expect(result.isSuccess() && someLocation.isSuccess()).toBe(true);
    if (result.isSuccess() && someLocation.isSuccess()) {
      expect(result.value.servesLocation(someLocation.value)).toBe(true);
    }
  });

  it('matches only listed locations when scoped', () => {
    const result = Position.create({
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
});
