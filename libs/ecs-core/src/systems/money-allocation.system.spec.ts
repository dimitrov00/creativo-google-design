import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type AppliedDiscount,
  Combinability,
  DiscountMethod,
  DiscountSource,
  Seat,
  SeatOutcome,
} from '@core/components';
import {
  AppliedDiscountId,
  BarberId,
  Currency,
  PriceCents,
  SeatId,
} from '@core/primitives';
import {
  FIXTURE_NOW_UTC_MS,
  appointmentFixture,
  deepFreeze,
  seatFixture,
  termsFixture,
} from '@core/testing';
import {
  MoneyAllocation,
  MoneyAllocationSystem,
  type SeatNet,
  type VisitNets,
} from './money-allocation.system';

const S = MoneyAllocationSystem;
const ivan = BarberId.of('b-ivan');
const niko = BarberId.of('b-niko');
const stamp = FIXTURE_NOW_UTC_MS;

const seat = (
  n: number,
  priceCents: number,
  outcome: SeatOutcome = SeatOutcome.worked(stamp),
  barberId: BarberId = ivan,
  currency: Currency = Currency.EUR,
  tipCents: number | null = null,
): Seat =>
  seatFixture({
    seatId: SeatId.of(`seat-${n}`),
    barberId,
    startMinutes: seatFixture().startMinutes,
    tipCents: tipCents === null ? null : (tipCents as PriceCents),
    terms: Seat.termsOf(termsFixture(priceCents, 30, 0, 0, currency), null),
    outcome,
  });

const discount = (
  value:
    { readonly percent: number } | { readonly amountCents: number } | 'free',
): AppliedDiscount =>
  ({
    discountId: AppliedDiscountId.of('manual'),
    label: 'Counter',
    appliedAtUtcMs: stamp,
    combinability: Combinability.Stackable,
    discountSource: DiscountSource.Manual,
    ...(value === 'free'
      ? { discountMethod: DiscountMethod.FreeService }
      : 'percent' in value
        ? {
            discountMethod: DiscountMethod.PercentOff,
            discountPercent: value.percent,
          }
        : {
            discountMethod: DiscountMethod.FixedAmount,
            discountAmountCents: value.amountCents,
            discountCurrency: Currency.EUR,
          }),
  }) as AppliedDiscount;

function netsOf(visit: VisitNets): readonly SeatNet[] {
  if (visit.moneyAllocation !== MoneyAllocation.Allocated) {
    throw new Error('expected an allocated bill');
  }
  return visit.nets;
}
const sum = (nets: readonly SeatNet[]): number =>
  nets.reduce((total, net) => total + net.netCents, 0);

describe('MoneyAllocationSystem.seatNets — the bill, shared out over its seats', () => {
  it('shares a percent discount in proportion to price', () => {
    const nets = netsOf(
      S.seatNets(
        appointmentFixture({
          seats: [seat(1, 1000), seat(2, 1000), seat(3, 1000)],
          discounts: [discount({ percent: 10 })],
        }),
      ),
    );
    expect(nets.map((net) => net.netCents)).toEqual([900, 900, 900]);
  });

  it('gives the odd cents to the largest remainders, so the nets sum to the total exactly', () => {
    // 3 × 10,00 € less 1 cent → 29,99 €: 999.67 each → 1000, 1000, 999.
    const nets = netsOf(
      S.seatNets(
        appointmentFixture({
          seats: [seat(1, 1000), seat(2, 1000), seat(3, 1000)],
          discounts: [discount({ amountCents: 1 })],
        }),
      ),
    );
    expect(nets.map((net) => net.netCents)).toEqual([1000, 1000, 999]);
    expect(sum(nets)).toBe(2999);
  });

  it('shares a fixed amount larger than one seat over the whole bill', () => {
    // 5,00 € + 30,00 €, 10,00 € off → 25,00 €: 357.14 and 2142.86.
    const nets = netsOf(
      S.seatNets(
        appointmentFixture({
          seats: [seat(1, 500), seat(2, 3000)],
          discounts: [discount({ amountCents: 1000 })],
        }),
      ),
    );
    expect(nets.map((net) => net.netCents)).toEqual([357, 2143]);
  });

  it('nets a free service to zero', () => {
    const nets = netsOf(
      S.seatNets(
        appointmentFixture({
          seats: [seat(1, 2800)],
          discounts: [discount('free')],
        }),
      ),
    );
    expect(sum(nets)).toBe(0);
  });

  it('keeps a no-show seat’s share, so the discount never moves onto the seat that was worked', () => {
    // Two 20,00 € seats, 10,00 € off, one a no-show: the worked seat took 15,00 €, not 10,00 €.
    const visit = appointmentFixture({
      seats: [seat(1, 2000), seat(2, 2000, SeatOutcome.noShow(stamp), niko)],
      discounts: [discount({ amountCents: 1000 })],
    });
    const nets = netsOf(S.seatNets(visit));
    expect(S.workedTakings(nets, ivan)).toBe(1500);
    expect(S.workedTakings(nets, niko)).toBe(0);
  });

  it('converts a leva bill to euro cents per seat, and the tip with it', () => {
    const nets = netsOf(
      S.seatNets(
        appointmentFixture({
          seats: [seat(1, 3912, undefined, ivan, Currency.BGN, 978)],
        }),
      ),
    );
    expect(nets[0]?.netCents).toBe(2000);
    expect(nets[0]?.tipCents).toBe(500);
  });

  it('records a missing tip as zero', () => {
    const nets = netsOf(
      S.seatNets(appointmentFixture({ seats: [seat(1, 2800)] })),
    );
    expect(nets[0]?.tipCents).toBe(0);
  });

  it('leaves a bill in a currency with no euro rate, or with no seats, not evaluated', () => {
    expect(
      S.seatNets(
        appointmentFixture({
          seats: [seat(1, 5000, undefined, ivan, Currency.USD)],
        }),
      ).moneyAllocation,
    ).toBe(MoneyAllocation.NotEvaluated);
    expect(S.seatNets(appointmentFixture({ seats: [] })).moneyAllocation).toBe(
      MoneyAllocation.NotEvaluated,
    );
  });

  it('agrees with the client card’s per-visit rounding to within one cent per worked seat (property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 20_000 }), fc.boolean()), {
          minLength: 1,
          maxLength: 6,
        }),
        fc.integer({ min: 0, max: 100 }),
        (raw, percent) => {
          const seats = raw.map(([price, worked], i) =>
            seat(
              i + 1,
              price,
              worked ? SeatOutcome.worked(stamp) : SeatOutcome.noShow(stamp),
            ),
          );
          const visit = appointmentFixture({
            seats,
            discounts: percent > 0 ? [discount({ percent })] : [],
          });
          const nets = netsOf(S.seatNets(visit));
          const subtotal = raw.reduce((t, [price]) => t + price, 0);
          const total = sum(nets);
          // The client card's rule (`ClientStatsSystem` moneyOf): one rounding per visit.
          let own = 0;
          let workedSeats = 0;
          for (const [price, worked] of raw) {
            if (worked) {
              own += price;
              workedSeats++;
            }
          }
          const card = subtotal > 0 ? Math.round((own * total) / subtotal) : 0;
          expect(
            Math.abs(S.workedTakings(nets, ivan) - card),
          ).toBeLessThanOrEqual(workedSeats);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const visit = deepFreeze(
      appointmentFixture({
        seats: [seat(1, 1000), seat(2, 1500)],
        discounts: [discount({ percent: 15 })],
      }),
    );
    expect(S.seatNets(visit)).toEqual(S.seatNets(visit));
  });
});
