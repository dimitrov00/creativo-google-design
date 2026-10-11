import { BookingError } from '../components/booking-errors.data';
import type { BookingPolicy } from '../components/booking-policy.data';
import type {
  BookingCart,
  CartLine,
  CartSeatLines,
} from '../components/cart-line.data';
import { LocationStatus } from '../components/catalog-status.data';
import { Result } from '../components/result.data';
import type { ServiceVariant } from '../components/service-terms.data';
import type { Service } from '../entities/service.entity';
import type { ShopLocation } from '../entities/shop-location.entity';
import { type LocationId, ServiceVariantId } from '../primitives/ids.primitive';
import { LocationScopeSystem } from './location-scope.system';
import { ServiceConflictSystem } from './service-conflict.system';

/* ── Admission ─────────────────────────────────────────────────────────── */

/**
 * One seat of a party as its TIME-INDEPENDENT admission reads it
 * (`party-admission.ts:23-40`): who sits in it (`personKey`, only ever
 * compared for equality), what they ask for, and whether its terms are
 * CARRIED forward from a stored seat — a carried seat survives its service
 * leaving the catalogue, and keeps a `variantId: null` booked before its
 * service gained variants. The ids are raw request strings — foreign input,
 * parsed here (the L3 `…Input` escape).
 */
export type AdmissionSeatInput = {
  readonly personKey: string;
  readonly serviceId: string;
  readonly variantId: string | null;
  readonly carried: boolean;
};

/** What one seat resolved to, in the order asked. */
export type AdmittedSeat = {
  /** The catalogue row, or `null` for a carried seat whose service retired. */
  readonly service: Service | null;
  readonly variantId: ServiceVariantId | null;
};

/**
 * Where the party is booked (`null`: "any shop" — a waitlist request that
 * named none) and whether the shop's own book combines what it likes.
 */
export type PartyAdmissionOptions = {
  readonly locationId: LocationId | null;
  readonly allowConflictingServices: boolean;
};

/** The catalogue row for a raw id — a linear scan; a catalogue is a few dozen. */
function serviceById(
  services: readonly Service[],
  serviceId: string,
): Service | null {
  for (let i = 0; i < services.length; i++) {
    const service = services[i] as Service;
    if (service.id === serviceId) return service;
  }
  return null;
}

function declaresVariant(
  variants: readonly ServiceVariant[],
  variantId: ServiceVariantId,
): boolean {
  for (let i = 0; i < variants.length; i++) {
    if ((variants[i] as ServiceVariant).variantId === variantId) return true;
  }
  return false;
}

/** How many distinct people the seats name. */
function peopleCount(seats: readonly AdmissionSeatInput[]): number {
  const people = new Set<string>();
  for (let i = 0; i < seats.length; i++) {
    people.add((seats[i] as AdmissionSeatInput).personKey);
  }
  return people.size;
}

/**
 * PartyAdmissionSystem — every refusal the commit makes WHATEVER THE TIME
 * (`party-admission.ts:23-232`), asked by everybody who has to agree with the
 * commit: the decision itself (a commit, a client's move, a staff edit), the
 * waitlist at request time, and the matcher before every notification.
 */
