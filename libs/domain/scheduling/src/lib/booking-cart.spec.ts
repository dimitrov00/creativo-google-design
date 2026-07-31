import { describe, expect, it } from 'vitest';
import {
  BarberId,
  ServiceId,
  ServiceVariantId,
} from '@creativo/domain/catalog';
import { BarberPref } from './barber-pref';
import { BookingCart, CartLineId, SeatKey, seatKeyValue } from './booking-cart';
import { GuestId } from './ids';

const SELF = SeatKey.self();
const GUEST = SeatKey.guest(GuestId.fromSequence(0));

function serviceId(raw: string): ServiceId {
  const result = ServiceId.create(raw);
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

function variantId(raw: string): ServiceVariantId {
  const result = ServiceVariantId.create(raw);
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

function barberId(raw: string): BarberId {
  const result = BarberId.create(raw);
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

const CUT = {
  serviceId: serviceId('svc-classic-cut'),
  variantId: null,
  barberPref: BarberPref.any(),
};

/** A SECOND, different service — one seat may hold several, just not twins. */
const BEARD = {
  serviceId: serviceId('svc-beard'),
  variantId: null,
  barberPref: BarberPref.any(),
};

/** `addLine` returns a Result now; these fixtures know their input is legal. */
function added(
  cart: BookingCart,
  key: Parameters<BookingCart['addLine']>[0],
  line: Parameters<BookingCart['addLine']>[1],
): BookingCart {
  const result = cart.addLine(key, line);
  if (result.isFailure()) {
    throw new Error(`bad fixture: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

describe('seatKeyValue', () => {
  it('distinguishes the booker from every guest', () => {
    expect(seatKeyValue(SELF)).toBe('self');
    expect(seatKeyValue(GUEST)).toBe('guest-0');
    expect(seatKeyValue(SeatKey.guest(GuestId.fromSequence(1)))).toBe(
      'guest-1',
    );
  });
});

describe('BookingCart.addLine / removeLine', () => {
  it('starts empty and scopes lines to the seat that added them', () => {
    const cart = added(BookingCart.empty(), SELF, CUT);

    expect(cart.isEmpty()).toBe(false);
    expect(cart.lineCount()).toBe(1);
    expect(cart.linesFor(SELF)).toHaveLength(1);
    expect(cart.linesFor(GUEST)).toHaveLength(0);
  });

  it('leaves the original cart untouched (every mutation returns a new cart)', () => {
    const empty = BookingCart.empty();
    empty.addLine(SELF, CUT);
    expect(empty.isEmpty()).toBe(true);
  });

  it('REFUSES the same service twice for one person', () => {
    // Nobody has two haircuts in one visit. The party is what makes a second
    // haircut expressible — it belongs to a different seat.
    const cart = added(BookingCart.empty(), SELF, CUT);
    const twice = cart.addLine(SELF, CUT);

    expect(twice.isFailure()).toBe(true);
    if (twice.isFailure()) {
      expect(twice.error.code).toBe(
        'scheduling.booking_cart.duplicate_service',
      );
    }
    expect(cart.linesFor(SELF)).toHaveLength(1);
  });

  it('lets one seat hold several DIFFERENT services', () => {
    const cart = added(added(BookingCart.empty(), SELF, CUT), SELF, BEARD);
    expect(cart.linesFor(SELF)).toHaveLength(2);
    const [first, second] = cart.linesFor(SELF);
    expect(first!.id.equals(second!.id)).toBe(false);
  });

  it('lets the SAME service go to two different people', () => {
    // A couple both having a haircut is the ordinary case, and the whole
    // reason a duplicate on one seat is a mistake rather than a limitation.
    const cart = added(added(BookingCart.empty(), SELF, CUT), GUEST, CUT);
    expect(cart.linesFor(SELF)).toHaveLength(1);
    expect(cart.linesFor(GUEST)).toHaveLength(1);
  });

  it('never reuses a line id after add → remove → add (§7.7 discipline)', () => {
    const cart = added(BookingCart.empty(), SELF, CUT);
    const firstId = cart.linesFor(SELF)[0]!.id;

    const removed = cart.removeLine(SELF, firstId);
    if (removed.isFailure()) throw new Error('bad fixture');
    expect(removed.value.lineCount()).toBe(0);

    const readded = added(removed.value, SELF, CUT);
    expect(readded.linesFor(SELF)[0]!.id.equals(firstId)).toBe(false);
  });

  it('fails removing a line the seat does not hold', () => {
    const cart = added(BookingCart.empty(), SELF, CUT);
    const result = cart.removeLine(SELF, CartLineId.fromSequence(99));
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.code).toBe('scheduling.booking_cart.line_not_found');
    }
  });

  it('fails removing another seat’s line rather than silently succeeding', () => {
    const cart = added(BookingCart.empty(), SELF, CUT);
    const selfLineId = cart.linesFor(SELF)[0]!.id;
    expect(cart.removeLine(GUEST, selfLineId).isFailure()).toBe(true);
  });

  it('drops a seat entirely from entries() once its last line goes', () => {
    const cart = added(BookingCart.empty(), GUEST, CUT);
    const removed = cart.removeLine(GUEST, cart.linesFor(GUEST)[0]!.id);
    if (removed.isFailure()) throw new Error('bad fixture');
    expect(removed.value.entries()).toHaveLength(0);
  });
});

describe('BookingCart.setVariant / setBarberPref', () => {
  it('re-points one line without disturbing its neighbours', () => {
    const cart = added(added(BookingCart.empty(), SELF, CUT), SELF, BEARD);
    const [first, second] = cart.linesFor(SELF);

    const updated = cart.setVariant(SELF, first!.id, variantId('long'));
    if (updated.isFailure()) throw new Error('bad fixture');

    const lines = updated.value.linesFor(SELF);
    expect(lines[0]!.variantId?.value).toBe('long');
    expect(lines[1]!.variantId).toBeNull();
    expect(lines[1]!.id.equals(second!.id)).toBe(true);
  });

  it('moves a line from "anyone" to a specific barber and back', () => {
    const cart = added(BookingCart.empty(), SELF, CUT);
    const lineId = cart.linesFor(SELF)[0]!.id;

    const pinned = cart.setBarberPref(
      SELF,
      lineId,
      BarberPref.specific(barberId('ivan')),
    );
    if (pinned.isFailure()) throw new Error('bad fixture');
    expect(pinned.value.linesFor(SELF)[0]!.barberPref.kind).toBe('specific');

    const loosened = pinned.value.setBarberPref(SELF, lineId, BarberPref.any());
    if (loosened.isFailure()) throw new Error('bad fixture');
    expect(loosened.value.linesFor(SELF)[0]!.barberPref.kind).toBe('any');
  });

  it('fails on an unknown line', () => {
    const cart = added(BookingCart.empty(), SELF, CUT);
    expect(
      cart.setVariant(SELF, CartLineId.fromSequence(99), null).isFailure(),
    ).toBe(true);
  });
});

describe('BookingCart.dropSeat', () => {
  it('forgets a departing guest’s lines and leaves everyone else alone', () => {
    const cart = added(added(BookingCart.empty(), SELF, CUT), GUEST, CUT);
    const dropped = cart.dropSeat(GUEST);

    expect(dropped.linesFor(GUEST)).toHaveLength(0);
    expect(dropped.linesFor(SELF)).toHaveLength(1);
    expect(dropped.lineCount()).toBe(1);
  });

  it('is a no-op for a seat that holds nothing', () => {
    const cart = added(BookingCart.empty(), SELF, CUT);
    expect(cart.dropSeat(GUEST)).toBe(cart);
  });

  it('never rewinds the line counter — a re-added guest cannot inherit an id', () => {
    const cart = added(BookingCart.empty(), GUEST, CUT);
    const droppedLineId = cart.linesFor(GUEST)[0]!.id;

    const readded = added(cart.dropSeat(GUEST), GUEST, CUT);
    expect(readded.linesFor(GUEST)[0]!.id.equals(droppedLineId)).toBe(false);
  });
});

describe('BookingCart.reconstitute', () => {
  it('round-trips lines, ids and the counter', () => {
    const original = added(
      added(BookingCart.empty(), SELF, {
        ...CUT,
        variantId: variantId('long'),
      }),
      GUEST,
      { ...CUT, barberPref: BarberPref.specific(barberId('ivan')) },
    );

    const restored = BookingCart.reconstitute({
      seats: original.entries().map(([seatKey, lines]) => ({
        seatKey,
        lines: lines.map((line) => ({
          id: line.id.value,
          serviceId: line.serviceId.value,
          variantId: line.variantId?.value ?? null,
          barberId: BarberPref.toBarberIdOrNull(line.barberPref)?.value ?? null,
        })),
      })),
      nextSequence: original.nextLineSequence,
    });
    if (restored.isFailure()) throw new Error('bad fixture');

    expect(restored.value.lineCount()).toBe(2);
    expect(restored.value.linesFor(SELF)[0]!.variantId?.value).toBe('long');
    expect(restored.value.linesFor(GUEST)[0]!.barberPref).toEqual(
      BarberPref.specific(barberId('ivan')),
    );
    // The restored cart must keep minting FORWARD of the persisted counter,
    // or a reload would resurrect an id the pre-reload session already used.
    const beforeIds = original
      .entries()
      .flatMap(([, lines]) => lines.map((l) => l.id.value));
    // A DIFFERENT service — `self` already holds the cut, and a duplicate is
    // refused now.
    const nextId = added(restored.value, SELF, BEARD).linesFor(SELF).at(-1)!.id;
    expect(beforeIds).not.toContain(nextId.value);
  });

  it('rejects a corrupt sequence counter rather than coercing it', () => {
    const result = BookingCart.reconstitute({ seats: [], nextSequence: -1 });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.code).toBe(
        'scheduling.booking_cart.invalid_line_sequence',
      );
    }
  });

  it('drops a malformed line but keeps the rest of the draft', () => {
    const result = BookingCart.reconstitute({
      seats: [
        {
          seatKey: 'self',
          lines: [
            { id: 'line-0', serviceId: '', variantId: null, barberId: null },
            {
              id: 'line-1',
              serviceId: 'svc-fade',
              variantId: null,
              barberId: null,
            },
          ],
        },
      ],
      nextSequence: 2,
    });
    if (result.isFailure()) throw new Error('bad fixture');

    expect(result.value.lineCount()).toBe(1);
    expect(result.value.linesFor(SELF)[0]!.serviceId.value).toBe('svc-fade');
  });
});
