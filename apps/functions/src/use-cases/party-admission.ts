import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  type LocationId,
  Service,
  ServiceVariantId,
  servicesConflict,
} from '@creativo/domain/catalog';
import type { BookingCart, BookingPolicy } from '@creativo/domain/scheduling';
import {
  CommitBookingConflictingServicesError,
  type CommitBookingError,
  CommitBookingInvalidInputError,
  CommitBookingPartyTooLargeError,
  CommitBookingServiceNotAtLocationError,
  CommitBookingUnknownServiceError,
} from './commit-booking.errors';

/**
 * One seat of a party as its TIME-INDEPENDENT admission reads it: who sits
 * in it, and what they ask for. No start, no barber — nothing a clock or a
 * roster can change the answer to.
 */
export interface AdmissibleSeat {
  /**
   * Who sits in it, as the caller counts people — the decision's
   * `personKey`, a cart's seat key. Only ever compared for equality, so the
   * two spellings never have to agree, only each be consistent.
   */
  readonly personKey: string;
  readonly serviceId: string;
  readonly variantId: string | null;
  /**
   * The seat's terms are CARRIED forward from a stored seat
   * (`DecideBookingDeps.termsOverrides`): it survives its service leaving
   * the catalogue, and a seat booked before its service gained variants
   * keeps its `variantId: null`. Never set for a cart — nothing a client
   * sends is carried.
   */
  readonly carried: boolean;
}

/**
 * A shop as the booking path reads its document (`toShop`): only the fact
 * the listing rule asks.
 */
export interface AdmissibleShop {
  /** `status: 'active'` — any other status, or none, is not listed. */
  readonly active: boolean;
}

/**
 * THE SHOP A WAITLIST MAY WATCH: one that is there, and listed on the
 * public surface — `/book` offers it and the grid searches it.
 *
 * One rule, asked by both sides of the waitlist's promise:
 * - `decideWaitlist`, at the door: a request naming a shop that is not
 *   there (the commit refuses it as `invalid_input: locationId`) or that
 *   is hidden is refused, because no freed slot there could ever reach the
 *   client;
 * - `loadDayAvailability`, the matcher's day: only listed shops are
 *   searched, so a request whose shop was hidden since is skipped until
 *   the shop is back.
 *
 * Not asked by the commit. Its load refuses only a shop that is not there
 * (`toShop` returning `null`), because the same load serves moves and staff
 * edits, and a visit booked at a shop that was hidden since must still be
 * movable.
 */
export function shopListed<T extends AdmissibleShop>(
  shop: T | null,
): shop is T {
  return shop !== null && shop.active;
}

/** What one seat resolved to, in the order asked. */
export interface AdmittedSeat {
  /** The catalogue row, or `null` for a carried seat whose service retired. */
  readonly service: Service | null;
  readonly variantId: ServiceVariantId | null;
}

export interface PartyAdmissionOptions {
  /**
   * The shop the party is booked at, or `null` for "any shop" (a waitlist
   * request that named none: the matcher only ever runs shops that serve
   * the whole party, `shopsServingParty`).
   */
  readonly locationId: LocationId | null;
  /** The shop's own book combines what it likes — `DecideBookingDeps`. */
  readonly allowConflictingServices?: boolean;
}

/**
 * THE PARTY'S TIME-INDEPENDENT ADMISSION — every refusal the commit makes
 * whatever the time: nobody to seat (`invalid_input: seats`), more people
 * than the policy seats (`party_too_large`), a service the catalogue does
 * not offer (`unknown_service`) or not at this shop
 * (`service_not_at_location`), a variant that does not parse or that the
 * service does not declare, a service with variants and none chosen
 * (`invalid_input: variantId`), and two services one person may not have
 * together (`conflicting_services`).
 *
 * ONE implementation, asked by everybody who has to agree with the commit
 * (round 6):
 * - `decideBooking`, the commit itself, a client's move and a staff edit;
 * - `decideWaitlist`, at request time, so a client is never kept waiting
 *   for a booking no time could make;
 * - `matchWaitlist`, before every notification, so catalogue drift since
 *   the request (a service gaining variants or conflicts, a lowered party
 *   cap, a service retired) never becomes a promise the commit refuses.
 *
 * Pure. The order is the commit's: the party, then seat by seat.
 */
