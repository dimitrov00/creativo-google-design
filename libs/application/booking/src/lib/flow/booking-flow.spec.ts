import { describe, expect, it } from 'vitest';
import { Result } from '@creativo/domain/kernel';
import { BookingParty, GuestId, TimeSlot } from '@creativo/domain/scheduling';
import { BarberId, LocationId, ServiceId } from '@creativo/domain/catalog';
import {
  BookingFlowState,
  advanceBookingFlow,
  initialBookingFlowState,
} from './booking-flow';

function requiredValue<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

function newParty(): BookingParty {
  return requiredValue(BookingParty.create({ ownerId: 'owner_1' }));
}

function guestsState(): Extract<BookingFlowState, { kind: 'guests' }> {
  return initialBookingFlowState(newParty()) as Extract<
    BookingFlowState,
    { kind: 'guests' }
  >;
}

describe('BookingFlow', () => {
  it('starts on the guests step with an empty party', () => {
    const state = initialBookingFlowState(newParty());
    expect(state.kind).toBe('guests');
    if (state.kind === 'guests') {
      expect(state.party.guests).toHaveLength(0);
    }
  });

  it('adds a guest and stays on the guests step', () => {
    const result = advanceBookingFlow(guestsState(), {
      type: 'add_guest',
      label: 'Alex',
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess() && result.value.kind === 'guests') {
      expect(result.value.party.guests).toHaveLength(1);
      expect(result.value.party.guests[0]?.id.toString()).toBe('guest-0');
    }
  });

  // Ports v2's own documented `booking.machine.ts` regression comment
  // (migration-blueprint.md §7.7): a removed guest's id must never be
  // resurrected by a later add — GuestId only ever mints from
  // BookingParty's monotonic sequence counter, never array length/index.
  it('never reuses a removed guest id (§7.7 regression)', () => {
    let state = guestsState();

    const addA = advanceBookingFlow(state, {
      type: 'add_guest',
      label: 'Guest A',
    });
    if (addA.isFailure() || addA.value.kind !== 'guests')
      throw new Error('unexpected');
    state = addA.value;
    const guestA = state.party.guests[0];
    if (!guestA) throw new Error('unexpected');
    expect(guestA.id.toString()).toBe('guest-0');

    const addB = advanceBookingFlow(state, {
      type: 'add_guest',
      label: 'Guest B',
    });
    if (addB.isFailure() || addB.value.kind !== 'guests')
      throw new Error('unexpected');
    state = addB.value;

    const removeA = advanceBookingFlow(state, {
      type: 'remove_guest',
      guestId: guestA.id,
    });
    if (removeA.isFailure() || removeA.value.kind !== 'guests')
      throw new Error('unexpected');
    state = removeA.value;
    expect(state.party.guests).toHaveLength(1);

    const addC = advanceBookingFlow(state, {
      type: 'add_guest',
      label: 'Guest C',
    });
    if (addC.isFailure() || addC.value.kind !== 'guests')
      throw new Error('unexpected');
    state = addC.value;

    const ids = state.party.guests.map((g) => g.id.toString());
    expect(ids).toContain('guest-1'); // Guest B, unaffected by the removal
    expect(ids).toContain('guest-2'); // Guest C — NOT "guest-0" (that would be resurrection)
    expect(ids).not.toContain(guestA.id.toString());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('removing an unknown guest id fails without mutating the party', () => {
    const state = guestsState();
    const neverAddedGuestId = GuestId.fromSequence(999);

    const result = advanceBookingFlow(state, {
      type: 'remove_guest',
      guestId: neverAddedGuestId,
    });

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toEqual({
        kind: 'guest_not_found',
        guestId: neverAddedGuestId.toString(),
      });
    }
  });

  it('rejects advancing past services with none selected', () => {
    const toServices = advanceBookingFlow(guestsState(), { type: 'next' });
    if (toServices.isFailure()) throw new Error('unexpected');
    const result = advanceBookingFlow(toServices.value, { type: 'next' });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toEqual({ kind: 'empty_services' });
    }
  });

  it('walks guests -> services -> schedule -> review', () => {
    const serviceId = requiredValue(ServiceId.create('service_1'));
    const barberId = requiredValue(BarberId.create('barber_1'));
    const locationId = requiredValue(LocationId.create('location_1'));
    const timeSlot = requiredValue(
      TimeSlot.create({
        startIso: '2026-06-01T10:00:00.000+03:00',
        endIso: '2026-06-01T10:30:00.000+03:00',
        zone: 'Europe/Sofia',
      }),
    );

    const toServices = advanceBookingFlow(guestsState(), { type: 'next' });
    if (toServices.isFailure() || toServices.value.kind !== 'services')
      throw new Error('unexpected');

    const withService = advanceBookingFlow(toServices.value, {
      type: 'toggle_service',
      serviceId,
    });
    if (withService.isFailure() || withService.value.kind !== 'services')
      throw new Error('unexpected');

    const toSchedule = advanceBookingFlow(withService.value, { type: 'next' });
    if (toSchedule.isFailure() || toSchedule.value.kind !== 'schedule')
      throw new Error('unexpected');

    const toReview = advanceBookingFlow(toSchedule.value, {
      type: 'select_schedule',
      barberId,
      locationId,
      timeSlot,
    });
    expect(toReview.isSuccess()).toBe(true);
    if (toReview.isSuccess()) {
      expect(toReview.value.kind).toBe('review');
    }
  });

  it('rejects an event illegal for the current state', () => {
    const result = advanceBookingFlow(guestsState(), {
      type: 'toggle_service',
      serviceId: requiredValue(ServiceId.create('service_1')),
    });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toEqual({
        kind: 'invalid_transition',
        from: 'guests',
        event: 'toggle_service',
      });
    }
  });
});
