import { beforeEach, describe, expect, it } from 'vitest';
import {
  BOOKING_FLOW_STEPS,
  BookingDraft,
} from '@creativo/application/booking';
import { SessionStorageDraftStore } from './session-storage-draft-store.adapter';

const KEY = 'creativo.booking-draft';

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

/**
 * The CURRENT envelope version. The malformed-shape tests below need it
 * explicitly: an older version is deliberately read as "absent, start fresh",
 * so pinning shape validation against a stale number silently stops testing
 * anything.
 */
const SCHEMA_VERSION = 3;

const EMPTY_DRAFT: BookingDraft = {
  step: 'services',
  party: { ownerId: null, guests: [], nextSequence: 0 },
  cart: { seats: [], nextSequence: 0 },
  locationId: null,
  timeSlot: null,
  dayKey: null,
};

describe('SessionStorageDraftStore', () => {
  let store: SessionStorageDraftStore;

  beforeEach(() => {
    sessionStorage.clear();
    store = new SessionStorageDraftStore();
  });

  it('accepts every step the FLOW can be on — including the first', () => {
    // The whitelist was a hand-written copy and drifted twice: it kept a step
    // that had been removed, and never listed `location` at all, so a draft
    // saved on step one was discarded on reload — the exact loss the guard
    // exists to prevent. It reads the spine now; this is the proof.
    for (const step of BOOKING_FLOW_STEPS) {
      sessionStorage.clear();
      const saved = store.save({ ...EMPTY_DRAFT, step });
      expect(saved.isSuccess()).toBe(true);

      const loaded = store.load();
      expect(loaded.isSuccess()).toBe(true);
      if (loaded.isSuccess()) expect(loaded.value?.step).toBe(step);
    }
  });

  it('returns null when nothing has been saved yet', () => {
    const result = store.load();
    expect(result.isSuccess()).toBe(true);
    expect(unwrap(result)).toBeNull();
  });

  it('round-trips a full draft through save/load', () => {
    const draft: BookingDraft = {
      step: 'schedule',
      party: {
        ownerId: 'user-1',
        guests: [{ id: 'guest-0', label: 'Maria' }],
        nextSequence: 1,
      },
      cart: {
        seats: [
          {
            seatKey: 'self',
            lines: [
              {
                id: 'line-0',
                serviceId: 'service-1',
                variantId: 'long',
                barberId: 'barber-1',
              },
            ],
          },
          {
            seatKey: 'guest-0',
            lines: [
              {
                id: 'line-1',
                serviceId: 'service-2',
                variantId: null,
                barberId: null,
              },
            ],
          },
        ],
        nextSequence: 2,
      },
      locationId: 'location-1',
      dayKey: '2026-08-03',
      timeSlot: {
        startIso: '2026-08-01T10:00:00.000+03:00',
        endIso: '2026-08-01T10:30:00.000+03:00',
        zone: 'Europe/Sofia',
      },
    };

    expect(store.save(draft).isSuccess()).toBe(true);
    expect(unwrap(store.load())).toEqual(draft);
  });

  it('preserves both monotonic counters — the §7.7 guarantee across a reload', () => {
    const draft: BookingDraft = {
      ...EMPTY_DRAFT,
      party: { ownerId: null, guests: [], nextSequence: 7 },
      cart: { seats: [], nextSequence: 4 },
    };
    store.save(draft);

    const loaded = unwrap(store.load());
    expect(loaded?.party.nextSequence).toBe(7);
    expect(loaded?.cart.nextSequence).toBe(4);
  });

  it('round-trips an ANONYMOUS draft — /book is browsable before sign-in', () => {
    store.save(EMPTY_DRAFT);
    const loaded = unwrap(store.load());
    expect(loaded?.party.ownerId).toBeNull();
    expect(loaded?.step).toBe('services');
  });

  it('clears the stored draft', () => {
    store.save(EMPTY_DRAFT);
    expect(store.clear().isSuccess()).toBe(true);
    expect(unwrap(store.load())).toBeNull();
  });

  it('surfaces corrupted JSON as a failed Result instead of throwing', () => {
    sessionStorage.setItem(KEY, '{not valid json');
    expect(store.load().isFailure()).toBe(true);
  });

  it('surfaces a malformed stored shape as a failed Result', () => {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ version: SCHEMA_VERSION, draft: { step: 'services' } }),
    );
    expect(store.load().isFailure()).toBe(true);
  });

  it('rejects an unknown step rather than restoring the flow into nowhere', () => {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        version: SCHEMA_VERSION,
        draft: { ...EMPTY_DRAFT, step: 'payment' },
      }),
    );
    expect(store.load().isFailure()).toBe(true);
  });

  it('treats a draft from an older schema as absent, not as an error', () => {
    // The pre-cart shape, still sitting in a tab that was open across a
    // deploy. Nothing the user did wrong, so nothing to report — just start
    // fresh rather than half-reading a shape the flow can no longer hold.
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        ownerId: 'user-1',
        barberId: null,
        locationId: null,
        serviceIds: ['service-1'],
        timeSlot: null,
      }),
    );

    const result = store.load();
    expect(result.isSuccess()).toBe(true);
    expect(unwrap(result)).toBeNull();
  });
});
