import { LocationId, Service, ServiceId } from '@creativo/domain/catalog';
import {
  type AvailabilityRider,
  BookingCart,
} from '@creativo/domain/scheduling';
import {
  BarberId as EcsBarberId,
  CartLineId as EcsCartLineId,
  DurationMinutes,
  LocationId as EcsLocationId,
  MinuteCount,
  MinuteDelta,
  SeatKeyText,
  ServiceId as EcsServiceId,
  ServiceVariantId as EcsServiceVariantId,
  defect,
} from '@core/primitives';
import { type BookingCart as EcsBookingCart } from '@core/components';
import {
  BookingCartSystem,
  type CartRider,
  type CartServiceScope,
  type LineTerms,
} from '@core/systems';

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
  const lines = cart.entries().flatMap(([, seatLines]) => seatLines);
  const asked = BookingCartSystem.partyServicesOf(
    cartScopeOf(cart),
    riders.map(riderScopeOf),
  );
  // The system answers with the same services in the same order; hand the
  // caller back its own id objects.
  return {
    lineServiceIds: lines
      .map((line) => line.serviceId)
      .filter((id) => asked.lineServiceIds.includes(serviceKeyOf(id))),
    riderServiceIds: riders
      .map((rider) => rider.serviceId)
      .filter((id) => asked.riderServiceIds.includes(serviceKeyOf(id))),
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
  const serving = BookingCartSystem.shopsServingParty(
    {
      lineServiceIds: party.lineServiceIds.map(serviceKeyOf),
      riderServiceIds: party.riderServiceIds.map(serviceKeyOf),
    },
    scopesOf(services),
    locationIds.map(locationKeyOf),
  );
  return locationIds.filter((locationId) =>
    serving.includes(locationKeyOf(locationId)),
  );
}

// ── The bridge: legacy classes → ecs-core structs (Phase 4 deletes it) ───

function serviceKeyOf(id: ServiceId): EcsServiceId {
  return EcsServiceId.of(id.value);
}

function locationKeyOf(id: LocationId): EcsLocationId {
  return EcsLocationId.of(id.value);
}

/**
 * The catalogue as the scope rule reads it. The legacy lookup (a `Map` by
 * id) kept the LAST of two services under one id and the system finds the
 * first, so the list is walked from the end and each id kept once.
 */
function scopesOf(services: readonly Service[]): readonly CartServiceScope[] {
  const scopes: CartServiceScope[] = [];
  const seen = new Set<string>();
  for (const service of [...services].reverse()) {
    if (seen.has(service.id.value)) continue;
    seen.add(service.id.value);
    scopes.push({
      id: serviceKeyOf(service.id),
      locationIds: service.locationIds.map(locationKeyOf),
    });
  }
  return scopes;
}

/** The cart's lines as the system reads them — only the services are asked of it. */
function cartScopeOf(cart: BookingCart): EcsBookingCart {
  return {
    cartSeats: cart.entries().map(([rawSeatKey, lines]) => {
      const seatKey = SeatKeyText.of(rawSeatKey);
      return {
        seatKey,
        lines: lines.map((line) => ({
          lineId: EcsCartLineId.of(line.id.value),
          seatKey,
          serviceId: serviceKeyOf(line.serviceId),
          variantId:
            line.variantId === null
              ? null
              : EcsServiceVariantId.of(line.variantId.value),
          barberId:
            line.barberPref.kind === 'specific'
              ? EcsBarberId.of(line.barberPref.barberId.value)
              : null,
          locationId: null,
        })),
      };
    }),
    cartNextSequence: cart.nextLineSequence,
  };
}

/** Unreachable refusals of figures the catalogue checked when it sold the seat. */
function sure<T, E>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: E },
  what: string,
): T {
  if (!result.ok) defect(`unreachable: ${what}`);
  return result.value;
}

/** A sold seat's terms as the engine reads them — branded minutes. */
function lineTermsOf(terms: MoveRider['terms']): LineTerms {
  return {
    durationMinutes: sure(
      DurationMinutes.of(terms.durationMinutes),
      'a sold duration',
    ),
    padBeforeMinutes: sure(MinuteCount.of(terms.padBeforeMinutes), 'a pad'),
    padAfterMinutes: sure(MinuteCount.of(terms.padAfterMinutes), 'a pad'),
  };
}

/** A carried seat as the system reads it — its service is all the shop rule asks. */
function riderScopeOf(rider: MoveRider): CartRider {
  return {
    barberId: EcsBarberId.of(rider.barberId.value),
    offsetMinutes: sure(MinuteDelta.of(rider.offsetMinutes), 'an offset'),
    terms: lineTermsOf(rider.terms),
    serviceId: serviceKeyOf(rider.serviceId),
  };
}
