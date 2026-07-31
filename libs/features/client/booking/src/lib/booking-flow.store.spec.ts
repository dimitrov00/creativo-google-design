import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
  BOOKING_DRAFT_STORE,
  BOOKING_GATEWAY,
  BarberPref,
  type BookingGateway,
  BookingGatewayError,
  type CommitBookingRequest,
  type CommittedBooking,
  type Result,
  ScheduleSelection,
  TimeSlot,
  ZonedDateTime,
  fail,
  ok,
} from '@creativo/application/booking';
import { BarberId, LocationId, ServiceId } from '@creativo/application/catalog';
import { BookingFlowStore } from './booking-flow.store';

const ZONE = 'Europe/Sofia';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) {
    throw new Error(`fixture setup failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

const at = (hour: number) =>
  unwrap(
    ZonedDateTime.fromParts(
      { year: 2026, month: 8, day: 3, hour, minute: 0 },
      ZONE,
    ),
  );

/** A gateway whose answer this spec chooses. */
class StubGateway implements BookingGateway {
  answer: Result<CommittedBooking, BookingGatewayError> = ok({
    appointmentId: 'appt-1',
  });
  calls: CommitBookingRequest[] = [];

  async commit(
    request: CommitBookingRequest,
  ): Promise<Result<CommittedBooking, BookingGatewayError>> {
    this.calls.push(request);
    return this.answer;
  }
}

/** `sessionStorage` is not worth doubling here — the flow is what's under test. */
const NULL_DRAFT_STORE = {
  load: () => ok(null),
  save: () => ok(undefined),
  clear: () => ok(undefined),
};

function createStore(gateway: StubGateway): BookingFlowStore {
  TestBed.configureTestingModule({
    providers: [
      { provide: BOOKING_DRAFT_STORE, useValue: NULL_DRAFT_STORE },
      { provide: BOOKING_GATEWAY, useValue: gateway },
      BookingFlowStore,
    ],
  });
  return TestBed.inject(BookingFlowStore);
}

/**
 * Walk a store to `review` the way a person does: a guest, a line each, a day,
 * a time. Anything shorter would be testing a state nobody can reach.
 */
function walkToReview(store: BookingFlowStore): ScheduleSelection {
  // Step 1 is WHERE, and it is optional — this walk takes the explicit shop.
  store.selectLocation(unwrap(LocationId.create('loc-center')));
  store.next();

  store.addGuest('Maria');
  store.next();

  store.addLine(
    { kind: 'self' },
    {
      serviceId: unwrap(ServiceId.create('svc-fade')),
      variantId: null,
      barberPref: BarberPref.any(),
    },
  );
  store.next();

  store.selectDay('2026-08-03');
  store.selectStart(at(12).toMillis(), 'loc-center');

  const lineId = store.cartLineId(
    store.cart()?.entries()[0]?.[1][0]?.id.value ?? '',
  );
  const selection: ScheduleSelection = {
    locationId: unwrap(LocationId.create('loc-center')),
    timeSlot: unwrap(TimeSlot.of(at(12), at(13))),
    assignments: [
      {
        lineId: lineId as NonNullable<typeof lineId>,
        barberId: unwrap(BarberId.create('ivan')),
        slot: unwrap(TimeSlot.of(at(12), at(13))),
      },
    ],
  };
  store.selectSchedule(selection);
  return selection;
}

describe('BookingFlowStore — commit', () => {
  let gateway: StubGateway;
  let store: BookingFlowStore;

  beforeEach(() => {
    gateway = new StubGateway();
    store = createStore(gateway);
  });

  it('sends WHAT and WHO, and never a price or a duration', async () => {
    walkToReview(store);
    await store.commit();

    const [request] = gateway.calls;
    expect(request?.seats).toHaveLength(1);
    // Read as a loose bag on purpose: the assertion is that these keys do
    // not EXIST on the wire, which the typed shape cannot express.
    const seat = request?.seats[0] as unknown as Record<string, unknown>;
    // The server resolves terms. A client that could name its own price
    // would book a 40 € fade for nothing.
    expect(seat['priceMinorUnits']).toBeUndefined();
    expect(seat['durationMinutes']).toBeUndefined();
    expect(seat['barberId']).toBe('ivan');
    expect(seat['subject']).toEqual({ kind: 'self' });
  });

  it('lands on `confirmed` with the server’s appointment id', async () => {
    walkToReview(store);
    await store.commit();

    expect(store.step()).toBe('confirmed');
    expect(store.confirmation()?.appointmentId).toBe('appt-1');
  });

  it('bounces BACK to the schedule when the slot was taken — keeping the day', async () => {
    // The one recoverable failure. The user should land on a fresh grid on
    // the day they already chose, not at the start of the wizard.
    walkToReview(store);
    gateway.answer = fail(new BookingGatewayError('slot_unavailable', 'gone'));

    await store.commit();

    expect(store.step()).toBe('schedule');
    expect(store.slotTaken()).toBe(true);
    expect(store.selectedDayKey()).toBe('2026-08-03');
    // …but NOT the time it can no longer honour.
    expect(store.selectedStartMs()).toBeNull();
    // The bag and the party survive — nothing about a lost race invalidates them.
    expect(store.lineCount()).toBe(1);
    expect(store.guests()).toHaveLength(1);
  });

  it('STAYS on review for a failure re-picking a time cannot fix', async () => {
    walkToReview(store);
    gateway.answer = fail(
      new BookingGatewayError('catalog_changed', 'service withdrawn'),
    );

    await store.commit();

    expect(store.step()).toBe('review');
    expect(store.slotTaken()).toBe(false);
    expect(store.error()).not.toBeNull();
  });

  it('refuses to double-submit while a commit is in flight', async () => {
    walkToReview(store);
    const first = store.commit();
    const second = store.commit();
    await Promise.all([first, second]);

    expect(gateway.calls).toHaveLength(1);
  });

  it('does nothing at all outside the review step', async () => {
    await store.commit();

    expect(gateway.calls).toHaveLength(0);
    expect(store.step()).toBe('location');
  });

  it('REFUSES the same service twice for one person', () => {
    // You cannot have two haircuts in one visit; the party is what makes a
    // second haircut expressible, and it belongs to a different seat.
    store.selectLocation(null);
    store.next();
    store.addGuest('Maria');
    store.next();

    const cut = {
      serviceId: unwrap(ServiceId.create('svc-fade')),
      variantId: null,
      barberPref: BarberPref.any(),
    };
    store.addLine({ kind: 'self' }, cut);
    store.addLine({ kind: 'self' }, cut);
    expect(store.lineCount()).toBe(1);

    // …but the SAME service for the guest is the ordinary case.
    store.addLine({ kind: 'guest', guestId: store.guests()[0]!.id }, cut);
    expect(store.lineCount()).toBe(2);
  });

  it('treats "any shop" as an answer — the first step never blocks', () => {
    // `null` is a choice, not an absence, so `next` has no precondition to fail.
    store.selectLocation(null);
    store.next();

    expect(store.step()).toBe('services');
    expect(store.locationId()).toBeNull();
  });
});
