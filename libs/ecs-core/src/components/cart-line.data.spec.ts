import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BarberId,
  CartLineId,
  GuestId,
  LocationId,
  type SeatKeyText,
  ServiceId,
  ServiceVariantId,
  UserId,
} from '../primitives/ids.primitive';
import { BookingCart, SeatKey, SeatKeyRole } from './cart-line.data';

const SELF = SeatKey.text(SeatKey.self());
const GUEST = SeatKey.text(SeatKey.guest(GuestId.of('guest-0')));
const IVAN = BarberId.of('ivan');
const STEFAN = BarberId.of('stefan');
const ANA = BarberId.of('ana');

const line = (
  service: string,
  barberId: BarberId | null = null,
): BookingCart.NewLine => ({
  serviceId: ServiceId.of(service),
  variantId: null,
  barberId,
  locationId: null,
});
const CUT = line('svc-cut');
const BEARD = line('svc-beard');

function added(
  cart: BookingCart,
  seatKey: SeatKeyText,
  newLine: BookingCart.NewLine,
): BookingCart {
  const result = BookingCart.addLine(cart, seatKey, newLine);
  if (!result.ok) throw new Error('bad fixture');
  return result.value;
}

const firstLineId = (cart: BookingCart, seatKey: SeatKeyText): CartLineId => {
  const first = BookingCart.linesFor(cart, seatKey)[0];
  if (first === undefined) throw new Error('bad fixture');
  return first.lineId;
};

describe('SeatKey — the cart’s key for a seat', () => {
  it('distinguishes the booker from every guest and companion — the text form is unchanged', () => {
    expect(SELF).toBe('self');
    expect(GUEST).toBe('guest-0');
    expect(SeatKey.text(SeatKey.guest(GuestId.of('guest-1')))).toBe('guest-1');
    expect(SeatKey.text(SeatKey.companion(UserId.of('u1')))).toBe(
      'companion-u1',
    );
  });

  it('parses its own text back, and nothing else', () => {
    for (const key of [
      SeatKey.self(),
      SeatKey.guest(GuestId.of('guest-3')),
      SeatKey.companion(UserId.of('u1')),
    ]) {
      expect(SeatKey.parse(SeatKey.text(key))).toEqual(key);
    }
    for (const raw of ['', 'Self', 'guest-', 'companion-', 'guest3']) {
      expect(SeatKey.parse(raw)).toBeNull();
    }
    expect(SeatKey.self().seatKeyRole).toBe(SeatKeyRole.Self);
    expect(SeatKey.companion(UserId.of('u1'))).toEqual({
      seatKeyRole: 'COMPANION',
      companionUserId: 'u1',
    });
  });

  it('compares by value', () => {
    expect(
      SeatKey.equals(
        SeatKey.guest(GuestId.of('guest-1')),
        SeatKey.guest(GuestId.of('guest-1')),
      ),
    ).toBe(true);
    expect(
      SeatKey.equals(SeatKey.self(), SeatKey.guest(GuestId.of('guest-1'))),
    ).toBe(false);
  });
});

