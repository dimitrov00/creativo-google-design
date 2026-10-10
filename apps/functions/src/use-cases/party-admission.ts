import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  type LocationId,
  Service,
  type ServiceTerms as LegacyServiceTerms,
  ServiceVariantId,
} from '@creativo/domain/catalog';
import type { BookingCart, BookingPolicy } from '@creativo/domain/scheduling';
import {
  BarberId as EcsBarberId,
  type BookingCart as EcsBookingCart,
  type BookingCommitError,
  BookingCommitErrorCode,
  type BookingPolicy as EcsBookingPolicy,
  LocationId as EcsLocationId,
  LocationState,
  PartyAdmissionSystem,
  ServiceCategoryId,
  ServiceComposition,
  type ServiceEntity,
  ServiceId as EcsServiceId,
  ServiceTerms,
  ServiceVariantId as EcsServiceVariantId,
} from '@creativo/ecs-core';
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
  return PartyAdmissionSystem.shopListed(
    shop === null
      ? null
      : { status: shop.active ? LocationState.Active : LocationState.Hidden },
  );
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
  const admitted = PartyAdmissionSystem.admit(
    seats,
    services.map(toServiceEntity),
    toPolicy(policy),
    {
      locationId:
        options.locationId === null
          ? null
          : EcsLocationId.of(options.locationId.value),
      allowConflictingServices: options.allowConflictingServices === true,
    },
  );
  if (!admitted.ok) return fail(toLegacyError(admitted.error));
  return ok(
    admitted.value.map((seat) => ({
      service:
        seat.service === null
          ? null
          : (services.find(
              (service) => service.id.value === seat.service?.id,
            ) ?? null),
      variantId: seat.variantId === null ? null : toVariantId(seat.variantId),
    })),
  );
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
  const admitted = PartyAdmissionSystem.admitCart(
    toCart(cart),
    services.map(toServiceEntity),
    toPolicy(policy),
    locationId === null ? null : EcsLocationId.of(locationId.value),
  );
  return admitted.ok ? ok(undefined) : fail(toLegacyError(admitted.error));
}

/* ── Phase 2 shim converters: legacy aggregates ↔ ecs-core structs ──────── */

function toTerms(terms: LegacyServiceTerms): ServiceTerms {
  return ServiceTerms.of(
    terms.price.toMinorUnits(),
    terms.price.currencyCode(),
    terms.durationMinutes,
    terms.setupMinutes,
    terms.cleanupMinutes,
  );
}

/** The legacy aggregate → the stored entity (the cover is not read by admission). */
function toServiceEntity(service: Service): ServiceEntity {
  const composition = service.composition;
  return {
    id: EcsServiceId.of(service.id.value),
    name: { bg: service.name.bg, en: service.name.en },
    description: { bg: service.description.bg, en: service.description.en },
    categoryId: ServiceCategoryId.of(service.categoryId.value),
    baseTerms: toTerms(service.baseTerms),
    variants: service.variants.map((variant) => ({
      id: EcsServiceVariantId.of(variant.id.value),
      name: { bg: variant.name.bg, en: variant.name.en },
    })),
    offerings: service.offerings.map((offering) => ({
      barberId: EcsBarberId.of(offering.barberId.value),
      base: toTerms(offering.base),
      overrides: service.variants.flatMap((variant) => {
        const terms = offering.termsFor(variant.id);
        return terms === offering.base
          ? []
          : [
              {
                variantId: EcsServiceVariantId.of(variant.id.value),
                terms: toTerms(terms),
              },
            ];
      }),
    })),
    cover: null,
    locationIds: service.locationIds.map((id) => EcsLocationId.of(id.value)),
    conflictsWith: service.conflictsWith.map((id) => EcsServiceId.of(id.value)),
    composition:
      composition.kind === 'bundle'
        ? ServiceComposition.bundle(
            composition.includes.map((id) => EcsServiceId.of(id.value)),
          )
        : ServiceComposition.single(),
    upsellOnly: service.upsellOnly,
    popular: service.popular,
    status: service.status,
    sortOrder: service.sortOrder,
  };
}

function toPolicy(policy: BookingPolicy): EcsBookingPolicy {
  return {
    maxPartySize: policy.maxPartySize,
    slotStepMinutes: policy.slotStepMinutes,
    minLeadMinutes: policy.minLeadMinutes,
    horizonMonths: policy.horizonMonths,
    cancellationWindowHours: policy.cancellationWindow.hours,
    maxFlexibleDays: policy.maxFlexibleDays,
    autoConfirm: policy.autoConfirm,
  };
}

function toCart(cart: BookingCart): EcsBookingCart {
  return {
    seats: cart.entries().map(([seatKey, lines]) => ({
      seatKey,
      lines: lines.map((line) => ({
        lineId: line.id.value,
        seatKey,
        serviceId: EcsServiceId.of(line.serviceId.value),
        variantId:
          line.variantId === null
            ? null
            : EcsServiceVariantId.of(line.variantId.value),
        barberId: null,
        locationId: null,
      })),
    })),
    nextSequence: 0,
  };
}

/** A non-blank variant id the system admitted → the legacy value object. */
function toVariantId(raw: string): ServiceVariantId | null {
  const parsed = ServiceVariantId.create(raw);
  return parsed.isSuccess() ? parsed.value : null;
}

/** The system's refusal → the legacy error class the callers branch on. */
function toLegacyError(error: BookingCommitError): CommitBookingError {
  switch (error.code) {
    case BookingCommitErrorCode.PartyTooLarge:
      return new CommitBookingPartyTooLargeError(error.maxPartySize);
    case BookingCommitErrorCode.UnknownService:
      return new CommitBookingUnknownServiceError(error.serviceId);
    case BookingCommitErrorCode.ServiceNotAtLocation:
      return new CommitBookingServiceNotAtLocationError(
        error.serviceId,
        error.locationId,
      );
    case BookingCommitErrorCode.ConflictingServices:
      return new CommitBookingConflictingServicesError(
        error.first,
        error.second,
      );
    case BookingCommitErrorCode.InvalidInput:
      return new CommitBookingInvalidInputError(error.field);
    default:
      // Admission refuses with the five codes above only.
      return new CommitBookingInvalidInputError(error.code);
  }
}