export const PartyAdmissionSystem = {
  /**
   * THE SHOP A WAITLIST MAY WATCH: one that is there, and listed on the
   * public surface (`locationStatus: ACTIVE`). Any other status — hidden,
   * one nobody modelled — and no shop at all are refused: fail-closed, as
   * every public query reads them. Not asked by the commit, which must still
   * move a visit booked at a shop hidden since.
   */
  shopListed(shop: Pick<ShopLocation, 'locationStatus'> | null): boolean {
    return shop !== null && shop.locationStatus === LocationStatus.Active;
  },

  /**
   * THE PARTY'S TIME-INDEPENDENT ADMISSION, in the commit's order — the
   * party, then seat by seat:
   *
   * - nobody to seat → `BOOKING_INVALID_INPUT: seats`;
   * - more distinct people than `policy.maxPartySize` →
   *   `BOOKING_PARTY_TOO_LARGE`;
   * - a service the catalogue does not hold → `BOOKING_UNKNOWN_SERVICE` (a
   *   CARRIED seat survives it — its row decides nothing any more);
   * - a service not offered at the shop → `BOOKING_SERVICE_NOT_AT_LOCATION`
   *   (an empty scope is every shop);
   * - a blank variant, one the service does not declare, or none for a
   *   service that declares some (unless carried) → `BOOKING_INVALID_INPUT:
   *   variantId` — committing without one would silently charge the
   *   service's own terms;
   * - two services one PERSON may not have together →
   *   `BOOKING_CONFLICTING_SERVICES`, unless the shop's own book allows it.
   */
  admit(
    seats: readonly AdmissionSeatInput[],
    services: readonly Service[],
    policy: BookingPolicy,
    options: PartyAdmissionOptions,
  ): Result<readonly AdmittedSeat[], BookingError> {
    if (seats.length === 0) {
      return Result.err(BookingError.invalidInput('seats'));
    }
    if (peopleCount(seats) > policy.maxPartySize) {
      return Result.err(BookingError.partyTooLarge(policy.maxPartySize));
    }

    /** Services already admitted, with their person — the conflict check's input. */
    const heldBy: string[] = [];
    const held: Service[] = [];
    const admitted: AdmittedSeat[] = [];

    for (let i = 0; i < seats.length; i++) {
      const seat = seats[i] as AdmissionSeatInput;
      const service = serviceById(services, seat.serviceId);
      if (service === null) {
        if (!seat.carried) {
          return Result.err(BookingError.unknownService(seat.serviceId));
        }
      } else if (
        options.locationId !== null &&
        !LocationScopeSystem.servesLocation(service, options.locationId)
      ) {
        return Result.err(
          BookingError.serviceNotAtLocation(seat.serviceId, options.locationId),
        );
      }

      let variantId: ServiceVariantId | null = null;
      if (seat.variantId !== null) {
        if (seat.variantId.trim().length === 0) {
          return Result.err(BookingError.invalidInput('variantId'));
        }
        variantId = ServiceVariantId.of(seat.variantId);
        // A variant the service does not declare is unreachable through the
        // UI: a stale tab or a forged payload.
        if (service !== null && !declaresVariant(service.variants, variantId)) {
          return Result.err(BookingError.invalidInput('variantId'));
        }
      } else if (
        service !== null &&
        service.variants.length > 0 &&
        !seat.carried
      ) {
        return Result.err(BookingError.invalidInput('variantId'));
      }

      if (service !== null) {
        if (!options.allowConflictingServices) {
          for (let k = 0; k < held.length; k++) {
            if (heldBy[k] !== seat.personKey) continue;
            const other = held[k] as Service;
            if (
              ServiceConflictSystem.servicesConflict(service, other, services)
            ) {
              return Result.err(
                BookingError.conflictingServices(service.id, other.id),
              );
            }
          }
        }
        heldBy.push(seat.personKey);
        held.push(service);
      }

      admitted.push({ service, variantId });
    }

    return Result.ok(admitted);
  },

  /**
   * A cart — a waitlist request's bag — as the commit would admit it
   * whatever the time (`cartAdmissible`): one person per cart seat (the
   * seat key is who sits there, as the booking grid counts people), nothing
   * carried, conflicts judged. Reads the cart slice as it is (a whole
   * `WaitlistRequest` passes).
   */
  admitCart(
    cart: BookingCart,
    services: readonly Service[],
    policy: BookingPolicy,
    locationId: LocationId | null,
  ): Result<null, BookingError> {
    const seats: AdmissionSeatInput[] = [];
    for (let i = 0; i < cart.cartSeats.length; i++) {
      const seat = cart.cartSeats[i] as CartSeatLines;
      for (let k = 0; k < seat.lines.length; k++) {
        const line = seat.lines[k] as CartLine;
        seats.push({
          personKey: seat.seatKey,
          serviceId: line.serviceId,
          variantId: line.variantId,
          carried: false,
        });
      }
    }
    const admitted = PartyAdmissionSystem.admit(seats, services, policy, {
      locationId,
      allowConflictingServices: false,
    });
    return admitted.ok ? Result.ok(null) : admitted;
  },
} as const;
