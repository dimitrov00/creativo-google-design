import { DomainError } from '@creativo/domain/kernel';
import {
  BookingCartError,
  BookingPartyError,
} from '@creativo/domain/scheduling';

/**
 * The machine was handed an event its current state has no arm for — a
 * programming error, not a user one, but it still surfaces through the same
 * `translateDomainError` path so a mis-wired control degrades to a message
 * instead of a silent no-op.
 */
export class InvalidBookingFlowTransitionError extends DomainError {
  override readonly code = 'booking.flow.invalid_transition' as const;
  constructor(
    public readonly from: string,
    public readonly event: string,
  ) {
    super(`Booking flow cannot handle "${event}" from "${from}"`, {
      from,
      event,
    });
  }
}

/** A guest label the domain refused (blank, over the `SeatLabel` ceiling). */
export class InvalidGuestError extends DomainError {
  override readonly code = 'booking.flow.invalid_guest' as const;
  constructor(public readonly errors: readonly BookingPartyError[]) {
    super(`Guest rejected: ${errors.map((error) => error.code).join(', ')}`);
  }
}

export class GuestNotFoundInFlowError extends DomainError {
  override readonly code = 'booking.flow.guest_not_found' as const;
  constructor(public readonly guestId: string) {
    super(`No guest "${guestId}" in this booking party`, { guestId });
  }
}

/**
 * The party is at capacity. A real rejection rather than a UI-only guard:
 * hiding the add control is presentation, and validation that lives only in
 * a template is validation that drifts.
 */
export class PartyFullError extends DomainError {
  override readonly code = 'booking.flow.party_full' as const;
  constructor(public readonly max: number) {
    super(`A booking party holds at most ${max} people`, { max });
  }
}

/** Leaving the services step with nothing in the bag. */
export class EmptyCartError extends DomainError {
  override readonly code = 'booking.flow.empty_cart' as const;
  constructor() {
    super('A booking needs at least one service');
  }
}

/**
 * A cart operation named a line the seat does not hold. Wraps the domain's
 * own `CartLineNotFoundError` so the flow's error union stays one type and
 * the code the UI translates stays a `booking.flow.*` key.
 */
export class InvalidCartOperationError extends DomainError {
  override readonly code = 'booking.flow.invalid_cart_operation' as const;
  // Named `reason`, not `cause` — `Error.cause` is already taken and means
  // something narrower (the thrown thing underneath).
  constructor(public readonly reason: BookingCartError) {
    super(`Cart operation rejected: ${reason.code}`, reason.params);
  }
}

/**
 * Errors `advanceBookingFlow` can produce.
 *
 * `DomainError` subclasses rather than the `{kind:…}` union this started as:
 * `translateDomainError(transloco, { code, params })` is the one path a
 * feature narrates errors through, and it needs a `code`. Every member here
 * therefore has an `errors.booking.flow.*` entry in both locale files.
 */
export type BookingFlowError =
  | InvalidBookingFlowTransitionError
  | InvalidGuestError
  | GuestNotFoundInFlowError
  | PartyFullError
  | EmptyCartError
  | InvalidCartOperationError;
