import {
  type BookingDraftRider,
  shopsServingParty,
} from '@creativo/application/booking';
import type {
  Barber,
  Location,
  Service,
  ServiceId,
} from '@creativo/application/catalog';

/**
 * Can the shop still serve every seat a move CARRIES, together, on some day,
 * at some time, at some shop?
 *
 * A carried seat (a companion the shop seated) keeps its barber, its
 * service and the variant it was sold as. When any of those is gone from
 * the live catalogue, no start is ever right for it:
 * - its barber is off the active list, so the grid never reads their day and
 *   the rider check drops every start;
 * - its service is retired, which the server refuses outright
 *   (`RescheduleBookingUseCase`, `service_unavailable`);
 * - its variant is retired while the service stays, which the server
 *   refuses the same way (`decideBooking` on `variantId`).
 *
 * And the carried seats move TOGETHER, to one shop: no ACTIVE shop may be
 * left that offers every carried service at once (`shopsServingParty`, asked
 * once about all of them). Each seat served somewhere is not enough: a son's
 * fade offered only at the Center and a daughter's braids only in Mladost
 * are each served, but never at one shop, so the grid runs no shop for the
 * party and the server refuses one of them wherever the move goes. Only the
 * client's OWN services are the client's to change, so the schedule step's
 * «nowhere» notice («Промени услугите») cannot answer this; the call panel
 * does.
 *
 * The honest answer is then the phone, not an empty grid to scroll through
 * (`MoveRefusal` `carried_out_of_reach`). WHICH shop the move goes to is
 * still the client's choice: a shop that cannot serve the party, while
 * another one can, is the schedule step's to say, with the way to that one.
 *
 * `true` for a move that carries nobody. The caller must only ask once both
 * catalogue reads have ANSWERED: an empty list that has not arrived yet
 * would read as "everyone is gone". The same holds for the shops, which are
 * a third read: `locations` is `null` until that read has answered
 * successfully (`CatalogContentService.locationsKnown`), and the shop
 * question is not asked until then. An answered list with no active shop in
 * it is an answer: there is nowhere to seat the companion.
 */
export function carriedSeatsInReach(
  riders: readonly BookingDraftRider[],
  services: readonly Service[],
  barbers: readonly Barber[],
  locations: readonly Location[] | null,
): boolean {
  if (riders.length === 0) return true;
  const active = new Set(barbers.map((barber) => barber.id.value));
  const offered = new Map(
    services.map((service) => [service.id.value, service]),
  );
  const carried: ServiceId[] = [];
  for (const rider of riders) {
    if (!active.has(rider.barberId)) return false;
    const service = offered.get(rider.serviceId);
    if (!service) return false;
    if (
      rider.variantId !== null &&
      !service.variants.some((variant) => variant.id.value === rider.variantId)
    ) {
      return false;
    }
    carried.push(service.id);
  }
  if (locations === null) return true;
  return (
    shopsServingParty(
      { lineServiceIds: [], riderServiceIds: carried },
      services,
      locations.map((location) => location.id),
    ).length > 0
  );
}
