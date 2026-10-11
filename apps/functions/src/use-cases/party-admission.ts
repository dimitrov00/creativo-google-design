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
  type BookingError,
  BookingErrorCode,
  type BookingPolicy as EcsBookingPolicy,
  CartLineId,
  Currency,
  DurationMinutes,
  LocationId as EcsLocationId,
  LocationStatus,
  MinuteCount,
  PartyAdmissionSystem,
  PriceCents,
  SeatKeyText,
  type Service as EcsService,
  ServiceCategoryId,
  ServiceComposition,
  ServiceId as EcsServiceId,
  ServiceStatus,
  ServiceTerms,
  ServiceVariantId as EcsServiceVariantId,
  defect,
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
      : {
          locationStatus: shop.active
            ? LocationStatus.Active
            : LocationStatus.Hidden,
        },
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
    services.map(toEcsService),
    toEcsPolicy(policy),
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
    services.map(toEcsService),
    toEcsPolicy(policy),
    locationId === null ? null : EcsLocationId.of(locationId.value),
  );
  return admitted.ok ? ok(undefined) : fail(toLegacyError(admitted.error));
}

/* ── Phase 2 shim converters: legacy aggregates ↔ ecs-core structs ──────── */

/**
 * The legacy wire spelling of each refusal code (`booking.commit.*`) — what
 * a legacy error class carries where it names a code, as the callable edge
 * still renders it (flatten-spec §4.3: the wire is frozen).
 */
export const LEGACY_BOOKING_CODE: Readonly<Record<BookingErrorCode, string>> = {
  [BookingErrorCode.Unauthenticated]: 'booking.commit.unauthenticated',
  [BookingErrorCode.InvalidInput]: 'booking.commit.invalid_input',
  [BookingErrorCode.UnknownService]: 'booking.commit.unknown_service',
  [BookingErrorCode.ServiceNotAtLocation]:
    'booking.commit.service_not_at_location',
  [BookingErrorCode.ConflictingServices]: 'booking.commit.conflicting_services',
  [BookingErrorCode.BarberNotRostered]: 'booking.commit.barber_not_rostered',
  [BookingErrorCode.SlotUnavailable]: 'booking.commit.slot_unavailable',
  [BookingErrorCode.TooSoon]: 'booking.commit.too_soon',
  [BookingErrorCode.BeyondHorizon]: 'booking.commit.beyond_horizon',
  [BookingErrorCode.PartyTooLarge]: 'booking.commit.party_too_large',
  [BookingErrorCode.InvariantViolated]: 'booking.commit.invariant_violated',
};

/** The legacy status ↔ the dictionary (`'active'` ↔ `ACTIVE`). */
const SERVICE_STATUS: Readonly<Record<'active' | 'archived', ServiceStatus>> = {
  active: ServiceStatus.Active,
  archived: ServiceStatus.Archived,
};

/** A brand the legacy value already satisfies — its own rules are the brand's. */
function sure<T, E>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: E },
  what: string,
): T {
  // Unreachable: a legacy `ServiceTerms` / `BookingPolicy` already holds
  // every rule the brand checks.
  if (!result.ok) defect(`unreachable: ${what}`);
  return result.value;
}

/** Legacy terms → the five flat, branded `ServiceTerms` fields. */
export function toEcsTerms(terms: LegacyServiceTerms): ServiceTerms {
  return ServiceTerms.of(
    sure(PriceCents.of(terms.price.toMinorUnits()), 'a price'),
    sure(Currency.parse(terms.price.currencyCode()), 'a currency'),
    sure(DurationMinutes.of(terms.durationMinutes), 'a duration'),
    sure(MinuteCount.of(terms.setupMinutes), 'a pad'),
    sure(MinuteCount.of(terms.cleanupMinutes), 'a pad'),
  );
}

/**
 * The legacy aggregate → the flat stored entity (the cover is not read by
 * admission or the decision: all seven fields `null`).
 */
