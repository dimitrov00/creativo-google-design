import { describe, expect, it } from 'vitest';
import { Result } from '@creativo/domain/kernel';
import {
  BarberPref,
  BookingParty,
  GuestId,
  NewCartLine,
  SeatKey,
  TimeSlot,
} from '@creativo/domain/scheduling';
import { BarberId, LocationId, ServiceId } from '@creativo/domain/catalog';
import {
  BookingFlowState,
  MAX_PARTY_SIZE,
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

/**
 * The services step, reached the way a person reaches it: through WHERE.
 *
 * Step 1 is optional, so this takes the "any shop" default — the cases below
 * are about the party and the bag, not about the shop. The party is assembled
 * on THIS step now; there is no screen of its own for it.
 */
function guestsState(): Extract<BookingFlowState, { kind: 'services' }> {
  const advanced = advanceBookingFlow(initialBookingFlowState(newParty()), {
    type: 'next',
  });
  if (advanced.isFailure() || advanced.value.kind !== 'services') {
    throw new Error('unexpected');
  }
  return advanced.value;
}

const CUT: NewCartLine = {
  serviceId: requiredValue(ServiceId.create('service_1')),
  variantId: null,
  barberPref: BarberPref.any(),
};

/** Walks to `services` with one line in the bag for `self`. */
function servicesStateWithOneLine(): Extract<
  BookingFlowState,
  { kind: 'services' }
> {
  const withLine = advanceBookingFlow(guestsState(), {
    type: 'add_line',
    seatKey: SeatKey.self(),
    line: CUT,
  });
  if (withLine.isFailure() || withLine.value.kind !== 'services') {
    throw new Error('unexpected');
  }
  return withLine.value;
}

describe('BookingFlow', () => {
  it('starts on WHERE, with any shop, an empty party and an empty cart', () => {
    // Location is step 1 because it changes everything after it: which barbers
    // exist, which services are offered, which hours apply.
    const state = initialBookingFlowState(newParty());
    expect(state.kind).toBe('location');
    if (state.kind === 'location') {
      expect(state.locationId).toBeNull();
      expect(state.party.guests).toHaveLength(0);
      expect(state.cart.isEmpty()).toBe(true);
    }
  });

  it('advances off WHERE without a shop — "any shop" IS the answer', () => {
    // No precondition to fail: `null` is a choice, not an absence, so the step
    // never blocks. That is what makes it genuinely optional rather than a
    // required question with a bypass.
    const advanced = advanceBookingFlow(initialBookingFlowState(newParty()), {
      type: 'next',
    });
    expect(advanced.isSuccess()).toBe(true);
    if (advanced.isSuccess() && advanced.value.kind === 'services') {
      expect(advanced.value.locationId).toBeNull();
    }
  });

  it('carries the chosen shop all the way to the schedule', () => {
    const locationId = requiredValue(LocationId.create('loc-center'));
    let state: BookingFlowState = initialBookingFlowState(newParty());

    for (const event of [
      { type: 'select_location', locationId } as const,
      { type: 'next' } as const,
      { type: 'add_line', seatKey: SeatKey.self(), line: CUT } as const,
      { type: 'next' } as const,
    ]) {
      const result = advanceBookingFlow(state, event);
      if (result.isFailure()) {
        throw new Error(`unexpected: ${JSON.stringify(result.error)}`);
      }
      state = result.value;
    }

    expect(state.kind).toBe('schedule');
    if (state.kind === 'schedule') {
      expect(state.locationId?.equals(locationId)).toBe(true);
    }
  });

  it('starts anonymous when no party is supplied', () => {
    const state = initialBookingFlowState();
    expect(state.kind).toBe('location');
    if (state.kind === 'location') {
      expect(state.party.isClaimed()).toBe(false);
    }
  });

  it('adds a guest and stays on the services step', () => {
    const result = advanceBookingFlow(guestsState(), {
      type: 'add_guest',
      label: 'Alex',
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess() && result.value.kind === 'services') {
      expect(result.value.party.guests).toHaveLength(1);
      expect(result.value.party.guests[0]?.id.toString()).toBe('guest-0');
    }
  });

  it('renames a guest without changing their identity', () => {
    const added = advanceBookingFlow(guestsState(), {
      type: 'add_guest',
      label: 'Guest 2',
    });
    if (added.isFailure() || added.value.kind !== 'services') {
      throw new Error('unexpected');
    }
    const guestId = added.value.party.guests[0]!.id;

    const renamed = advanceBookingFlow(added.value, {
      type: 'rename_guest',
      guestId,
      label: 'Maria',
    });
    expect(renamed.isSuccess()).toBe(true);
    if (renamed.isSuccess() && renamed.value.kind === 'services') {
      expect(renamed.value.party.guests[0]!.label.value).toBe('Maria');
      expect(renamed.value.party.guests[0]!.id.equals(guestId)).toBe(true);
    }
  });

  it('rejects a blank rename with a translatable code', () => {
    const added = advanceBookingFlow(guestsState(), {
      type: 'add_guest',
      label: 'Guest 2',
    });
    if (added.isFailure() || added.value.kind !== 'services') {
      throw new Error('unexpected');
    }
    const result = advanceBookingFlow(added.value, {
      type: 'rename_guest',
      guestId: added.value.party.guests[0]!.id,
      label: '   ',
    });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.code).toBe('booking.flow.invalid_guest');
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
    if (addA.isFailure() || addA.value.kind !== 'services')
      throw new Error('unexpected');
    state = addA.value;
    const guestA = state.party.guests[0];
    if (!guestA) throw new Error('unexpected');
    expect(guestA.id.toString()).toBe('guest-0');

    const addB = advanceBookingFlow(state, {
      type: 'add_guest',
      label: 'Guest B',
    });
    if (addB.isFailure() || addB.value.kind !== 'services')
      throw new Error('unexpected');
    state = addB.value;

    const removeA = advanceBookingFlow(state, {
      type: 'remove_guest',
      guestId: guestA.id,
    });
    if (removeA.isFailure() || removeA.value.kind !== 'services')
      throw new Error('unexpected');
    state = removeA.value;
    expect(state.party.guests).toHaveLength(1);

    const addC = advanceBookingFlow(state, {
      type: 'add_guest',
      label: 'Guest C',
    });
    if (addC.isFailure() || addC.value.kind !== 'services')
      throw new Error('unexpected');
    state = addC.value;

    const ids = state.party.guests.map((g) => g.id.toString());
    expect(ids).toContain('guest-1'); // Guest B, unaffected by the removal
    expect(ids).toContain('guest-2'); // Guest C — NOT "guest-0" (that would be resurrection)
    expect(ids).not.toContain(guestA.id.toString());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('refuses a guest past the party cap — the rule lives here, not in a template', () => {
    let state: BookingFlowState = guestsState();
    // The booker occupies one seat, so MAX - 1 guests fill the party.
    for (let i = 0; i < MAX_PARTY_SIZE - 1; i++) {
      const result = advanceBookingFlow(state, {
        type: 'add_guest',
        label: `Guest ${i}`,
      });
      if (result.isFailure()) throw new Error('unexpected');
      state = result.value;
    }

    const overflow = advanceBookingFlow(state, {
      type: 'add_guest',
      label: 'One too many',
    });
    expect(overflow.isFailure()).toBe(true);
    if (overflow.isFailure()) {
      expect(overflow.error.code).toBe('booking.flow.party_full');
      expect(overflow.error.params['max']).toBe(MAX_PARTY_SIZE);
    }
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
      expect(result.error.code).toBe('booking.flow.guest_not_found');
      expect(result.error.params['guestId']).toBe(neverAddedGuestId.toString());
    }
  });

  it('drops a departing guest’s cart lines with them', () => {
    const services = servicesStateWithOneLine();
    const added = advanceBookingFlow(services, {
      type: 'add_guest',
      label: 'Maria',
    });
    if (added.isFailure() || added.value.kind !== 'services') {
      throw new Error('unexpected');
    }
    const guestId = added.value.party.guests[0]!.id;

    const withGuestLine = advanceBookingFlow(added.value, {
      type: 'add_line',
      seatKey: SeatKey.guest(guestId),
      line: CUT,
    });
    if (withGuestLine.isFailure() || withGuestLine.value.kind !== 'services') {
      throw new Error('unexpected');
    }
    expect(withGuestLine.value.cart.lineCount()).toBe(2);

    const removed = advanceBookingFlow(withGuestLine.value, {
      type: 'remove_guest',
      guestId,
    });
    if (removed.isFailure() || removed.value.kind !== 'services') {
      throw new Error('unexpected');
    }
    // The booker's own line survives; the guest's leaves with the guest, so
    // no line can point at a seat nobody occupies.
    expect(removed.value.cart.lineCount()).toBe(1);
    expect(removed.value.cart.linesFor(SeatKey.self())).toHaveLength(1);
  });

  it('lets a guest be added from the SERVICES step without losing the bag', () => {
    const services = servicesStateWithOneLine();
    const result = advanceBookingFlow(services, {
      type: 'add_guest',
      label: 'Maria',
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess() && result.value.kind === 'services') {
      expect(result.value.party.guests).toHaveLength(1);
      expect(result.value.cart.lineCount()).toBe(1);
    }
  });

  it('re-points a line’s variant and barber preference', () => {
    const services = servicesStateWithOneLine();
    const lineId = services.cart.linesFor(SeatKey.self())[0]!.id;

    const pinned = advanceBookingFlow(services, {
      type: 'set_line_barber',
      seatKey: SeatKey.self(),
      lineId,
      barberPref: BarberPref.specific(requiredValue(BarberId.create('ivan'))),
    });
    expect(pinned.isSuccess()).toBe(true);
    if (pinned.isSuccess() && pinned.value.kind === 'services') {
      expect(
        pinned.value.cart.linesFor(SeatKey.self())[0]!.barberPref.kind,
      ).toBe('specific');
    }
  });

  it('rejects advancing past services with an empty bag', () => {
    const result = advanceBookingFlow(guestsState(), { type: 'next' });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.code).toBe('booking.flow.empty_cart');
    }
  });

  // A seat with no lines produces no assignment, so a guest left behind here
  // would disappear from the schedule, the review and the commit payload
  // without a single surface saying so. The bag being non-empty is not the
  // rule — everyone coming has to be booking something.
  it('refuses to leave services while a guest is booking nothing', () => {
    const withGuest = advanceBookingFlow(servicesStateWithOneLine(), {
      type: 'add_guest',
      label: 'Maria',
    });
    if (withGuest.isFailure()) throw new Error('unexpected');

    const result = advanceBookingFlow(withGuest.value, { type: 'next' });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.code).toBe('booking.flow.seat_without_service');
      // It NAMES the seat: a button that has to say whose turn it is cannot
      // work from "somebody is empty".
      expect(result.error.params['seatKey']).toBe('guest-0');
    }
  });

  it('refuses when the BOOKER is the empty one, guest or not', () => {
    const withGuest = advanceBookingFlow(guestsState(), {
      type: 'add_guest',
      label: 'Maria',
    });
    if (withGuest.isFailure() || withGuest.value.kind !== 'services') {
      throw new Error('unexpected');
    }
    // Only the guest is booking anything — the booker is along for the ride,
    // which is not a thing a booking can express.
    const guestOnly = advanceBookingFlow(withGuest.value, {
      type: 'add_line',
      seatKey: SeatKey.guest(withGuest.value.party.guests[0]!.id),
      line: CUT,
    });
    if (guestOnly.isFailure()) throw new Error('unexpected');

    const result = advanceBookingFlow(guestOnly.value, { type: 'next' });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.code).toBe('booking.flow.seat_without_service');
      expect(result.error.params['seatKey']).toBe('self');
    }
  });

  it('advances once every seat holds something', () => {
    const withGuest = advanceBookingFlow(servicesStateWithOneLine(), {
      type: 'add_guest',
      label: 'Maria',
    });
    if (withGuest.isFailure() || withGuest.value.kind !== 'services') {
      throw new Error('unexpected');
    }
    // The SAME service on another seat is legal — a second haircut is exactly
    // what the party exists to express (`BookingCart.addLine`).
    const both = advanceBookingFlow(withGuest.value, {
      type: 'add_line',
      seatKey: SeatKey.guest(withGuest.value.party.guests[0]!.id),
      line: CUT,
    });
    if (both.isFailure()) throw new Error('unexpected');

    const result = advanceBookingFlow(both.value, { type: 'next' });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) expect(result.value.kind).toBe('schedule');
  });

  // Removing the guest removes the reason to block — the rule is about people
  // in the party, so it has to answer to the party changing.
  it('unblocks when the empty guest leaves the party', () => {
    const withGuest = advanceBookingFlow(servicesStateWithOneLine(), {
      type: 'add_guest',
      label: 'Maria',
    });
    if (withGuest.isFailure() || withGuest.value.kind !== 'services') {
      throw new Error('unexpected');
    }
    const guestId = withGuest.value.party.guests[0]!.id;

    const removed = advanceBookingFlow(withGuest.value, {
      type: 'remove_guest',
      guestId,
    });
    if (removed.isFailure()) throw new Error('unexpected');

    const result = advanceBookingFlow(removed.value, { type: 'next' });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) expect(result.value.kind).toBe('schedule');
  });

  it('walks location -> services -> schedule -> review, carrying the cart', () => {
    const locationId = requiredValue(LocationId.create('location_1'));
    const timeSlot = requiredValue(
      TimeSlot.create({
        startIso: '2026-06-01T10:00:00.000+03:00',
        endIso: '2026-06-01T10:30:00.000+03:00',
        zone: 'Europe/Sofia',
      }),
    );

    const toSchedule = advanceBookingFlow(servicesStateWithOneLine(), {
      type: 'next',
    });
    if (toSchedule.isFailure() || toSchedule.value.kind !== 'schedule')
      throw new Error('unexpected');
    expect(toSchedule.value.cart.lineCount()).toBe(1);

    const toReview = advanceBookingFlow(toSchedule.value, {
      type: 'select_schedule',
      selection: { locationId, timeSlot, assignments: [] },
    });
    expect(toReview.isSuccess()).toBe(true);
    if (toReview.isSuccess() && toReview.value.kind === 'review') {
      expect(toReview.value.cart.lineCount()).toBe(1);
      expect(toReview.value.selection.locationId.equals(locationId)).toBe(true);
    }
  });

  it('keeps the chosen location when stepping back from review', () => {
    const locationId = requiredValue(LocationId.create('location_1'));
    const timeSlot = requiredValue(
      TimeSlot.create({
        startIso: '2026-06-01T10:00:00.000+03:00',
        endIso: '2026-06-01T10:30:00.000+03:00',
        zone: 'Europe/Sofia',
      }),
    );
    const toSchedule = advanceBookingFlow(servicesStateWithOneLine(), {
      type: 'next',
    });
    if (toSchedule.isFailure()) throw new Error('unexpected');
    const toReview = advanceBookingFlow(toSchedule.value, {
      type: 'select_schedule',
      selection: { locationId, timeSlot, assignments: [] },
    });
    if (toReview.isFailure()) throw new Error('unexpected');

    const back = advanceBookingFlow(toReview.value, { type: 'back' });
    expect(back.isSuccess()).toBe(true);
    if (back.isSuccess() && back.value.kind === 'schedule') {
      expect(back.value.locationId?.equals(locationId)).toBe(true);
    }
  });

  it('rejects an event illegal for the current state', () => {
    const result = advanceBookingFlow(guestsState(), {
      type: 'select_location',
      locationId: requiredValue(LocationId.create('location_1')),
    });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.code).toBe('booking.flow.invalid_transition');
      expect(result.error.params).toMatchObject({
        from: 'services',
        event: 'select_location',
      });
    }
  });
});
