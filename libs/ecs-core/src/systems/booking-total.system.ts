import {
  type SeatAssignment,
  type BookingCart,
  type CartLine,
  type CartSeatLines,
  Money,
} from '@core/components';
import type { Service } from '@core/entities';
import type { CartLineId, SeatKeyText, ServiceId } from '@core/primitives';
import { OfferingPriceSystem } from './offering-price.system';

/** One seat's subtotal on the review — `null` when its lines span two currencies. */
export type SeatSubtotal = {
  readonly seatKey: SeatKeyText;
  readonly total: Money | null;
};

/** The cart line an assignment places, with its seat. */
function lineOf(
  cart: BookingCart,
  lineId: CartLineId,
): { readonly seatKey: SeatKeyText; readonly line: CartLine } | null {
  for (let s = 0; s < cart.cartSeats.length; s++) {
    const seat = cart.cartSeats[s] as CartSeatLines;
    for (let l = 0; l < seat.lines.length; l++) {
      const line = seat.lines[l] as CartLine;
      if (line.lineId === lineId) return { seatKey: seat.seatKey, line };
    }
  }
  return null;
}

function serviceOf(
  services: readonly Service[],
  serviceId: ServiceId,
): Service | null {
  for (let i = 0; i < services.length; i++) {
    const service = services[i] as Service;
    if (service.id === serviceId) return service;
  }
  return null;
}

/** The price the server will charge for this assignment, or `null` when its line or service is gone. */
function priceOf(
  assignment: SeatAssignment,
  cart: BookingCart,
  services: readonly Service[],
): { readonly seatKey: SeatKeyText; readonly price: Money } | null {
  const found = lineOf(cart, assignment.lineId);
  if (found === null) return null;
  const service = serviceOf(services, found.line.serviceId);
  if (service === null) return null;
  return {
    seatKey: found.seatKey,
    price: OfferingPriceSystem.price(
      service,
      assignment.barberId,
      found.line.variantId,
    ),
  };
}

/**
 * BookingTotalSystem — what the review says it comes to
 * (`booking-review-step.ts:470-530,631-662`): each line priced at
 * `termsFor(the barber who actually got it)` — the same resolution the server
 * will redo, so the total and its parts cannot disagree and a summary never
 * quotes the catalogue base while the server charges the barber's rate.
 * Nothing is charged here (money is deferred, owner ruling 2026-07-29); the
 * `Money` returned is the arithmetic value struct (F-14), never stored.
 */
export const BookingTotalSystem = {
  /**
   * The whole booking. Lines whose cart line or service is gone are skipped;
   * mixed currencies are a data error the aggregate also refuses, and a
   * partial total would be worse than none: `null`. `null` too for nothing
   * priced.
   */
  total(
    assignments: readonly SeatAssignment[],
    cart: BookingCart,
    services: readonly Service[],
  ): Money | null {
    let total: Money | null = null;
    for (let i = 0; i < assignments.length; i++) {
      const priced = priceOf(assignments[i] as SeatAssignment, cart, services);
      if (priced === null) continue;
      if (total === null) {
        total = priced.price;
        continue;
      }
      const sum = Money.add(total, priced.price);
      if (!sum.ok) return null;
      total = sum.value;
    }
    return total;
  },

  /**
   * Per seat, in the order seats first appear among the assignments: its
   * lines' sum, `null` once a currency breaks it (the seat's subtotal
   * vanishes rather than lying; the others stand).
   */
  seatSubtotals(
    assignments: readonly SeatAssignment[],
    cart: BookingCart,
    services: readonly Service[],
  ): readonly SeatSubtotal[] {
    const seatKeys: SeatKeyText[] = [];
    const totals: (Money | null)[] = [];
    const broken: boolean[] = [];
    for (let i = 0; i < assignments.length; i++) {
      const priced = priceOf(assignments[i] as SeatAssignment, cart, services);
      if (priced === null) continue;
      let at = seatKeys.indexOf(priced.seatKey);
      if (at < 0) {
        at = seatKeys.length;
        seatKeys.push(priced.seatKey);
        totals.push(null);
        broken.push(false);
      }
      if (broken[at] === true) continue;
      const current = totals[at] ?? null;
      if (current === null) {
        totals[at] = priced.price;
        continue;
      }
      const sum = Money.add(current, priced.price);
      if (sum.ok) {
        totals[at] = sum.value;
      } else {
        totals[at] = null;
        broken[at] = true;
      }
    }
    const out: SeatSubtotal[] = [];
    for (let i = 0; i < seatKeys.length; i++) {
      out.push({
        seatKey: seatKeys[i] as SeatKeyText,
        total: totals[i] ?? null,
      });
    }
    return out;
  },
} as const;
