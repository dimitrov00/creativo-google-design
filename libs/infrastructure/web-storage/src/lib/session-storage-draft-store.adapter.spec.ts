import { beforeEach, describe, expect, it } from 'vitest';
import { UserId } from '@creativo/domain/accounts';
import { BarberId, LocationId, ServiceId } from '@creativo/domain/catalog';
import { TimeSlot } from '@creativo/domain/scheduling';
import { BookingDraft } from '@creativo/application/booking';
import { SessionStorageDraftStore } from './session-storage-draft-store.adapter';

function unwrap<T, E>(result: {
  isSuccess(): boolean;
  value?: T;
  error?: E;
}): T {
  if (!result.isSuccess()) {
    throw new Error(
      `Expected success, got failure: ${JSON.stringify(result.error)}`,
    );
  }
  return result.value as T;
}

describe('SessionStorageDraftStore', () => {
  let store: SessionStorageDraftStore;

  beforeEach(() => {
    sessionStorage.clear();
    store = new SessionStorageDraftStore();
  });

  it('returns null when nothing has been saved yet', () => {
    const result = store.load();
    expect(result.isSuccess()).toBe(true);
    expect(unwrap(result)).toBeNull();
  });

  it('round-trips a full draft through save/load', () => {
    const timeSlot = unwrap(
      TimeSlot.create({
        startIso: '2026-08-01T10:00:00.000+03:00',
        endIso: '2026-08-01T10:30:00.000+03:00',
        zone: 'Europe/Sofia',
      }),
    );
    const draft: BookingDraft = {
      ownerId: unwrap(UserId.create('user-1')),
      barberId: unwrap(BarberId.create('barber-1')),
      locationId: unwrap(LocationId.create('location-1')),
      serviceIds: [
        unwrap(ServiceId.create('service-1')),
        unwrap(ServiceId.create('service-2')),
      ],
      timeSlot,
    };

    expect(store.save(draft).isSuccess()).toBe(true);

    const loaded = unwrap(store.load());
    expect(loaded).not.toBeNull();
    expect(loaded?.ownerId.value).toBe('user-1');
    expect(loaded?.barberId?.value).toBe('barber-1');
    expect(loaded?.locationId?.value).toBe('location-1');
    expect(loaded?.serviceIds.map((s) => s.value)).toEqual([
      'service-1',
      'service-2',
    ]);
    expect(loaded?.timeSlot?.start.toISO()).toBe(timeSlot.start.toISO());
  });

  it('round-trips a partial draft (nulls for not-yet-chosen fields)', () => {
    const draft: BookingDraft = {
      ownerId: unwrap(UserId.create('user-1')),
      barberId: null,
      locationId: null,
      serviceIds: [],
      timeSlot: null,
    };

    store.save(draft);
    const loaded = unwrap(store.load());
    expect(loaded?.barberId).toBeNull();
    expect(loaded?.locationId).toBeNull();
    expect(loaded?.serviceIds).toEqual([]);
    expect(loaded?.timeSlot).toBeNull();
  });

  it('clears the stored draft', () => {
    const draft: BookingDraft = {
      ownerId: unwrap(UserId.create('user-1')),
      barberId: null,
      locationId: null,
      serviceIds: [],
      timeSlot: null,
    };
    store.save(draft);

    expect(store.clear().isSuccess()).toBe(true);
    expect(unwrap(store.load())).toBeNull();
  });

  it('surfaces corrupted JSON as a failed Result instead of throwing', () => {
    sessionStorage.setItem('creativo.booking-draft', '{not valid json');

    const result = store.load();
    expect(result.isFailure()).toBe(true);
  });

  it('surfaces a malformed stored shape (bad ownerId) as a failed Result', () => {
    sessionStorage.setItem(
      'creativo.booking-draft',
      JSON.stringify({
        ownerId: '',
        barberId: null,
        locationId: null,
        serviceIds: [],
        timeSlot: null,
      }),
    );

    const result = store.load();
    expect(result.isFailure()).toBe(true);
  });
});
