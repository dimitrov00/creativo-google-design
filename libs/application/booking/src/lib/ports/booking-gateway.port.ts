import { InjectionToken } from '@angular/core';
import { DomainError, Result } from '@creativo/domain/kernel';
import type {
  BookingContactProps,
  CancellationReasonKind,
} from '@creativo/domain/scheduling';

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
  /**
   * What the client ASKED for, beside the barber they were given. Absent
   * reads as `specific` server-side — the conservative default, because it
   * means staff phone before moving the booking rather than moving it
   * silently. See `Seat.pref`.
   */
  readonly barberPref?: 'any' | 'specific';
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
  /**
   * The visit this booking was made from — set when the client arrived here
   * from a previous appointment (a confirmation, a reminder, or "book again"
   * in their history) rather than cold.
   *
   * It carries no authority and the server drops it if it does not parse. It
   * exists because REBOOKING RATE — the strongest retention signal a shop
   * has — cannot be reconstructed afterwards: two visits six weeks apart look
   * identical whether one led to the other or not.
   */
  readonly bookedFromAppointmentId?: string | null;
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

  /**
   * A STAFF lifecycle move — confirm / complete / no-show / shop-cancel.
   * Role-checked and audited server-side; the graph (`canTransition`) is
   * the only law it applies.
   */
  transition(
    request: TransitionAppointmentRequest,
  ): Promise<Result<void, BookingGatewayError>>;

  /**
   * Stamp the moment the party walked in.
   *
   * Separate from `transition` because arrival is not an edge in the
   * lifecycle graph — it is a fact recorded alongside the status, and it
   * survives every later move. Idempotent server-side: the first stamp wins.
   */
  markArrived(
    appointmentId: string,
  ): Promise<Result<void, BookingGatewayError>>;

  /**
   * Move, resize, re-price, re-time or re-chair an appointment — the shop's
   * own pen on its own book.
   *
   * Separate from `reschedule` because four of that path's rules are the
   * CLIENT's and every one of them is wrong here: the cancellation window,
   * the ownership check, the rostered window, and the refusal to touch a
   * party where one guest is already served. What is left after removing them
   * is not a reschedule.
   */
  staffEdit(
    request: StaffEditAppointmentRequest,
  ): Promise<Result<StaffEditedAppointment, BookingGatewayError>>;
}

/**
 * What the shop is doing to one of its own appointments.
 *
 * A DISCRIMINATED command, never a `PATCH` of two timestamps. Five acts, and
 * a patch could carry only two of them: a chair swap and a discount are not
 * timestamps in any encoding, and collapsing the three that are would lose
 * the only thing that makes a refusal actionable — WHICH edge is in the way.
 * "Ivan is busy" is not something a receptionist can act on; "the bottom
 * handle runs into Ivan's 11:00" is.
 *
 * After Ruling B the appointment stores a start and a DURATION, not a start
 * and an end, so the arms line up one-to-one with the gestures that produce
 * them: dragging the block writes `Начало`, dragging a handle writes
 * `Времетраене` (and, for the top handle, both).
 */
export type StaffEditCommand =
  /** Drag the block, or tap a running-late chip: the whole party shifts. */
  | { readonly kind: 'move'; readonly startIso: string }
  /**
   * Drag a handle. `end` holds the start; `start` holds the END and writes
   * both, which is the honest form of "I'll start ten minutes later but still
   * finish at eleven."
   */
  | {
      readonly kind: 'resize';
      readonly edge: 'start' | 'end';
      readonly atIso: string;
    }
  /** A discount or a correction on one seat. Provenance is stored with it. */
  | {
      readonly kind: 'reprice';
      readonly seatId: string;
      readonly priceMinorUnits: number;
    }
  /** The `Времетраене` ladder — one seat, one duration, typed. */
  | {
      readonly kind: 'redurate';
      readonly seatId: string;
      readonly minutes: number;
    }
  /** `⋯ → Смени стола` — one seat changes lane. */
  | {
      readonly kind: 'restaff';
      readonly seatId: string;
      readonly barberId: string;
    };

export interface StaffEditAppointmentRequest {
  readonly appointmentId: string;
  readonly command: StaffEditCommand;
  /**
   * The user saw «Запази въпреки застъпването» and tapped it.
   *
   * The one thing that lets the write land on top of somebody else. Note what
   * has NO field here: placing an appointment outside the rostered window
   * needs no acknowledgement and no second tap, because it is not a refusal
   * staff override — it is simply not the staff rule. See `roster-window.ts`.
   */
  readonly acknowledgedOverlap?: boolean;
  /**
   * The revision the sheet was drawn from.
   *
   * Optional, and its absence is not a claim: a running-late chip has no
   * draft to be stale. When it IS sent and the stored appointment has moved
   * on, the write is refused rather than allowed to overwrite a colleague's
   * save with a screen five minutes old.
   */
  readonly expectedVersion?: number | null;
}

/** What the sheet sends as `expectedVersion` on its next save. */
export interface StaffEditedAppointment {
  readonly appointmentId: string;
  readonly revision: number;
}

export interface TransitionAppointmentRequest {
  readonly appointmentId: string;
  readonly to: 'confirmed' | 'completed' | 'no_show' | 'cancelled';
  /**
   * Required by the server when `to` is `cancelled` — a code from the closed
   * union, never prose. "Why do we lose Saturday mornings" is answerable only
   * if every cancellation carries a groupable code.
   */
  readonly reasonCode?: CancellationReasonKind;
  /** Only read when `reasonCode` is `other`, where the server requires it. */
  readonly note?: string;
  /**
   * Resolve ONE person's seat instead of the whole party.
   *
   * Omitted, the verb applies to every seat still open and the root takes
   * `to` directly — the ordinary single-seat case. Supplied, only that seat
   * is stamped and the root is RE-DERIVED from all of them, which is the only
   * way "two guests served, one absent" is representable at all.
   */
  readonly seatId?: string;
}

export const BOOKING_GATEWAY = new InjectionToken<BookingGateway>(
  'BookingGateway',
);