export function toEcsService(service: Service): EcsService {
  const composition = service.composition;
  return {
    id: EcsServiceId.of(service.id.value),
    name: { bg: service.name.bg, en: service.name.en },
    description: { bg: service.description.bg, en: service.description.en },
    categoryId: ServiceCategoryId.of(service.categoryId.value),
    ...toEcsTerms(service.baseTerms),
    variants: service.variants.map((variant) => ({
      variantId: EcsServiceVariantId.of(variant.id.value),
      name: { bg: variant.name.bg, en: variant.name.en },
    })),
    offerings: service.offerings.map((offering) => ({
      barberId: EcsBarberId.of(offering.barberId.value),
      ...toEcsTerms(offering.base),
      overrides: service.variants.flatMap((variant) => {
        const terms = offering.termsFor(variant.id);
        return terms === offering.base
          ? []
          : [
              {
                variantId: EcsServiceVariantId.of(variant.id.value),
                ...toEcsTerms(terms),
              },
            ];
      }),
    })),
    locationIds: service.locationIds.map((id) => EcsLocationId.of(id.value)),
    conflictsWith: service.conflictsWith.map((id) => EcsServiceId.of(id.value)),
    ...(composition.kind === 'bundle'
      ? ServiceComposition.bundle(
          composition.includes.map((id) => EcsServiceId.of(id.value)),
        )
      : ServiceComposition.single()),
    upsellOnly: service.upsellOnly,
    popular: service.popular,
    serviceStatus: SERVICE_STATUS[service.status],
    sortOrder: service.sortOrder,
    coverMediaId: null,
    coverMediaPath: null,
    coverMediaWidth: null,
    coverMediaHeight: null,
    coverMediaBlurhash: null,
    coverMediaFocalX: null,
    coverMediaFocalY: null,
  };
}

/** The legacy policy → the branded one (its own rules are the brands'). */
export function toEcsPolicy(policy: BookingPolicy): EcsBookingPolicy {
  return {
    maxPartySize: policy.maxPartySize,
    slotStepMinutes: sure(
      DurationMinutes.of(policy.slotStepMinutes),
      'a slot step',
    ),
    minLeadMinutes: sure(MinuteCount.of(policy.minLeadMinutes), 'a lead'),
    horizonMonths: policy.horizonMonths,
    cancellationWindowHours: policy.cancellationWindow.hours,
    maxFlexibleDays: policy.maxFlexibleDays,
    autoConfirm: policy.autoConfirm,
  };
}

function toCart(cart: BookingCart): EcsBookingCart {
  return {
    cartSeats: cart.entries().map(([key, lines]) => {
      const seatKey = SeatKeyText.of(key);
      return {
        seatKey,
        lines: lines.map((line) => ({
          lineId: CartLineId.of(line.id.value),
          seatKey,
          serviceId: EcsServiceId.of(line.serviceId.value),
          variantId:
            line.variantId === null
              ? null
              : EcsServiceVariantId.of(line.variantId.value),
          barberId: null,
          locationId: null,
        })),
      };
    }),
    cartNextSequence: 0,
  };
}

/** A non-blank variant id the system admitted → the legacy value object. */
function toVariantId(raw: string): ServiceVariantId | null {
  const parsed = ServiceVariantId.create(raw);
  return parsed.isSuccess() ? parsed.value : null;
}

/** The system's refusal → the legacy error class the callers branch on. */
function toLegacyError(error: BookingError): CommitBookingError {
  switch (error.errorCode) {
    case BookingErrorCode.PartyTooLarge:
      return new CommitBookingPartyTooLargeError(error.maxPartySize);
    case BookingErrorCode.UnknownService:
      return new CommitBookingUnknownServiceError(error.serviceId);
    case BookingErrorCode.ServiceNotAtLocation:
      return new CommitBookingServiceNotAtLocationError(
        error.serviceId,
        error.locationId,
      );
    case BookingErrorCode.ConflictingServices:
      return new CommitBookingConflictingServicesError(
        error.first,
        error.second,
      );
    case BookingErrorCode.InvalidInput:
      return new CommitBookingInvalidInputError(error.field);
    default:
      // Admission refuses with the five codes above only.
      return new CommitBookingInvalidInputError(
        LEGACY_BOOKING_CODE[error.errorCode],
      );
  }
}
