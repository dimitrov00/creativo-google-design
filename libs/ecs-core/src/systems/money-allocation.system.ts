import {
  AttendanceState,
  PriceCents,
  defect,
  type BarberId,
} from '@core/primitives';
import type { Seat } from '@core/components';
import type { Appointment } from '@core/entities';
import { BillingSystem } from './billing.system';
import { ClientStatsSystem } from './client-stats.system';

/** Whether a visit's bill could be split into seat nets — the field `moneyAllocation`. */
export const MoneyAllocation = {
  /** The bill evaluated in a currency with a known euro rate; every seat has its net. */
  Allocated: 'ALLOCATED',
  /** No bill (no seats, mixed currencies) or a currency with no honest euro rate. */
  NotEvaluated: 'NOT_EVALUATED',
} as const;
export type MoneyAllocation =
  (typeof MoneyAllocation)[keyof typeof MoneyAllocation];

/** One seat's share of its visit's bill, in euro cents. */
export type SeatNet = Pick<
  Seat,
  'seatId' | 'barberId' | 'serviceId' | 'attendanceState'
> & {
  /** The seat's price after its share of the bill's discounts. */
  readonly netCents: PriceCents;
  /** The seat's tip; `0` when none was recorded. */
  readonly tipCents: PriceCents;
};

/** A visit's bill, split — or why it could not be. */
export type VisitNets =
  | {
      readonly moneyAllocation: typeof MoneyAllocation.Allocated;
      readonly nets: readonly SeatNet[];
    }
  | { readonly moneyAllocation: typeof MoneyAllocation.NotEvaluated };

/** The visit fields the split reads — an `Appointment` satisfies it as is. */
export type AllocatedVisit = Pick<Appointment, 'seats' | 'discounts'>;

const NOT_EVALUATED: VisitNets = {
  moneyAllocation: MoneyAllocation.NotEvaluated,
};

function cents(raw: number): PriceCents {
  const parsed = PriceCents.of(raw);
  if (!parsed.ok) return defect(`a seat net out of range (${raw})`);
  return parsed.value;
}

/**
 * THE BILL'S DISCOUNT, SPLIT ACROSS ITS SEATS (staff analytics, Takings). The
 * bill is `BillingSystem`'s — the seats' subtotal, its discounts applied —
 * and its total is shared out over every billed seat in proportion to the
 * seat's price, by largest remainder: each seat gets the floor of its exact
 * share, and the cents left over go one each to the seats with the largest
 * fractional parts (ties in seat order). The nets therefore sum to the
 * bill's total exactly. A no-show seat keeps its share — takings count only
 * worked seats, so a no-show never moves money onto the others.
 *
 * Vouchers are a way of paying, not a discount, and are not read. Amounts
 * convert to euro cents per seat (`ClientStatsSystem.inEuroCents`); a
 * currency with no honest euro rate leaves the visit not evaluated.
 *
 * The client card's lifetime spend rounds once per visit over the same
 * bill, so the two agree to within one cent per worked seat.
 */
export const MoneyAllocationSystem = {
  seatNets(visit: AllocatedVisit): VisitNets {
    const subtotal = BillingSystem.subtotalOf(visit.seats);
    if (!subtotal.ok) return NOT_EVALUATED;
    const total = BillingSystem.totalOf(subtotal.value, visit.discounts);
    const subtotalCents = subtotal.value.amountCents;
    const totalCents = total.amountCents;
    const currency = subtotal.value.currency;
    if (ClientStatsSystem.inEuroCents(0, currency) === null) {
      return NOT_EVALUATED;
    }

    const seats = visit.seats;
    const shares: number[] = [];
    const remainders: number[] = [];
    let allotted = 0;
    for (let i = 0; i < seats.length; i++) {
      const price = (seats[i] as Seat).priceCents;
      const exact =
        subtotalCents > 0 ? (price * totalCents) / subtotalCents : 0;
      const floor = Math.floor(exact);
      shares.push(floor);
      remainders.push(exact - floor);
      allotted += floor;
    }
    // The cents the floors left: one each to the largest remainders.
    let left = subtotalCents > 0 ? totalCents - allotted : 0;
    const order: number[] = [];
    for (let i = 0; i < seats.length; i++) order.push(i);
    order.sort(
      (a, b) => (remainders[b] as number) - (remainders[a] as number) || a - b,
    );
    for (let k = 0; k < order.length && left > 0; k++) {
      const i = order[k] as number;
      shares[i] = (shares[i] as number) + 1;
      left--;
    }

    const nets: SeatNet[] = [];
    for (let i = 0; i < seats.length; i++) {
      const seat = seats[i] as Seat;
      nets.push({
        seatId: seat.seatId,
        barberId: seat.barberId,
        serviceId: seat.serviceId,
        attendanceState: seat.attendanceState,
        netCents: cents(
          ClientStatsSystem.inEuroCents(shares[i] as number, currency) ?? 0,
        ),
        tipCents: cents(
          seat.tipCents === null
            ? 0
            : (ClientStatsSystem.inEuroCents(seat.tipCents, seat.currency) ??
                0),
        ),
      });
    }
    return { moneyAllocation: MoneyAllocation.Allocated, nets };
  },

  /** The worked seats' nets of one barber, summed — that barber's takings from a visit. */
  workedTakings(nets: readonly SeatNet[], barberId: BarberId): PriceCents {
    let sum = PriceCents.ZERO;
    for (let i = 0; i < nets.length; i++) {
      const net = nets[i] as SeatNet;
      if (
        net.barberId === barberId &&
        net.attendanceState === AttendanceState.Worked
      ) {
        sum = PriceCents.add(sum, net.netCents);
      }
    }
    return sum;
  },
} as const;
