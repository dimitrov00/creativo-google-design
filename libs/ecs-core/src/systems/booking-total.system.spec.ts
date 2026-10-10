import { describe, expect, it } from 'vitest';
import type { SeatAssignment } from '../components/booking-flow.data';
import type { BookingCart } from '../components/cart-line.data';
import {
  ServiceTerms,
  ServiceVariantId,
} from '../components/service-terms.data';
import { TimeInterval } from '../components/time-interval.data';
import { BarberId } from '../entities/barber.entity';
import { ServiceId } from '../entities/service.entity';
import { deepFreeze, serviceFixture, textFixture } from '../testing';
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
  baseTerms: ServiceTerms.unpadded(1500, 'EUR', 30),
  variants: [{ id: long, name: textFixture('Long') }],
  offerings: [
    {
      barberId: ivan,
      base: ServiceTerms.unpadded(1450, 'EUR', 35),
      overrides: [
        { variantId: long, terms: ServiceTerms.unpadded(1850, 'EUR', 50) },
      ],
    },
    {
      barberId: niko,
      base: ServiceTerms.unpadded(1300, 'EUR', 30),
      overrides: [],
    },
  ],
});
const beard = serviceFixture({
  id: ServiceId.of('svc-beard'),
  baseTerms: ServiceTerms.unpadded(1000, 'EUR', 20),
  offerings: [],
});
const levaShave = serviceFixture({
  id: ServiceId.of('svc-shave'),
  baseTerms: ServiceTerms.unpadded(900, 'BGN', 20),
  offerings: [],
});

const line = (
  lineId: string,
  seatKey: string,
  serviceId: string,
  variantId: ServiceVariantId | null = null,
) => ({
  lineId,
  seatKey,
  serviceId: ServiceId.of(serviceId),
  variantId,
  barberId: null,
  locationId: null,
});

const cart: BookingCart = {
  seats: [
    {
      seatKey: 'guest-1',
      lines: [line('line-0', 'guest-1', 'svc-cut', long)],
    },
    {
      seatKey: 'self',
      lines: [
        line('line-1', 'self', 'svc-cut'),
        line('line-2', 'self', 'svc-beard'),
      ],
    },
  ],
  nextSequence: 3,
};

const assign = (lineId: string, barberId: BarberId): SeatAssignment => ({
  lineId,
  barberId,
  timeInterval: TimeInterval.of(0, 1),
});

const S = BookingTotalSystem;
const eur = (amountMinorUnits: number) => ({
  amountMinorUnits,
  currencyCode: 'EUR',
});

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
    expect(frozenCart.nextSequence).toBe(3);
  });
});
