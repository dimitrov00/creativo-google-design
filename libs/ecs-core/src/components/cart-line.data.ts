import type {
  BarberId,
  CartLineId,
  LocationId,
  SeatKeyText,
  ServiceId,
  ServiceVariantId,
} from '@core/primitives';

/**
 * One thing one person is booking (`booking-cart.ts:82`) — an element of a
 * {@link CartSeatLines}: a service, the variant chosen within it (`null`
 * only when the service declares none) and who they would like to perform it
 * — `barberId: null` is "anyone" (`BarberPref.fromBarberId`). `locationId` is
 * the shop the line was picked for, `null` for "any shop" (the flow's and the
 * request's own `locationId` governs where it is searched). Terms are
 * deliberately ABSENT: a price depends on the barber the engine assigns; a
 * snapshot reaches the seat only at commit.
 *
 * `lineId` is minted from the cart's monotonic counter
 * (`CartLineId.forSequence`, `line-<n>`) — never from a position, so
 * add → remove → add never resurrects an id (§7.7).
 */
export type CartLine = {
  readonly lineId: CartLineId;
  readonly seatKey: SeatKeyText;
  readonly serviceId: ServiceId;
  readonly variantId: ServiceVariantId | null;
  readonly barberId: BarberId | null;
  readonly locationId: LocationId | null;
};
