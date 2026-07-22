import { describe, expect, it } from 'vitest';
import { LocationId } from './ids';
import { Location, LocationDayHours, locationScopeServes } from './location';

const CLOSED: LocationDayHours = { kind: 'closed' };
const OPEN_9_18: LocationDayHours = {
  kind: 'open',
  opens: '09:00',
  closes: '18:00',
};

function validHours(): LocationDayHours[] {
  return [
    OPEN_9_18,
    OPEN_9_18,
    OPEN_9_18,
    OPEN_9_18,
    OPEN_9_18,
    OPEN_9_18,
    CLOSED,
  ];
}

function validProps() {
  return {
    id: 'location_1',
    name: { en: 'Creativo · Center', bg: 'Креативо · Център' },
    address: { en: '1 Vitosha Blvd', bg: 'бул. Витоша 1' },
    phone: { e164: '+359881234567', display: '+359 88 123 4567' },
    geo: { lat: 42.6977, lng: 23.3219 },
    mapUrl: 'https://maps.example.com/center',
    hours: validHours(),
    timezone: 'Europe/Sofia',
    status: 'active' as const,
    sortOrder: 0,
  };
}

describe('Location.create', () => {
  it('accepts fully valid props', () => {
    const result = Location.create(validProps());
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.name.en).toBe('Creativo · Center');
      expect(result.value.phone.e164).toBe('+359881234567');
      expect(result.value.hours).toHaveLength(7);
      expect(result.value.hours[6]).toEqual({ kind: 'closed' });
      expect(result.value.mapUrl).toBe('https://maps.example.com/center');
    }
  });

  it('accepts omitted optional mapUrl/cover/photos', () => {
    const result = Location.create({
      id: 'location_1',
      name: { en: 'Creativo · Center', bg: 'Креативо · Център' },
      address: { en: '1 Vitosha Blvd', bg: 'бул. Витоша 1' },
      phone: { e164: '+359881234567', display: '+359 88 123 4567' },
      geo: { lat: 42.6977, lng: 23.3219 },
      hours: validHours(),
      timezone: 'Europe/Sofia',
      status: 'active',
      sortOrder: 0,
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.mapUrl).toBeNull();
      expect(result.value.cover).toBeNull();
      expect(result.value.photos).toEqual([]);
    }
  });

  it('rejects an empty id', () => {
    expect(Location.create({ ...validProps(), id: '' }).isFailure()).toBe(true);
  });

  it('rejects an out-of-range latitude/longitude', () => {
    expect(
      Location.create({
        ...validProps(),
        geo: { lat: 200, lng: 23 },
      }).isFailure(),
    ).toBe(true);
    expect(
      Location.create({
        ...validProps(),
        geo: { lat: 42, lng: 200 },
      }).isFailure(),
    ).toBe(true);
  });

  it('rejects an invalid time zone', () => {
    expect(
      Location.create({ ...validProps(), timezone: 'Not/AZone' }).isFailure(),
    ).toBe(true);
  });

  it('rejects a negative sort order', () => {
    expect(
      Location.create({ ...validProps(), sortOrder: -1 }).isFailure(),
    ).toBe(true);
  });

  it('rejects a malformed map URL', () => {
    expect(
      Location.create({ ...validProps(), mapUrl: 'not a url' }).isFailure(),
    ).toBe(true);
  });

  it('rejects an invalid venue phone', () => {
    expect(
      Location.create({
        ...validProps(),
        phone: { e164: 'not-a-phone', display: 'x' },
      }).isFailure(),
    ).toBe(true);
  });

  it('rejects a blank localized name/address field', () => {
    expect(
      Location.create({
        ...validProps(),
        address: { en: '', bg: 'бул. Витоша 1' },
      }).isFailure(),
    ).toBe(true);
  });

  it('rejects hours that are not exactly 7 entries', () => {
    expect(
      Location.create({ ...validProps(), hours: [OPEN_9_18] }).isFailure(),
    ).toBe(true);
  });

  it('rejects a malformed time-of-day string', () => {
    const hours = validHours();
    hours[0] = { kind: 'open', opens: 'bad', closes: '18:00' };
    expect(Location.create({ ...validProps(), hours }).isFailure()).toBe(true);
  });

  it('rejects an open day where closes is not after opens', () => {
    const hours = validHours();
    hours[0] = { kind: 'open', opens: '18:00', closes: '09:00' };
    expect(Location.create({ ...validProps(), hours }).isFailure()).toBe(true);
  });

  it('collects every invalid field at once', () => {
    const result = Location.create({
      ...validProps(),
      id: '',
      geo: { lat: 200, lng: 200 },
      timezone: 'Not/AZone',
      sortOrder: -1,
    });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.length).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('Location.reconstitute', () => {
  it('validates identically to create()', () => {
    expect(Location.reconstitute(validProps()).isSuccess()).toBe(true);
  });
});

describe('locationScopeServes', () => {
  const CENTER = LocationId.create('center');
  const MLADOST = LocationId.create('mladost');

  it('treats an empty locationIds as "available everywhere"', () => {
    expect(CENTER.isSuccess() && MLADOST.isSuccess()).toBe(true);
    if (CENTER.isSuccess() && MLADOST.isSuccess()) {
      expect(locationScopeServes([], CENTER.value)).toBe(true);
      expect(locationScopeServes([], MLADOST.value)).toBe(true);
    }
  });

  it('matches only the listed locations when scoped', () => {
    if (CENTER.isSuccess() && MLADOST.isSuccess()) {
      expect(locationScopeServes([CENTER.value], CENTER.value)).toBe(true);
      expect(locationScopeServes([CENTER.value], MLADOST.value)).toBe(false);
    }
  });
});