describe('BookingCart.addLine / removeLine', () => {
  it('starts empty and scopes lines to the seat that added them', () => {
    const cart = added(BookingCart.empty(), SELF, CUT);
    expect(BookingCart.isEmpty(cart)).toBe(false);
    expect(BookingCart.lineCount(cart)).toBe(1);
    expect(BookingCart.linesFor(cart, SELF)).toEqual([
      {
        lineId: 'line-0',
        seatKey: 'self',
        serviceId: 'svc-cut',
        variantId: null,
        barberId: null,
        locationId: null,
      },
    ]);
    expect(BookingCart.linesFor(cart, GUEST)).toHaveLength(0);
  });

  it('leaves the original cart untouched (every mutation returns a new cart)', () => {
    const empty = BookingCart.empty();
    BookingCart.addLine(empty, SELF, CUT);
    expect(BookingCart.isEmpty(empty)).toBe(true);
  });

  it('REFUSES the same service twice for one person', () => {
    const cart = added(BookingCart.empty(), SELF, CUT);
    expect(BookingCart.addLine(cart, SELF, CUT)).toEqual({
      ok: false,
      error: {
        errorCode: 'SCHEDULING_BOOKING_CART_DUPLICATE_SERVICE',
        seatKey: 'self',
        serviceId: 'svc-cut',
      },
    });
    expect(BookingCart.hasService(cart, SELF, ServiceId.of('svc-cut'))).toBe(
      true,
    );
    expect(BookingCart.hasService(cart, GUEST, ServiceId.of('svc-cut'))).toBe(
      false,
    );
  });

  it('lets one seat hold several DIFFERENT services, under distinct ids', () => {
    const cart = added(added(BookingCart.empty(), SELF, CUT), SELF, BEARD);
    expect(BookingCart.linesFor(cart, SELF).map((l) => l.lineId)).toEqual([
      'line-0',
      'line-1',
    ]);
  });

  it('lets the SAME service go to two different people', () => {
    const cart = added(added(BookingCart.empty(), SELF, CUT), GUEST, CUT);
    expect(BookingCart.linesFor(cart, SELF)).toHaveLength(1);
    expect(BookingCart.linesFor(cart, GUEST)).toHaveLength(1);
    expect(cart.cartSeats.map((seat) => seat.seatKey)).toEqual([
      'self',
      'guest-0',
    ]);
  });

  it('never reuses a line id after add → remove → add (§7.7 discipline)', () => {
    const cart = added(BookingCart.empty(), SELF, CUT);
    const firstId = firstLineId(cart, SELF);
    const removed = BookingCart.removeLine(cart, SELF, firstId);
    if (!removed.ok) throw new Error('bad fixture');
    expect(BookingCart.lineCount(removed.value)).toBe(0);
    const readded = added(removed.value, SELF, CUT);
    expect(firstLineId(readded, SELF)).not.toBe(firstId);
  });

  it('fails removing a line the seat does not hold — or another seat’s line', () => {
    const cart = added(BookingCart.empty(), SELF, CUT);
    expect(
      BookingCart.removeLine(cart, SELF, CartLineId.of('line-99')),
    ).toEqual({
      ok: false,
      error: {
        errorCode: 'SCHEDULING_BOOKING_CART_LINE_NOT_FOUND',
        seatKey: 'self',
        lineId: 'line-99',
      },
    });
    expect(
      BookingCart.removeLine(cart, GUEST, firstLineId(cart, SELF)).ok,
    ).toBe(false);
  });

  it('drops a seat entirely once its last line goes', () => {
    const cart = added(BookingCart.empty(), GUEST, CUT);
    const removed = BookingCart.removeLine(
      cart,
      GUEST,
      firstLineId(cart, GUEST),
    );
    if (!removed.ok) throw new Error('bad fixture');
    expect(removed.value.cartSeats).toHaveLength(0);
    expect(removed.value.cartNextSequence).toBe(1);
  });
});

describe('BookingCart.setVariant / setBarber', () => {
  it('re-points one line without disturbing its neighbours', () => {
    const cart = added(added(BookingCart.empty(), SELF, CUT), SELF, BEARD);
    const updated = BookingCart.setVariant(
      cart,
      SELF,
      CartLineId.of('line-0'),
      ServiceVariantId.of('long'),
    );
    if (!updated.ok) throw new Error('bad fixture');
    const [first, second] = BookingCart.linesFor(updated.value, SELF);
    expect(first?.variantId).toBe('long');
    expect(second?.variantId).toBeNull();
    expect(second?.lineId).toBe('line-1');
  });

  it('moves a line from "anyone" to a specific barber and back', () => {
    const cart = added(BookingCart.empty(), SELF, CUT);
    const pinned = BookingCart.setBarber(
      cart,
      SELF,
      CartLineId.of('line-0'),
      IVAN,
    );
    if (!pinned.ok) throw new Error('bad fixture');
    expect(BookingCart.linesFor(pinned.value, SELF)[0]?.barberId).toBe(IVAN);
    const loosened = BookingCart.setBarber(
      pinned.value,
      SELF,
      CartLineId.of('line-0'),
      null,
    );
    if (!loosened.ok) throw new Error('bad fixture');
    expect(BookingCart.linesFor(loosened.value, SELF)[0]?.barberId).toBeNull();
  });

  it('fails on an unknown line', () => {
    const cart = added(BookingCart.empty(), SELF, CUT);
    expect(
      BookingCart.setVariant(cart, SELF, CartLineId.of('line-99'), null).ok,
    ).toBe(false);
    expect(
      BookingCart.setBarber(cart, GUEST, CartLineId.of('line-0'), IVAN).ok,
    ).toBe(false);
  });
});

describe('BookingCart.dropSeat', () => {
  it('forgets a departing guest’s lines and leaves everyone else alone', () => {
    const cart = added(added(BookingCart.empty(), SELF, CUT), GUEST, CUT);
    const dropped = BookingCart.dropSeat(cart, GUEST);
    expect(BookingCart.linesFor(dropped, GUEST)).toHaveLength(0);
    expect(BookingCart.linesFor(dropped, SELF)).toHaveLength(1);
    expect(BookingCart.lineCount(dropped)).toBe(1);
  });

  it('is a no-op for a seat that holds nothing', () => {
    const cart = added(BookingCart.empty(), SELF, CUT);
    expect(BookingCart.dropSeat(cart, GUEST)).toBe(cart);
  });

  it('never rewinds the line counter — a re-added guest cannot inherit an id', () => {
    const cart = added(BookingCart.empty(), GUEST, CUT);
    const dropped = firstLineId(cart, GUEST);
    const readded = added(BookingCart.dropSeat(cart, GUEST), GUEST, CUT);
    expect(firstLineId(readded, GUEST)).not.toBe(dropped);
  });
});

