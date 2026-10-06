import { describe, expect, it } from 'vitest';
import { fail } from '@creativo/domain/kernel';
import type { DecideBookingRequest } from './decide-booking';
import { FixedClock } from '../test-support/fixed-clock';
import { CommitBookingStoreError } from './commit-booking.errors';
import {
  type BookingStore,
  CommitBookingUseCase,
} from './commit-booking.use-case';

/** Captures the request the store is handed; the commit itself is not the point. */
function capturingStore() {
  const seen: DecideBookingRequest[] = [];
  const store: BookingStore = {
    async commit(request) {
      seen.push(request);
      return fail(new CommitBookingStoreError('not under test'));
    },
  };
  return { store, seen };
}

// Frozen: the placement is the point, and no spec reads the real time.
const clock = new FixedClock('2030-01-13T08:00:00.000+02:00');
const ids = { next: () => 'appt-1' };
const cart = { locationId: 'shop-1', seats: [] };

describe('CommitBookingUseCase — placement (R33)', () => {
  it('stamps a client’s own booking as self-placed', async () => {
    const { store, seen } = capturingStore();
    await new CommitBookingUseCase(store, clock, ids).execute({
      ...cart,
      ownerUserId: 'ana',
    });
    expect(seen[0]?.placement).toBe('self');
  });

  it('stamps the shop placing its own book as staff-placed, owner or not', async () => {
    const { store, seen } = capturingStore();
    const useCase = new CommitBookingUseCase(store, clock, ids);
    await useCase.execute({
      ...cart,
      ownerUserId: 'ana',
      staffPlacement: true,
    });
    await useCase.execute({ ...cart, ownerUserId: null, staffPlacement: true });
    expect(seen.map((request) => request.placement)).toEqual([
      'staff',
      'staff',
    ]);
  });

  it('never takes the placement from the caller', async () => {
    const { store, seen } = capturingStore();
    await new CommitBookingUseCase(store, clock, ids).execute({
      ...cart,
      ownerUserId: 'ana',
      placement: 'staff',
    });
    expect(seen[0]?.placement).toBe('self');
  });
});
