import { describe, expect, it } from 'vitest';
import {
  AppointmentId,
  BarberId,
  CartLineId,
  LocationId,
  ServiceId,
  WaitlistRequestId,
} from '@core/primitives';
import { endMinute, localDate, minute, unwrapOk } from '@core/testing';
import { BookingCart } from './booking-cart.data';
import { BookingFlowState, BookingFlowStep } from './booking-flow.data';
import { FlexibleWhen } from './flexible-when.data';
import { Party } from './party.data';
import { ScheduleSelection } from './schedule-selection.data';
import type { SeatAssignment } from './seat-assignment.data';
import { SeatKey } from './seat-key.data';

/** 09:00 — every assignment below is measured from it, on the one shop day. */
const T0 = 9 * 60;
const DAY = localDate('2026-10-07');
const CENTER = LocationId.of('loc-center');
const SELF = SeatKey.text(SeatKey.self());

const assignment = (
  lineId: string,
  startMinute: number,
  minutes: number,
): SeatAssignment => ({
  lineId: CartLineId.of(lineId),
  barberId: BarberId.of('ivan'),
  startMinutes: minute(T0 + startMinute),
  endMinutes: endMinute(T0 + startMinute + minutes),
});

function cartWithACut(): BookingCart {
  return unwrapOk(
    BookingCart.addLine(BookingCart.empty(), SELF, {
      serviceId: ServiceId.of('svc-cut'),
      variantId: null,
      barberId: null,
      locationId: null,
    }),
  );
}

function selection(): ScheduleSelection {
  const built = ScheduleSelection.of(CENTER, DAY, [
    assignment('line-0', 0, 30),
    assignment('line-1', 30, 45),
  ]);
  if (built === null) throw new Error('bad fixture');
  return built;
}

describe('BookingFlowStep', () => {
  it('are SCREAMING tags', () => {
    expect(Object.values(BookingFlowStep)).toEqual([
      'LOCATION',
      'SERVICES',
      'SCHEDULE',
      'REVIEW',
      'CONFIRMED',
      'WAITLISTED',
    ]);
  });
});

describe('BookingFlowState', () => {
  it('opens on the location step with an empty bag and any shop', () => {
    const party = Party.anonymous();
    expect(BookingFlowState.initial(party)).toEqual({
      bookingFlowStep: 'LOCATION',
      party,
      cart: { cartSeats: [], cartNextSequence: 0 },
      locationId: null,
    });
  });

  it('walks the spine and knows its two terminal exits', () => {
    expect(BookingFlowState.SPINE).toEqual([
      'LOCATION',
      'SERVICES',
      'SCHEDULE',
      'REVIEW',
    ]);
    expect(BookingFlowState.spineIndex(BookingFlowStep.Schedule)).toBe(2);
    expect(BookingFlowState.spineIndex(BookingFlowStep.Confirmed)).toBe(-1);
    const party = Party.anonymous();
    expect(BookingFlowState.isTerminal(BookingFlowState.initial(party))).toBe(
      false,
    );
    const confirmed: BookingFlowState = {
      bookingFlowStep: BookingFlowStep.Confirmed,
      confirmation: {
        appointmentId: AppointmentId.of('appt-1'),
        party,
        cart: cartWithACut(),
        selection: selection(),
      },
    };
    expect(BookingFlowState.isTerminal(confirmed)).toBe(true);
  });

  it('isTerminal narrows to the two terminal states — their bags are readable', () => {
    const party = Party.anonymous();
    const states: readonly BookingFlowState[] = [
      BookingFlowState.initial(party),
      {
        bookingFlowStep: BookingFlowStep.Confirmed,
        confirmation: {
          appointmentId: AppointmentId.of('appt-1'),
          party,
          cart: cartWithACut(),
          selection: selection(),
        },
      },
    ];
    const receipts: string[] = [];
    for (const state of states) {
      if (!BookingFlowState.isTerminal(state)) continue;
      receipts.push(
        state.bookingFlowStep === BookingFlowStep.Confirmed
          ? state.confirmation.appointmentId
          : state.summary.requestId,
      );
    }
    expect(receipts).toEqual(['appt-1']);
  });

  it('isTerminalStep is the one rule: the two steps off the spine, and only them', () => {
    for (const step of Object.values(BookingFlowStep)) {
      expect(BookingFlowState.isTerminalStep(step)).toBe(
        BookingFlowState.spineIndex(step) === -1,
      );
    }
    expect(
      Object.values(BookingFlowStep).filter((step) =>
        BookingFlowState.isTerminalStep(step),
      ),
    ).toEqual(['CONFIRMED', 'WAITLISTED']);
  });
});

