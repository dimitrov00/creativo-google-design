import { describe, expect, it } from 'vitest';
import type { SeatAssignment } from '../components/booking-flow.data';
import type { BookingCart, CartLine } from '../components/cart-line.data';
import { Money } from '../components/money.data';
import { Currency } from '../primitives/currency.primitive';
import {
  BarberId,
  CartLineId,
  SeatKeyText,
  ServiceId,
  ServiceVariantId,
} from '../primitives/ids.primitive';
import {
  deepFreeze,
  endMinute,
  minute,
  textFixture,
  unwrapOk,
} from '../testing';
import { serviceFixture, termsFixture } from '../testing/booking-core.fixtures';
import { BookingTotalSystem } from './booking-total.system';

/*
 * The review's totals (booking-review-step.ts:470-530, 631-662): every line
 * priced at `termsFor(the barber who actually got it)`, so the total and its
 * parts cannot disagree; a vanished line or service is skipped; mixed
 * currencies leave no total rather than a partial one.
 */

const ivan = BarberId.of('ivan');
const niko = BarberId.of('niko');
const long = ServiceVariantId.of('long');

const cut = serviceFixture({
  id: ServiceId.of('svc-cut'),
  ...termsFixture(1500, 30),
  variants: [{ variantId: long, name: textFixture('Long') }],
  offerings: [
    {
      barberId: ivan,
      ...termsFixture(1450, 35),
      overrides: [{ variantId: long, ...termsFixture(1850, 50) }],
    },
    { barberId: niko, ...termsFixture(1300, 30), overrides: [] },
  ],
});
const beard = serviceFixture({
  id: ServiceId.of('svc-beard'),
  ...termsFixture(1000, 20),
  offerings: [],
});
const levaShave = serviceFixture({
  id: ServiceId.of('svc-shave'),
  ...termsFixture(900, 20, 0, 0, Currency.BGN),
  offerings: [],
});

const line = (
  lineId: string,
  seatKey: string,
  serviceId: string,
  variantId: ServiceVariantId | null = null,
): CartLine => ({
  lineId: CartLineId.of(lineId),
  seatKey: SeatKeyText.of(seatKey),
  serviceId: ServiceId.of(serviceId),
  variantId,
  barberId: null,
  locationId: null,
});

const cart: BookingCart = {
  cartSeats: [
    {
      seatKey: SeatKeyText.of('guest-1'),
      lines: [line('line-0', 'guest-1', 'svc-cut', long)],
    },
    {
      seatKey: SeatKeyText.of('self'),
      lines: [
        line('line-1', 'self', 'svc-cut'),
        line('line-2', 'self', 'svc-beard'),
      ],
    },
  ],
  cartNextSequence: 3,
};

const assign = (lineId: string, barberId: BarberId): SeatAssignment => ({
  lineId: CartLineId.of(lineId),
  barberId,
  startMinutes: minute(0),
  endMinutes: endMinute(1),
});

const S = BookingTotalSystem;
const eur = (amountCents: number): Money =>
  unwrapOk(Money.of(amountCents, 'EUR'));

describe('BookingTotalSystem.total — what it comes to', () => {
  it('prices each line at the barber who actually got it', () => {
    expect(
      S.total(
        [
          assign('line-0', ivan),
          assign('line-1', niko),
          assign('line-2', niko),
        ],
        cart,
        [cut, beard],
      ),
    ).toEqual(eur(1850 + 1300 + 1000));
  });

  it('skips a line whose cart line or service is gone, and has no total for nothing', () => {
    expect(
      S.total([assign('line-9', ivan), assign('line-1', ivan)], cart, [cut]),
    ).toEqual(eur(1450));
    expect(S.total([assign('line-2', ivan)], cart, [cut])).toBeNull();
  });

  it('shows no total rather than a partial one across currencies', () => {
    expect(
      S.total([assign('line-1', ivan), assign('line-2', ivan)], cart, [
        cut,
        { ...levaShave, id: ServiceId.of('svc-beard') },
      ]),
    ).toBeNull();
  });
});

describe('BookingTotalSystem.seatSubtotals — each seat’s run', () => {
  it('sums per seat, in the order the seats first appear', () => {
    expect(
      S.seatSubtotals(
        [
          assign('line-1', ivan),
          assign('line-0', ivan),
          assign('line-2', ivan),
        ],
        cart,
        [cut, beard],
      ),
    ).toEqual([
      { seatKey: 'self', total: eur(1450 + 1000) },
      { seatKey: 'guest-1', total: eur(1850) },
    ]);
  });

  it('drops only the broken seat’s subtotal', () => {
    expect(
      S.seatSubtotals(
        [
          assign('line-1', ivan),
          assign('line-2', ivan),
          assign('line-0', ivan),
        ],
        cart,
        [cut, { ...levaShave, id: ServiceId.of('svc-beard') }],
      ),
    ).toEqual([
      { seatKey: 'self', total: null },
      { seatKey: 'guest-1', total: eur(1850) },
    ]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const frozenCart = deepFreeze(cart);
    const services = deepFreeze([cut, beard]);
    const assignments = deepFreeze([
      assign('line-0', ivan),
      assign('line-2', niko),
    ]);
    expect(S.total(assignments, frozenCart, services)).toEqual(
      S.total(assignments, frozenCart, services),
    );
    expect(S.seatSubtotals(assignments, frozenCart, services)).toEqual(
      S.seatSubtotals(assignments, frozenCart, services),
    );
    expect(frozenCart.cartNextSequence).toBe(3);
  });
});
