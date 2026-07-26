import { describe, expect, it } from 'vitest';
import { ZonedDateTime } from '@creativo/domain/kernel';
import { ShopEvent } from './shop-event';

function validProps() {
  return {
    id: 'event_1',
    title: { en: 'Open Chair Day', bg: 'Ден на отворените столове' },
    description: {
      en: 'Walk-in trims, no booking needed',
      bg: 'Подстригвания без резервация',
    },
    startDateIso: '2026-09-12T10:00:00',
    timezone: 'Europe/Sofia',
    locationId: 'loc_center',
    applyUrl: 'https://instagram.com/creativo.barbershop',
    sortOrder: 0,
  };
}

describe('ShopEvent.create', () => {
  it('accepts fully valid props', () => {
    const result = ShopEvent.create(validProps());
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.title.en).toBe('Open Chair Day');
      expect(result.value.startDate.year).toBe(2026);
    }
  });

  it('accepts a missing locationId/applyUrl as null', () => {
    const result = ShopEvent.create({
      id: 'event_1',
      title: { en: 'Open Chair Day', bg: 'Ден на отворените столове' },
      description: {
        en: 'Walk-in trims, no booking needed',
        bg: 'Подстригвания без резервация',
      },
      startDateIso: '2026-09-12T10:00:00',
      timezone: 'Europe/Sofia',
      sortOrder: 0,
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.locationId).toBeNull();
      expect(result.value.applyUrl).toBeNull();
    }
  });

  it('rejects an empty id', () => {
    expect(ShopEvent.create({ ...validProps(), id: '' }).isFailure()).toBe(
      true,
    );
  });

  it('rejects an invalid startDateIso', () => {
    expect(
      ShopEvent.create({
        ...validProps(),
        startDateIso: 'not-a-date',
      }).isFailure(),
    ).toBe(true);
  });

  it('rejects an invalid timezone', () => {
    expect(
      ShopEvent.create({ ...validProps(), timezone: 'Not/AZone' }).isFailure(),
    ).toBe(true);
  });

  it('rejects a negative sort order', () => {
    expect(
      ShopEvent.create({ ...validProps(), sortOrder: -1 }).isFailure(),
    ).toBe(true);
  });

  it('rejects a malformed apply URL', () => {
    expect(
      ShopEvent.create({ ...validProps(), applyUrl: 'not a url' }).isFailure(),
    ).toBe(true);
  });
});

describe('ShopEvent.reconstitute', () => {
  it('validates identically to create()', () => {
    expect(ShopEvent.reconstitute(validProps()).isSuccess()).toBe(true);
  });
});

describe('ShopEvent.isUpcoming / isPast', () => {
  it('is upcoming when startDate is in the future', () => {
    const result = ShopEvent.create(validProps());
    const now = ZonedDateTime.fromISO('2026-01-01T00:00:00', 'Europe/Sofia');
    expect(result.isSuccess() && now.isSuccess()).toBe(true);
    if (result.isSuccess() && now.isSuccess()) {
      expect(result.value.isUpcoming(now.value)).toBe(true);
      expect(result.value.isPast(now.value)).toBe(false);
    }
  });

  it('is past when startDate is in the past', () => {
    const result = ShopEvent.create(validProps());
    const now = ZonedDateTime.fromISO('2027-01-01T00:00:00', 'Europe/Sofia');
    expect(result.isSuccess() && now.isSuccess()).toBe(true);
    if (result.isSuccess() && now.isSuccess()) {
      expect(result.value.isUpcoming(now.value)).toBe(false);
      expect(result.value.isPast(now.value)).toBe(true);
    }
  });
});
