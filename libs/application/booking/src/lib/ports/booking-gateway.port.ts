import { InjectionToken } from '@angular/core';
import { DomainError, Result } from '@creativo/domain/kernel';

/**
 * One seat, as the client asks for it.
 *
 * Notice what is NOT here: no price, no duration, no owner. The server
 * re-resolves terms from the catalog against the barber it is given, and takes
 * the owner from the verified auth token. A client that could name its own
 * price would be a client that books a 40 € fade for nothing; one that could
 * name its own duration would be one that books over the next appointment.
 *
 * `barberId` IS client-supplied, because the availability engine resolved it
 * and the user was shown a name. The server does not trust that the barber is
 * free — it re-checks — only that this is the barber being asked for.
 */
export interface CommitBookingSeatRequest {
  /** The cart line this seat came from, so a bounce can point at it. */
  readonly lineId: string;
  readonly serviceId: string;
  readonly variantId: string | null;
  readonly barberId: string;
  /** Wall-clock start with offset, in the shop's zone. */
  readonly startIso: string;
  /**
   * Whose seat it is. `self` is the booker — the server binds it to the auth
   * token and ignores anything sent here. A guest carries only a display
   * label, which is all a party member ever is until they have an account.
   */
  readonly subject:
    | { readonly kind: 'self' }
    | { readonly kind: 'guest'; readonly label: string };
}

export interface CommitBookingRequest {
  readonly locationId: string;
  readonly seats: readonly CommitBookingSeatRequest[];
}

export interface CommittedBooking {
  readonly appointmentId: string;
}

/**
 * Why a commit failed, in terms the review step can act on.
 *
 * `slot_unavailable` is the one that matters: between the grid being drawn
 * and Confirm being tapped, someone else can take the time. It is a normal
 * outcome, not an exception — the step sends the user back to a freshly
 * computed grid rather than showing a dead end.
 */
export type BookingGatewayFailureCode =
  | 'slot_unavailable'
  | 'unauthenticated'
  | 'invalid_request'
  | 'catalog_changed'
  | 'unavailable'
  | 'unknown';

export class BookingGatewayError extends DomainError {
  readonly code = 'booking.gateway.failed' as const;

  constructor(
    readonly failure: BookingGatewayFailureCode,
    message: string,
    params: Readonly<Record<string, string>> = {},
  ) {
    super(message, params);
  }

  /** True when re-picking a time is the fix — the only recoverable failure. */
  isSlotTaken(): boolean {
    return this.failure === 'slot_unavailable';
  }
}

/**
 * The only way a client creates an appointment.
 *
 * There is deliberately no browser write path: `firestore.rules` allows
 * `create` on `appointments` only for staff, and the repository's `save()`
 * refuses outright. Everything a booking needs to be correct — that the price
 * is the catalog's, that the barber is rostered, that nobody else took the
 * slot — can only be checked where the client cannot reach.
 */
export interface BookingGateway {
  commit(
    request: CommitBookingRequest,
  ): Promise<Result<CommittedBooking, BookingGatewayError>>;
}

export const BOOKING_GATEWAY = new InjectionToken<BookingGateway>(
  'BookingGateway',
);
