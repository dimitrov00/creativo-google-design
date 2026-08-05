import { InjectionToken } from '@angular/core';
import { DomainError, Result } from '@creativo/domain/kernel';
import type { BookingContactProps } from '@creativo/domain/scheduling';

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
  /**
   * Client-minted idempotency key — one per ARMED selection, reused across
   * retries of it. The server uses it as the appointment id, so a commit
   * whose response was lost replays as success instead of bouncing
   * `slot_unavailable` off its own busy write.
   */
  readonly attemptId: string;
  /**
   * Who the shop calls about this booking — the account's own details unless
   * the booker overrode them for this one, plus anything the shop should
   * know before the chair. Omitted by a client that has none.
   *
   * The server re-validates it and stores it as a SNAPSHOT on the
   * appointment; it carries no authority (ownership is the token's job).
   */
  readonly contact?: BookingContactProps;
}

/**
 * A move: the appointment being moved, plus the placement it is moving to.
 *
 * The seats are shaped exactly like a commit's — a reschedule IS the same
 * cart at a different time, and the server re-decides it from scratch.
 */
export interface RescheduleBookingRequest {
  readonly appointmentId: string;
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

export interface CancelAppointmentRequest {
  readonly appointmentId: string;
  /** Optional; the server substitutes its own default when empty. */
  readonly reason: string;
}

/**
 * The only way a client creates — or cancels — an appointment.
 *
 * There is deliberately no browser write path in either direction:
 * `firestore.rules` refuses every direct write on `appointments`, and the
 * repository's `save()` refuses outright. Everything a booking needs to be
 * correct — that the price is the catalog's, that the barber is rostered,
 * that nobody else took the slot — can only be checked where the client
 * cannot reach. Cancellation is server-side for the projection's sake: the
 * public `barberBusy` doc has to be recomputed when a slot frees, and a
 * client status flip would leave it blocked forever.
 */
export interface BookingGateway {
  commit(
    request: CommitBookingRequest,
  ): Promise<Result<CommittedBooking, BookingGatewayError>>;

  cancel(
    request: CancelAppointmentRequest,
  ): Promise<Result<void, BookingGatewayError>>;

  /**
   * Move an existing appointment to a new time — the same booking, not a new
   * one. Atomic on the server: same id, same status, same contact, or
   * nothing at all.
   */
  reschedule(
    request: RescheduleBookingRequest,
  ): Promise<Result<CommittedBooking, BookingGatewayError>>;
}

export const BOOKING_GATEWAY = new InjectionToken<BookingGateway>(
  'BookingGateway',
);
