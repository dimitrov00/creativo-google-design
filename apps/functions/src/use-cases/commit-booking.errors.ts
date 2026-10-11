import { DomainError } from '@creativo/domain/kernel';
import type { TimeError } from '@core/primitives';

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

/**
 * THE BOOKING NAMES NO USABLE SHOP: an id no shop answers to (empty, blank,
 * one that could not name a document, or no such document) — `not_found`;
 * or a shop the public surface no longer lists that a client's booking
 * would ARRIVE at, new or moved in from another shop — `unlisted`
 * (`admitsArrival`, team decision 2026-09-26: a hidden shop takes no new
 * client bookings, while the visits already there can still be moved and
 * edited).
 *
 * One stable wire answer however it is spelled: `invalid_input` with
 * `field: 'locationId'` (`FIELD`), which the waitlist's door names too
 * (`decideWaitlist`), and which the client words from
 * `booking.commit.invalid_input.locationId` (`bookingErrorMessage`). A
 * subclass rather than a new code, like the decision's own party refusals
 * (`decide-booking.errors.ts`), so every path that answers
 * `CommitBookingError` carries it unchanged. `reason` stays OFF the wire:
 * whether a shop is missing or hidden is the shop's business, and the
 * sentence is the same either way.
 */
export class CommitBookingShopUnavailableError extends CommitBookingInvalidInputError {
  static readonly FIELD = 'locationId';

  constructor(
    readonly locationId: string,
    readonly reason: 'not_found' | 'unlisted',
  ) {
    super(CommitBookingShopUnavailableError.FIELD);
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

/**
 * A seat's wall-clock start inside the shop's spring-forward gap — a time
 * that is never on the shop's clock (Law 7.3, locked 2026-10-10: refused,
 * never shifted forward as the legacy Luxon reader did). Only a start sent
 * WITHOUT an offset can name one; it is read with the location's zone at
 * the ingestion boundary (`ZonedTimeSystem.parseIsoIn`). It leaves as the
 * edge's `TimeErrorCode` rule spells `DST_GAP_INVALID_TIME` —
 * `time.nonexistent_local_time`, `invalid-argument` — with the params the
 * client's copy of that code words it by: the refused wall clock
 * (`rawValue`, `2026-03-29T03:30`) and the zone.
 */
export class CommitBookingDstGapError extends DomainError {
  readonly code = 'time.nonexistent_local_time' as const;

  constructor(readonly timeError: TimeError.DstGap) {
    const rawValue = `${timeError.localDate}T${pad2(Math.floor(timeError.minute / 60))}:${pad2(timeError.minute % 60)}`;
    super(`${rawValue} does not exist in ${timeError.timeZone}`, {
      rawValue,
      zone: timeError.timeZone,
    });
  }
}

const pad2 = (value: number): string => String(value).padStart(2, '0');

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
  | CommitBookingDstGapError
  | CommitBookingStoreError;
