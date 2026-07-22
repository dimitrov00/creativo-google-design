import { describe, expect, it } from 'vitest';
import { Barber } from './barber';
import { LocationId } from './ids';
import { MediaRef } from './media-ref';

function validProps() {
  return {
    id: 'barber_1',
    name: { en: 'Ivan Kolev', bg: 'Иван Колев' },
    handle: '@ivan.cuts',
    title: { en: 'Master Barber', bg: 'Майстор бръснар' },
    bio: { en: 'Fades and beard sculpting.', bg: 'Фейдове и брада.' },
    yearsExperience: 8,
    locationIds: ['loc_center'],
    instagramHandle: 'ivan.cuts',
    status: 'active' as const,
    sortOrder: 0,
  };
}

describe('Barber.create', () => {
  it('accepts fully valid props', () => {
    const result = Barber.create(validProps());
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.name.en).toBe('Ivan Kolev');
      expect(result.value.handle).toBe('@ivan.cuts');
      expect(result.value.yearsExperience).toBe(8);
      expect(result.value.instagramHandle).toBe('ivan.cuts');
      expect(result.value.locationIds).toHaveLength(1);
    }
  });

  it('accepts omitted optional fields', () => {
    const result = Barber.create({
      id: 'barber_1',
      name: { en: 'Ivan Kolev', bg: 'Иван Колев' },
      handle: '@ivan.cuts',
      title: { en: 'Master Barber', bg: 'Майстор бръснар' },
      bio: { en: 'Fades and beard sculpting.', bg: 'Фейдове и брада.' },
      locationIds: [],
      status: 'active',
      sortOrder: 0,
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.yearsExperience).toBeNull();
      expect(result.value.instagramHandle).toBeNull();
      expect(result.value.avatar).toBeNull();
    }
  });

  it('accepts an already-constructed avatar MediaRef', () => {
    const avatarResult = MediaRef.create({
      id: 'media_1',
      path: 'barbers/ivan/avatar.jpg',
      width: 400,
      height: 400,
    });
    expect(avatarResult.isSuccess()).toBe(true);
    if (!avatarResult.isSuccess()) return;

    const result = Barber.create({
      ...validProps(),
      avatar: avatarResult.value,
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.avatar?.path).toBe('barbers/ivan/avatar.jpg');
    }
  });

  it('rejects an empty id', () => {
    expect(Barber.create({ ...validProps(), id: '' }).isFailure()).toBe(true);
  });

  it('rejects a blank handle', () => {
    expect(Barber.create({ ...validProps(), handle: '  ' }).isFailure()).toBe(
      true,
    );
  });

  it('rejects a negative yearsExperience', () => {
    expect(
      Barber.create({ ...validProps(), yearsExperience: -1 }).isFailure(),
    ).toBe(true);
  });

  it('rejects a negative sortOrder', () => {
    expect(Barber.create({ ...validProps(), sortOrder: -1 }).isFailure()).toBe(
      true,
    );
  });

  it('rejects a blank localized name/title/bio field', () => {
    expect(
      Barber.create({
        ...validProps(),
        name: { en: '', bg: 'Иван Колев' },
      }).isFailure(),
    ).toBe(true);
  });

  it('rejects an empty locationId in the list', () => {
    expect(
      Barber.create({
        ...validProps(),
        locationIds: ['loc_1', ''],
      }).isFailure(),
    ).toBe(true);
  });

  it('collects every invalid field at once', () => {
    const result = Barber.create({
      ...validProps(),
      id: '',
      handle: '',
      yearsExperience: -1,
      sortOrder: -1,
    });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.length).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('Barber.reconstitute', () => {
  it('validates identically to create()', () => {
    expect(Barber.reconstitute(validProps()).isSuccess()).toBe(true);
  });
});

describe('Barber.servesLocation', () => {
  it('treats an empty locationIds as "available everywhere"', () => {
    const result = Barber.create({ ...validProps(), locationIds: [] });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      const someLocation = LocationId.create('mladost');
      expect(someLocation.isSuccess()).toBe(true);
      if (someLocation.isSuccess()) {
        expect(result.value.servesLocation(someLocation.value)).toBe(true);
      }
    }
  });

  it('matches only listed locations when scoped', () => {
    const result = Barber.create({
      ...validProps(),
      locationIds: ['loc_center'],
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      const center = LocationId.create('loc_center');
      const mladost = LocationId.create('mladost');
      expect(center.isSuccess() && mladost.isSuccess()).toBe(true);
      if (center.isSuccess() && mladost.isSuccess()) {
        expect(result.value.servesLocation(center.value)).toBe(true);
        expect(result.value.servesLocation(mladost.value)).toBe(false);
      }
    }
  });
});