describe('BookingFlowState.is — a stale draft fails and is cleared', () => {
  const party = Party.anonymous();
  const cart = cartWithACut();
  const when = unwrapOk(
    FlexibleWhen.withDay(FlexibleWhen.empty(), localDate('2026-10-08'), 7),
  );

  const states: readonly BookingFlowState[] = [
    BookingFlowState.initial(party),
    {
      bookingFlowStep: BookingFlowStep.Services,
      party,
      cart,
      locationId: CENTER,
    },
    {
      bookingFlowStep: BookingFlowStep.Schedule,
      party,
      cart,
      locationId: null,
      when,
    },
    {
      bookingFlowStep: BookingFlowStep.Review,
      party,
      cart,
      selection: selection(),
    },
    {
      bookingFlowStep: BookingFlowStep.Confirmed,
      confirmation: {
        appointmentId: AppointmentId.of('appt-1'),
        party,
        cart,
        selection: selection(),
      },
    },
    {
      bookingFlowStep: BookingFlowStep.Waitlisted,
      summary: {
        requestId: WaitlistRequestId.of('wl_abc'),
        party,
        cart,
        when,
        locationId: null,
      },
    },
  ];

  it.each(states.map((state) => [state.bookingFlowStep, state] as const))(
    'takes a %s state, serialised as is',
    (_step, state) => {
      expect(BookingFlowState.is(JSON.parse(JSON.stringify(state)))).toBe(true);
    },
  );

  const envelope = {
    locationId: 'loc',
    localDate: '2026-10-07',
    startMinutes: 1,
    endMinutes: 2,
  };

  it.each([
    null,
    'LOCATION',
    { bookingFlowStep: 'CHECKOUT' },
    { bookingFlowStep: 'LOCATION', party, cart, locationId: 7 },
    { bookingFlowStep: 'SERVICES', party: {}, cart, locationId: null },
    {
      bookingFlowStep: 'SERVICES',
      party,
      cart: { cartSeats: [] },
      locationId: null,
    },
    { bookingFlowStep: 'SCHEDULE', party, cart, locationId: null },
    {
      bookingFlowStep: 'SCHEDULE',
      party,
      cart,
      locationId: null,
      when: { flexibleDays: 'x' },
    },
    {
      bookingFlowStep: 'REVIEW',
      party,
      cart,
      selection: { locationId: 'loc', assignments: [] },
    },
    {
      bookingFlowStep: 'REVIEW',
      party,
      cart,
      selection: {
        ...envelope,
        startMinutes: 2,
        endMinutes: 1,
        assignments: [],
      },
    },
    {
      bookingFlowStep: 'REVIEW',
      party,
      cart,
      selection: {
        ...envelope,
        assignments: [{ lineId: 'line-0', barberId: '' }],
      },
    },
    {
      bookingFlowStep: 'REVIEW',
      party,
      cart,
      selection: { ...envelope, assignments: [null] },
    },
    { bookingFlowStep: 'CONFIRMED', confirmation: null },
    {
      bookingFlowStep: 'CONFIRMED',
      confirmation: { appointmentId: '', party, cart },
    },
    { bookingFlowStep: 'WAITLISTED', summary: 'x' },
    {
      bookingFlowStep: 'WAITLISTED',
      summary: { requestId: 'wl_1', party, cart, when, locationId: 3 },
    },
    // A pre-flatten draft — the `kind` tag of the old shape — is stale.
    { kind: 'location', party, cart, locationId: null },
  ])('refuses %j', (raw) => {
    expect(BookingFlowState.is(raw)).toBe(false);
  });
});
