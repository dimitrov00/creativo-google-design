import type { SeatKeyText } from '@core/primitives';
import type { CartLine } from './cart-line.data';

/**
 * One seat's lines, in the order they were added — an element of
 * `BookingCart.cartSeats` (split out of `cart-line.data.ts`, pass D D-7).
 */
export type CartSeatLines = {
  readonly seatKey: SeatKeyText;
  readonly lines: readonly CartLine[];
};