describe('BookingCart.acceptedBarbers', () => {
  const POOL = [IVAN, STEFAN, ANA];

  it('narrows the pool to the barber a single pinned line wants', () => {
    const cart = added(BookingCart.empty(), SELF, line('svc-cut', STEFAN));
    expect(BookingCart.acceptedBarbers(cart, POOL)).toEqual([STEFAN]);
  });

  it('keeps every barber a party pins, in the pool’s order', () => {
    const cart = added(
      added(BookingCart.empty(), SELF, line('svc-cut', ANA)),
      GUEST,
      line('svc-cut', IVAN),
    );
    expect(BookingCart.acceptedBarbers(cart, POOL)).toEqual([IVAN, ANA]);
  });

  it('accepts the whole pool as soon as one line takes anyone', () => {
    const cart = added(
      added(BookingCart.empty(), SELF, line('svc-cut', ANA)),
      GUEST,
      CUT,
    );
    expect(BookingCart.acceptedBarbers(cart, POOL)).toEqual(POOL);
  });

  it('accepts nobody for an empty cart, and nobody outside the pool', () => {
    expect(BookingCart.acceptedBarbers(BookingCart.empty(), POOL)).toEqual([]);
    const cart = added(
      BookingCart.empty(),
      SELF,
      line('svc-cut', BarberId.of('zed')),
    );
    expect(BookingCart.acceptedBarbers(cart, POOL)).toEqual([]);
  });

  it('is exactly the pool barbers some line’s preference matches (property)', () => {
    const pin = fc.constantFrom<BarberId | null>(null, IVAN, STEFAN, ANA);
    fc.assert(
      fc.property(fc.array(pin, { maxLength: 6 }), (pins) => {
        let cart = BookingCart.empty();
        pins.forEach((barberId, index) => {
          cart = added(
            cart,
            SeatKey.text(SeatKey.guest(GuestId.of(`guest-${index}`))),
            line('svc-cut', barberId),
          );
        });
        const expected = POOL.filter((barber) =>
          pins.some((p) => p === null || p === barber),
        );
        expect(BookingCart.acceptedBarbers(cart, POOL)).toEqual(expected);
      }),
    );
  });
});

describe('BookingCart.is — the edge guard', () => {
  it('takes what the commands build, location and barber included', () => {
    const cart = added(
      added(BookingCart.empty(), SELF, {
        ...CUT,
        barberId: IVAN,
        locationId: LocationId.of('loc-center'),
        variantId: ServiceVariantId.of('long'),
      }),
      GUEST,
      BEARD,
    );
    expect(BookingCart.is(cart)).toBe(true);
    expect(BookingCart.is(BookingCart.empty())).toBe(true);
  });

  const good = {
    lineId: 'line-0',
    seatKey: 'self',
    serviceId: 'svc-cut',
    variantId: null,
    barberId: null,
    locationId: null,
  };

  it.each([
    null,
    { cartSeats: [], cartNextSequence: -1 },
    { cartSeats: [], cartNextSequence: 1.5 },
    { cartSeats: 'x', cartNextSequence: 0 },
    { cartSeats: [null], cartNextSequence: 1 },
    { cartSeats: [{ seatKey: 'self', lines: [] }], cartNextSequence: 1 },
    { cartSeats: [{ seatKey: '', lines: [good] }], cartNextSequence: 1 },
    {
      cartSeats: [
        { seatKey: 'self', lines: [good] },
        { seatKey: 'self', lines: [good] },
      ],
      cartNextSequence: 1,
    },
    { cartSeats: [{ seatKey: 'guest-0', lines: [good] }], cartNextSequence: 1 },
    {
      cartSeats: [{ seatKey: 'self', lines: [{ ...good, serviceId: '' }] }],
      cartNextSequence: 1,
    },
    {
      cartSeats: [{ seatKey: 'self', lines: [{ ...good, barberId: 7 }] }],
      cartNextSequence: 1,
    },
    {
      cartSeats: [
        { seatKey: 'self', lines: [{ id: 'line-0', serviceId: 'svc' }] },
      ],
      cartNextSequence: 1,
    },
    // The pre-flatten shape is a stale draft, not a cart.
    { seats: [], nextSequence: 0 },
  ])('refuses %j', (raw) => {
    expect(BookingCart.is(raw)).toBe(false);
  });
});