export function partyAdmissible(
  seats: readonly AdmissibleSeat[],
  services: readonly Service[],
  policy: BookingPolicy,
  options: PartyAdmissionOptions,
): Result<readonly AdmittedSeat[], CommitBookingError> {
  if (seats.length === 0) {
    return fail(new CommitBookingInvalidInputError('seats'));
  }

  // A "person" is counted from the seats rather than trusted from a field,
  // because the cap is a rule and the client is not where rules live.
  const people = new Set(seats.map((seat) => seat.personKey));
  if (people.size > policy.maxPartySize) {
    return fail(new CommitBookingPartyTooLargeError(policy.maxPartySize));
  }

  const byId = new Map(services.map((service) => [service.id.value, service]));
  /** Services already asked for, per person — the conflict check's input. */
  const servicesByPerson = new Map<string, Service[]>();
  const admitted: AdmittedSeat[] = [];

  for (const seat of seats) {
    const service = byId.get(seat.serviceId) ?? null;
    if (!service) {
      // A carried seat survives its service leaving the catalogue: the
      // appointment EXISTS and its terms are a snapshot. Everything the
      // catalogue row would have decided (location, variant, conflicts) is
      // skipped with it, because there is no row left to decide from.
      if (!seat.carried) {
        return fail(new CommitBookingUnknownServiceError(seat.serviceId));
      }
    } else if (
      options.locationId !== null &&
      // `servesLocation`, not a hand-rolled `some`: an EMPTY `locationIds`
      // is the catalogue's "every location".
      !service.servesLocation(options.locationId)
    ) {
      return fail(
        new CommitBookingServiceNotAtLocationError(
          seat.serviceId,
          options.locationId.value,
        ),
      );
    }

    let variantId: ServiceVariantId | null = null;
    if (seat.variantId !== null) {
      const parsed = ServiceVariantId.create(seat.variantId);
      if (parsed.isFailure()) {
        return fail(new CommitBookingInvalidInputError('variantId'));
      }
      const chosen = parsed.value;
      variantId = chosen;
      // A variant the service does not declare is unreachable through the
      // UI: a stale tab or a forged payload, and either way the terms it
      // would resolve to are not the ones the user saw.
      if (
        service &&
        !service.variants.some((variant) => variant.id.equals(chosen))
      ) {
        return fail(new CommitBookingInvalidInputError('variantId'));
      }
    } else if (service && service.variants.length > 0 && !seat.carried) {
      // The catalogue offers a choice that moves the price; committing
      // without one would silently charge `baseTerms`. A CARRIED seat is
      // the exception: its terms travel wholesale, so there is no
      // `baseTerms` to charge by accident, and every seat booked before its
      // service gained a variant is legitimately `variantId: null`.
      return fail(new CommitBookingInvalidInputError('variantId'));
    }

    if (service) {
      const existing = servicesByPerson.get(seat.personKey) ?? [];
      for (const other of existing) {
        if (
          !options.allowConflictingServices &&
          servicesConflict(service, other, services)
        ) {
          return fail(
            new CommitBookingConflictingServicesError(
              service.id.value,
              other.id.value,
            ),
          );
        }
      }
      servicesByPerson.set(seat.personKey, [...existing, service]);
    }

    admitted.push({ service, variantId });
  }

  return ok(admitted);
}

/**
 * A cart — a waitlist request's bag — as the commit would admit it
 * whatever the time: `partyAdmissible` over its lines, one person per cart
 * seat (the seat key is who sits there, as the booking grid counts people,
 * `AvailabilityLine.personKey`), nothing carried.
 */
export function cartAdmissible(
  cart: BookingCart,
  services: readonly Service[],
  policy: BookingPolicy,
  locationId: LocationId | null,
): Result<void, CommitBookingError> {
  const seats = cart.entries().flatMap(([seatKey, lines]) =>
    lines.map((line): AdmissibleSeat => ({
      personKey: seatKey,
      serviceId: line.serviceId.value,
      variantId: line.variantId?.value ?? null,
      carried: false,
    })),
  );
  const admitted = partyAdmissible(seats, services, policy, { locationId });
  return admitted.isFailure() ? fail(admitted.error) : ok(undefined);
}
