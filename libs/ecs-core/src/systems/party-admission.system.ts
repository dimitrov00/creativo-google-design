import { BookingCommitError } from '../components/booking-commit-errors.data';
import type { BookingPolicy } from '../components/booking-policy.data';
import type { BookingCart, CartLine } from '../components/cart-line.data';
import { LocationState } from '../components/catalog-status.data';
import { Result } from '../components/result.data';
import {
  type ServiceVariant,
  ServiceVariantId,
} from '../components/service-terms.data';
import type { LocationEntity, LocationId } from '../entities/location.entity';
import type { ServiceEntity } from '../entities/service.entity';
import { LocationScopeSystem } from './location-scope.system';
import { ServiceConflictSystem } from './service-conflict.system';

/* ── Admission ─────────────────────────────────────────────────────────── */

/**
 * One seat of a party as its TIME-INDEPENDENT admission reads it
 * (`party-admission.ts:23-40`): who sits in it (`personKey`, only ever
 * compared for equality), what they ask for, and whether its terms are
 * CARRIED forward from a stored seat — a carried seat survives its service
 * leaving the catalogue, and keeps a `variantId: null` booked before its
 * service gained variants. The ids are raw request strings.
 */
export type AdmissionSeat = {
  readonly personKey: string;
  readonly serviceId: string;
  readonly variantId: string | null;
  readonly carried: boolean;
};

/** What one seat resolved to, in the order asked. */
export type AdmittedSeat = {
  /** The catalogue row, or `null` for a carried seat whose service retired. */
  readonly service: ServiceEntity | null;
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
  services: readonly ServiceEntity[],
  serviceId: string,
): ServiceEntity | null {
  for (let i = 0; i < services.length; i++) {
    const service = services[i] as ServiceEntity;
    if (service.id === serviceId) return service;
  }
  return null;
}

function declaresVariant(
  variants: readonly ServiceVariant[],
  variantId: ServiceVariantId,
): boolean {
  for (let i = 0; i < variants.length; i++) {
    if ((variants[i] as ServiceVariant).id === variantId) return true;
  }
  return false;
}

/** How many distinct people the seats name. */
function peopleCount(seats: readonly AdmissionSeat[]): number {
  const people = new Set<string>();
  for (let i = 0; i < seats.length; i++) {
    people.add((seats[i] as AdmissionSeat).personKey);
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
   * public surface (`status: 'active'`). Any other status — hidden, one
   * nobody modelled — and no shop at all are refused: fail-closed, as every
   * public query reads them. Not asked by the commit, which must still move
   * a visit booked at a shop hidden since.
   */
  shopListed(shop: Pick<LocationEntity, 'status'> | null): boolean {
    return shop !== null && shop.status === LocationState.Active;
  },

  /**
   * THE PARTY'S TIME-INDEPENDENT ADMISSION, in the commit's order — the
   * party, then seat by seat:
   *
   * - nobody to seat → `invalid_input: seats`;
   * - more distinct people than `policy.maxPartySize` → `party_too_large`;
   * - a service the catalogue does not hold → `unknown_service` (a CARRIED
   *   seat survives it — its row decides nothing any more);
   * - a service not offered at the shop → `service_not_at_location` (an
   *   empty scope is every shop);
   * - a blank variant, one the service does not declare, or none for a
   *   service that declares some (unless carried) → `invalid_input:
   *   variantId` — committing without one would silently charge `baseTerms`;
   * - two services one PERSON may not have together → `conflicting_services`,
   *   unless the shop's own book allows it.
   */
  admit(
    seats: readonly AdmissionSeat[],
    services: readonly ServiceEntity[],
    policy: BookingPolicy,
    options: PartyAdmissionOptions,
  ): Result<readonly AdmittedSeat[], BookingCommitError> {
    if (seats.length === 0) {
      return Result.err(BookingCommitError.invalidInput('seats'));
    }
    if (peopleCount(seats) > policy.maxPartySize) {
      return Result.err(BookingCommitError.partyTooLarge(policy.maxPartySize));
    }

    /** Services already admitted, with their person — the conflict check's input. */
    const heldBy: string[] = [];
    const held: ServiceEntity[] = [];
    const admitted: AdmittedSeat[] = [];

    for (let i = 0; i < seats.length; i++) {
      const seat = seats[i] as AdmissionSeat;
      const service = serviceById(services, seat.serviceId);
      if (service === null) {
        if (!seat.carried) {
          return Result.err(BookingCommitError.unknownService(seat.serviceId));
        }
      } else if (
        options.locationId !== null &&
        !LocationScopeSystem.servesLocation(service, options.locationId)
      ) {
        return Result.err(
          BookingCommitError.serviceNotAtLocation(
            seat.serviceId,
            options.locationId,
          ),
        );
      }

      let variantId: ServiceVariantId | null = null;
      if (seat.variantId !== null) {
        if (seat.variantId.trim().length === 0) {
          return Result.err(BookingCommitError.invalidInput('variantId'));
        }
        variantId = ServiceVariantId.of(seat.variantId);
        // A variant the service does not declare is unreachable through the
        // UI: a stale tab or a forged payload.
        if (service !== null && !declaresVariant(service.variants, variantId)) {
          return Result.err(BookingCommitError.invalidInput('variantId'));
        }
      } else if (
        service !== null &&
        service.variants.length > 0 &&
        !seat.carried
      ) {
        return Result.err(BookingCommitError.invalidInput('variantId'));
      }

      if (service !== null) {
        if (!options.allowConflictingServices) {
          for (let k = 0; k < held.length; k++) {
            if (heldBy[k] !== seat.personKey) continue;
            const other = held[k] as ServiceEntity;
            if (
              ServiceConflictSystem.servicesConflict(service, other, services)
            ) {
              return Result.err(
                BookingCommitError.conflictingServices(service.id, other.id),
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
   * carried, conflicts judged.
   */
  admitCart(
    cart: BookingCart,
    services: readonly ServiceEntity[],
    policy: BookingPolicy,
    locationId: LocationId | null,
  ): Result<null, BookingCommitError> {
    const seats: AdmissionSeat[] = [];
    for (let i = 0; i < cart.seats.length; i++) {
      const seat = cart.seats[i] as BookingCart.SeatLines;
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
