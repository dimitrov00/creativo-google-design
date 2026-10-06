import { LocationId, Service, ServiceId } from '@creativo/domain/catalog';
import {
  type AvailabilityRider,
  BookingCart,
} from '@creativo/domain/scheduling';

/**
 * A seat a MOVE carries, as the grid asks about it: the engine's rider (its
 * barber, its distance from the party, the terms it was sold at) plus WHAT
 * it is, which the engine never needs and the shop does.
 *
 * The server decides a carried seat like any other, and that includes
 * `Service.servesLocation` (`decideBooking`): a companion's service the shop
 * a move goes to does not offer is refused as
 * `booking.reschedule.carried_seat_unplaceable` / `service_unavailable`.
 * Only the service says so, so the rider carries it, and `optionsForDay`
 * offers nothing at such a shop.
 *
 * Declared HERE, beside the shop rule that reads its `serviceId`, rather
 * than in the day query that consumes both: the rule is the lower module,
 * and `observe-availability.use-case.ts` imports it, never the other way
 * round.
 */
export interface MoveRider extends AvailabilityRider {
  readonly serviceId: ServiceId;
}

/**
 * Everything a visit asks a shop to offer: the service of every seat on it.
 *
 * Two kinds of seat, because the catalog can fail to know a service in two
 * different ways:
 * - a CART line whose service is not in the snapshot has already been
 *   dropped from the grid (`cartToAvailabilityLines`), so it asks nothing of
 *   a shop;
 * - a seat a move CARRIES cannot be dropped: the server carries it whatever
 *   the grid does, and refuses it when its service is retired
 *   (`service_unavailable`). So a carried service the catalog does not know
 *   is served nowhere.
 */
export interface PartyServices {
  readonly lineServiceIds: readonly ServiceId[];
  readonly riderServiceIds: readonly ServiceId[];
}

/** The services a cart and the seats a move carries ask a shop for. */
export function partyServicesOf(
  cart: BookingCart,
  riders: readonly MoveRider[] = [],
): PartyServices {
  return {
    lineServiceIds: cart
      .entries()
      .flatMap(([, lines]) => lines.map((line) => line.serviceId)),
    riderServiceIds: riders.map((rider) => rider.serviceId),
  };
}

/**
 * The shops, of `locationIds`, that can serve the whole party, in the order
 * given.
 *
 * THE rule, the one `decideBooking` refuses a seat by: every seat's service
 * must `servesLocation` the shop (an empty `locationIds` on a service is
 * every shop), the cart's and a move's carried ones alike. A shop the party
 * fails is refused at the write, as `service_not_at_location` for the cart
 * and as `carried_seat_unplaceable` / `service_unavailable` for a carried
 * seat.
 *
 * One implementation for everybody who asks:
 * - the grid runs the engine only at these shops (`optionsForDay`), so it
 *   never offers a time the server refuses for a service;
 * - the schedule step asks it of the active shops, so a shop the party
 *   cannot be served at is SAID, with the way to one that can, rather than
 *   shown as a calendar of empty days.
 */
export function shopsServingParty(
  party: PartyServices,
  services: readonly Service[],
  locationIds: readonly LocationId[],
): readonly LocationId[] {
  const byId = new Map(services.map((service) => [service.id.value, service]));
  /** `undefined` when the catalog does not know the service. */
  const offers = (
    serviceId: ServiceId,
    locationId: LocationId,
  ): boolean | undefined =>
    byId.get(serviceId.value)?.servesLocation(locationId);
  return locationIds.filter(
    (locationId) =>
      party.lineServiceIds.every((id) => offers(id, locationId) ?? true) &&
      party.riderServiceIds.every((id) => offers(id, locationId) ?? false),
  );
}
