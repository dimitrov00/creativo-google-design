import type { MoveRider } from '@core/components';
import type { Barber, Service, ShopLocation } from '@core/entities';
import { MoveSystem } from '@core/systems';

/*
 * Whether the shop can still serve who a move carries — each rider's barber
 * active, service offered, the variant it was sold as still sold, and ONE
 * active shop offering every carried service at once — is
 * `MoveSystem.carriedSeatsInReach`, over the catalogue's own entities (a
 * `Service` is a `MoveCatalogService`, a barber and a shop give their ids).
 */

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
 *   (the `reschedule-appointment` pipeline, `service_unavailable`);
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
 * (`MoveRefusalReason.CarriedOutOfReach`). WHICH shop the move goes to is
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
  riders: readonly MoveRider[],
  services: readonly Service[],
  barbers: readonly Barber[],
  locations: readonly ShopLocation[] | null,
): boolean {
  return MoveSystem.carriedSeatsInReach(riders, barbers, services, locations);
}
