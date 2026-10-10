import { describe, expect, it } from 'vitest';
import { AppointmentId } from '../entities/appointment.entity';
import { BarberId } from '../entities/barber.entity';
import { LocationId } from '../entities/location.entity';
import { ServiceId } from '../entities/service.entity';
import { WaitlistRequestId } from '../entities/waitlist-request.entity';
import {
  BookingFlowState,
  BookingFlowStep,
  MoveRefusal,
  MoveRefusalKind,
  ScheduleSelection,
  ShopReach,
  type SeatAssignment,
} from './booking-flow.data';
import { BookingCart } from './cart-line.data';
import { DayKey } from './day-key.data';
import { FlexibleWhen } from './flexible-when.data';
import { Party } from './party.data';
import { TimeInterval } from './time-interval.data';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 7, 7, 0);
const CENTER = LocationId.of('loc-center');

const assignment = (
  lineId: string,
  startMinute: number,
  minutes: number,
): SeatAssignment => ({
  lineId,
  barberId: BarberId.of('ivan'),
  timeInterval: TimeInterval.of(
    T0 + startMinute * MIN,
    T0 + (startMinute + minutes) * MIN,
  ),
});

function cartWithACut(): BookingCart {
  const result = BookingCart.addLine(BookingCart.empty(), 'self', {
    serviceId: ServiceId.of('svc-cut'),
    variantId: null,
    barberId: null,
    locationId: null,
  });
  if (!result.ok) throw new Error('bad fixture');
  return result.value;
}

function selection(): ScheduleSelection {
  const built = ScheduleSelection.of(CENTER, [
    assignment('line-0', 0, 30),
    assignment('line-1', 30, 45),
  ]);
  if (built === null) throw new Error('bad fixture');
  return built;
}

describe('BookingFlowStep / MoveRefusalKind', () => {
  it('keep the stored strings', () => {
    expect(Object.values(BookingFlowStep)).toEqual([
      'location',
      'services',
      'schedule',
      'review',
      'confirmed',
      'waitlisted',
    ]);
    expect(Object.values(MoveRefusalKind)).toEqual([
      'companions_only',
      'unavailable',
      'carried_out_of_reach',
    ]);
    expect(MoveRefusal.of(MoveRefusalKind.Unavailable, null)).toEqual({
      reason: 'unavailable',
      locationId: null,
    });
  });
});

describe('ShopReach — the shopReachKey values', () => {
  it('calls when there is a number to press, and says get in touch otherwise', () => {
    expect(ShopReach.forCallHref('tel:+359888000000')).toBe(
      'booking.reach.call',
    );
    expect(ShopReach.forCallHref(null)).toBe('booking.reach.contact');
    expect([ShopReach.Call, ShopReach.Contact]).toEqual([
      'booking.reach.call',
      'booking.reach.contact',
    ]);
  });
});

describe('ScheduleSelection', () => {
  it('derives the envelope from the assignments — first start to last end', () => {
    expect(selection().timeInterval).toEqual({
      startMs: T0,
      endMs: T0 + 75 * MIN,
    });
    const parallel = ScheduleSelection.of(CENTER, [
      assignment('line-0', 0, 30),
      assignment('line-1', 0, 60),
    ]);
    expect(parallel?.timeInterval).toEqual({
      startMs: T0,
      endMs: T0 + 60 * MIN,
    });
  });

  it('describes no appointment without an assignment', () => {
    expect(ScheduleSelection.of(CENTER, [])).toBeNull();
  });
});

describe('BookingFlowState', () => {
  it('opens on the location step with an empty bag and any shop', () => {
    const party = Party.anonymous();
    expect(BookingFlowState.initial(party)).toEqual({
      kind: 'location',
      party,
      cart: { seats: [], nextSequence: 0 },
      locationId: null,
    });
  });

  it('walks the spine and knows its two terminal exits', () => {
    expect(BookingFlowState.SPINE).toEqual([
      'location',
      'services',
      'schedule',
      'review',
    ]);
    expect(BookingFlowState.spineIndex(BookingFlowStep.Schedule)).toBe(2);
    expect(BookingFlowState.spineIndex(BookingFlowStep.Confirmed)).toBe(-1);
    const party = Party.anonymous();
    expect(BookingFlowState.isTerminal(BookingFlowState.initial(party))).toBe(
      false,
    );
    const confirmed: BookingFlowState = {
      kind: BookingFlowStep.Confirmed,
      confirmation: {
        appointmentId: AppointmentId.of('appt-1'),
        party,
        cart: cartWithACut(),
        selection: selection(),
      },
    };
    expect(BookingFlowState.isTerminal(confirmed)).toBe(true);
  });
});

describe('BookingFlowState.is — a stale draft fails and is cleared', () => {
  const party = Party.anonymous();
  const cart = cartWithACut();
  const whenResult = FlexibleWhen.withDay(
    FlexibleWhen.empty(),
    DayKey.of('2026-10-08'),
    7,
  );
  if (!whenResult.ok) throw new Error('bad fixture');
  const when = whenResult.value;

  const states: readonly BookingFlowState[] = [
    BookingFlowState.initial(party),
    { kind: BookingFlowStep.Services, party, cart, locationId: CENTER },
    { kind: BookingFlowStep.Schedule, party, cart, locationId: null, when },
    { kind: BookingFlowStep.Review, party, cart, selection: selection() },
    {
      kind: BookingFlowStep.Confirmed,
      confirmation: {
        appointmentId: AppointmentId.of('appt-1'),
        party,
        cart,
        selection: selection(),
      },
    },
    {
      kind: BookingFlowStep.Waitlisted,
      summary: {
        requestId: WaitlistRequestId.of('wl_abc'),
        party,
        cart,
        when,
        locationId: null,
      },
    },
  ];

  it.each(states.map((state) => [state.kind, state] as const))(
    'takes a %s state, serialised as is',
    (_kind, state) => {
      expect(BookingFlowState.is(JSON.parse(JSON.stringify(state)))).toBe(true);
    },
  );

  it.each([
    null,
    'location',
    { kind: 'checkout' },
    { kind: 'location', party, cart, locationId: 7 },
    { kind: 'services', party: {}, cart, locationId: null },
    { kind: 'services', party, cart: { seats: [] }, locationId: null },
    { kind: 'schedule', party, cart, locationId: null },
    { kind: 'schedule', party, cart, locationId: null, when: { days: 'x' } },
    {
      kind: 'review',
      party,
      cart,
      selection: { locationId: 'loc', assignments: [] },
    },
    {
      kind: 'review',
      party,
      cart,
      selection: {
        locationId: 'loc',
        timeInterval: { startMs: 2, endMs: 1 },
        assignments: [],
      },
    },
    {
      kind: 'review',
      party,
      cart,
      selection: {
        locationId: 'loc',
        timeInterval: { startMs: 1, endMs: 2 },
        assignments: [{ lineId: 'line-0', barberId: '' }],
      },
    },
    {
      kind: 'review',
      party,
      cart,
      selection: {
        locationId: 'loc',
        timeInterval: { startMs: 1, endMs: 2 },
        assignments: [null],
      },
    },
    { kind: 'confirmed', confirmation: null },
    { kind: 'confirmed', confirmation: { appointmentId: '', party, cart } },
    { kind: 'waitlisted', summary: 'x' },
    {
      kind: 'waitlisted',
      summary: { requestId: 'wl_1', party, cart, when, locationId: 3 },
    },
  ])('refuses %j', (raw) => {
    expect(BookingFlowState.is(raw)).toBe(false);
  });
});
