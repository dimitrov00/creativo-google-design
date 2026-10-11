import type { BookingDraftRider } from '@creativo/application/booking';
import type { Barber, Location, Service } from '@creativo/application/catalog';
import {
  BarberId,
  DurationMinutes,
  LocationId,
  MinuteCount,
  MinuteDelta,
  ServiceId,
  ServiceVariantId,
  defect,
} from '@core/primitives';
import {
  type MoveCatalogService,
  type MoveRider,
  MoveSystem,
} from '@core/systems';

/*
 * THIN SHIM (ECS migration Phase 2). Whether the shop can still serve who a
 * move carries — each rider's barber active, service offered, the variant it
 * was sold as still sold, and ONE active shop offering every carried service
 * at once — is `MoveSystem.carriedSeatsInReach`. This keeps the legacy
 * signature and only converts.
 */

/* ── Legacy ↔ ECS converters ─────────────────────────────────────────── */

/** A brand built from a stored value its own record already validated. */
function sure<T>(
  result: { readonly ok: true; readonly value: T } | { readonly ok: false },
  what: string,
): T {
  return result.ok ? result.value : defect(`unreachable: ${what}`);
}

function toRiderData(rider: BookingDraftRider): MoveRider {
  return {
    serviceId: ServiceId.of(rider.serviceId),
    variantId:
      rider.variantId === null ? null : ServiceVariantId.of(rider.variantId),
    barberId: BarberId.of(rider.barberId),
    offsetMinutes: sure(
      MinuteDelta.of(rider.offsetMinutes),
      'a stored rider distance',
    ),
    durationMinutes: sure(
      DurationMinutes.of(rider.durationMinutes),
      'a stored rider duration',
    ),
    setupMinutes: sure(MinuteCount.of(rider.setupMinutes), 'a setup pad'),
    cleanupMinutes: sure(MinuteCount.of(rider.cleanupMinutes), 'a cleanup pad'),
  };
}

function toServiceData(service: Service): MoveCatalogService {
  return {
    id: ServiceId.of(service.id.value),
    variants: service.variants.map((variant) => ({
      variantId: ServiceVariantId.of(variant.id.value),
    })),
    locationIds: service.locationIds.map((id) => LocationId.of(id.value)),
  };
}

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
  return MoveSystem.carriedSeatsInReach(
    riders.map(toRiderData),
    barbers.map((barber) => BarberId.of(barber.id.value)),
    services.map(toServiceData),
    locations === null
      ? null
      : locations.map((location) => LocationId.of(location.id.value)),
  );
}
