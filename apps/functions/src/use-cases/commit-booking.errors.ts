import { DomainError } from '@creativo/domain/kernel';

/**
 * Every way a commit can be refused, as codes the client maps to copy.
 *
 * These are the SERVER's vocabulary, and it is deliberately blunt: the client
 * already validated everything it could, so anything reaching here is either a
 * race (`slot_unavailable`), a stale tab (`catalog_changed`), or an attempt to
 * book something the UI never offered. None of them get a friendly excuse.
 */
export class CommitBookingUnauthenticatedError extends DomainError {
  readonly code = 'booking.commit.unauthenticated' as const;

  constructor() {
    super('A booking needs a signed-in booker');
  }
}

export class CommitBookingInvalidInputError extends DomainError {
  readonly code = 'booking.commit.invalid_input' as const;

  constructor(readonly field: string) {
    super(`Invalid booking request: ${field}`, { field });
  }
}

export class CommitBookingUnknownServiceError extends DomainError {
  readonly code = 'booking.commit.unknown_service' as const;

  constructor(serviceId: string) {
    super(`No bookable service ${serviceId}`, { serviceId });
  }
}

export class CommitBookingServiceNotAtLocationError extends DomainError {
  readonly code = 'booking.commit.service_not_at_location' as const;

  constructor(serviceId: string, locationId: string) {
    super(`Service ${serviceId} is not offered at ${locationId}`, {
      serviceId,
      locationId,
    });
  }
}

export class CommitBookingConflictingServicesError extends DomainError {
  readonly code = 'booking.commit.conflicting_services' as const;

  constructor(first: string, second: string) {
    super(`Services ${first} and ${second} cannot be combined`, {
      first,
      second,
    });
  }
}

export class CommitBookingBarberNotRosteredError extends DomainError {
  readonly code = 'booking.commit.barber_not_rostered' as const;

  constructor(barberId: string, dayKey: string) {
    super(`Barber ${barberId} is not rostered on ${dayKey}`, {
      barberId,
      dayKey,
    });
  }
}

/**
 * The one recoverable failure: the time was free when the grid was drawn and
 * is not free now. The review step sends the user back to a fresh grid.
 */
export class CommitBookingSlotUnavailableError extends DomainError {
  readonly code = 'booking.commit.slot_unavailable' as const;

  constructor(barberId: string, startIso: string) {
    super(`${barberId} is no longer free at ${startIso}`, {
      barberId,
      startIso,
    });
  }
}

export class CommitBookingTooSoonError extends DomainError {
  readonly code = 'booking.commit.too_soon' as const;

  constructor(minLeadMinutes: number) {
    super(`Bookings need ${minLeadMinutes} minutes of notice`, {
      minLeadMinutes: String(minLeadMinutes),
    });
  }
}

export class CommitBookingBeyondHorizonError extends DomainError {
  readonly code = 'booking.commit.beyond_horizon' as const;

  constructor(horizonMonths: number) {
    super(`Bookings open ${horizonMonths} months ahead`, {
      horizonMonths: String(horizonMonths),
    });
  }
}

export class CommitBookingPartyTooLargeError extends DomainError {
  readonly code = 'booking.commit.party_too_large' as const;

  constructor(maxPartySize: number) {
    super(`A booking seats at most ${maxPartySize} people`, {
      maxPartySize: String(maxPartySize),
    });
  }
}

export class CommitBookingInvariantError extends DomainError {
  readonly code = 'booking.commit.invariant_violated' as const;

  constructor(readonly violations: unknown) {
    super('The appointment refused its own invariants');
  }
}

export class CommitBookingStoreError extends DomainError {
  readonly code = 'booking.commit.store_failed' as const;

  constructor(readonly storeFailure: unknown) {
    super('The booking could not be written');
  }
}

export type CommitBookingError =
  | CommitBookingUnauthenticatedError
  | CommitBookingInvalidInputError
  | CommitBookingUnknownServiceError
  | CommitBookingServiceNotAtLocationError
  | CommitBookingConflictingServicesError
  | CommitBookingBarberNotRosteredError
  | CommitBookingSlotUnavailableError
  | CommitBookingTooSoonError
  | CommitBookingBeyondHorizonError
  | CommitBookingPartyTooLargeError
  | CommitBookingInvariantError
  | CommitBookingStoreError;
