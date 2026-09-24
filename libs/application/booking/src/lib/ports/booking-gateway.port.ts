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
  /**
   * STAFF PLACEMENT (owner ruling 2026-08-07 #3, built 2026-09-08). Absent,
   * the caller books for themselves. A user id books ON BEHALF OF that
   * client; `null` books a walk-in nobody owns (guest seats only). Either
   * form is refused for a caller who does not work the book, and both
   * relax lead time and roster containment — the shop places its own book.
   */
  readonly onBehalfOfUserId?: string | null;
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
   * The inverse of `markArrived` — the stamp taken back, for the undo that
   * follows a mis-tap. Same gate as setting it: live visits only.
   */
  clearArrival(
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

  /**
   * Record — or clear — what one seat was tipped.
   *
   * Deliberately NOT a `staffEdit` command. That path rebuilds the booking
   * and refuses any appointment that is no longer cancellable, so it can
   * touch every visit except the finished ones — which are the only visits
   * a tip is ever recorded on. This is a stamp beside the status, the same
   * shape as `markArrived`.
   */
  recordTip(
    request: RecordSeatTipRequest,
  ): Promise<Result<void, BookingGatewayError>>;
}

export interface RecordSeatTipRequest {
  readonly appointmentId: string;
  /** WHOSE tip — a party can be two barbers and two answers. */
  readonly seatId: string;
  /** `null` clears the recording, which is not the same as a zero tip. */
  readonly amountMinorUnits: number | null;
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
  /**
   * Drag the block, or tap a running-late chip.
   *
   * `seatIds` NAMES THE SEATS THAT SHIFT; omitting it moves the whole party,
   * which is the ordinary case and the only one that existed before.
   *
   * A party is one appointment drawn as one block PER CHAIR, so "the block"
   * is ambiguous the moment two barbers are involved: a father with Ivan and
   * his son with Stefan are two blocks, and dragging Stefan's used to shift
   * Ivan's with it because a move could only ever mean the envelope. Stefan
   * taking an urgent call has to be able to move his own half and leave the
   * father where he is — the domain has always allowed it (`Seat.startsAt` is
   * per-seat and `Appointment.timeSlot` is derived from the seats), and this
   * is the arm that lets a caller ask for it.
   *
   * The delta is measured from the SCOPE's own start, not the party's, so the
   * seat named lands exactly where it was dropped.
   */
  | {
      readonly kind: 'move';
      readonly startIso: string;
      readonly seatIds?: readonly string[];
    }
  /**
   * Drag a handle. `end` holds the start; `start` holds the END and writes
   * both, which is the honest form of "I'll start ten minutes later but still
   * finish at eleven."
   *
   * `seatIds` scopes the edge the same way, and for the same reason: the
   * envelope's end belongs to whichever seat runs latest, so an unscoped
   * resize of a split party stretched a leg in a chair nobody had touched.
   */
  | {
      readonly kind: 'resize';
      readonly edge: 'start' | 'end';
      readonly atIso: string;
      readonly seatIds?: readonly string[];
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
    }
  /**
   * «Салон» — the visit moved to the shop's other location, the whole
   * party with it: `Appointment.locationId` is the ROOT's, one visit is
   * one physical place whatever chairs it spans. The decision re-reads
   * the new shop's hours and zone and refuses a service that shop does
   * not offer (`service_not_at_location`), which is the only rule a
   * relocation can break.
   */
  | {
      readonly kind: 'relocate';
      readonly locationId: string;
    }
  /**
   * A service ADDED to the visit — a new seat, priced and timed by the
   * catalogue on the server (never by the client). `minutes` is what the
   * client believes the catalogue says, used only so the rest of the batch's
   * geometry (a `resize` after it) agrees with the seat it just added; the
   * stored terms come from `decideBooking`. `seatId` is minted by the client
   * so a later command in the same batch can address the seat.
   */
  | {
      readonly kind: 'addSeat';
      readonly seatId: string;
      readonly serviceId: string;
      readonly variantId?: string | null;
      readonly barberId: string;
      readonly startIso: string;
      readonly minutes: number;
      readonly subject:
        | { readonly kind: 'self' }
        | { readonly kind: 'guest'; readonly label: string };
    }
  /** A service REMOVED. Refused for a resolved seat and for the last one. */
  | {
      readonly kind: 'removeSeat';
      readonly seatId: string;
    }
  /**
   * The discounts on the BILL — the whole set, replaced.
   *
   * The whole visit's, never a seat's: the evaluator takes the cart's
   * subtotal and `DiscountInput` names no line, so this is a fact about
   * what is owed rather than about any chair. The server RESOLVES what is
   * named — a grant must be the client's own and still usable, a code must
   * open an enabled coupon, a manual figure needs a role that handles money
   * — and snapshots the value it found; a discount already on the visit is
   * kept as stored rather than re-resolved, because a promise once kept is
   * not withdrawn by a coupon retired since. The set must be LEGAL: an
   * exclusive coupon alone, no promise twice, one manual figure at most.
   * An empty list takes every discount off.
   */
  | {
      readonly kind: 'discounts';
      readonly discounts: readonly StaffDiscountRequest[];
    }
  /**
   * The gift vouchers PAYING for the bill — the whole set, by code, in the
   * order they cover it. Each voucher settles what the ones before it left,
   * never more than its balance; the server reads and writes the balances
   * inside the same transaction as the visit, gives back what a voucher no
   * longer named had paid, and refuses a code that opens nothing or a
   * voucher with nothing left. An empty list gives everything back.
   */
  | {
      readonly kind: 'vouchers';
      readonly codes: readonly string[];
    };

/**
 * What the sheet asks to take off the bill. Three arms, two of them a
 * REFERENCE the server resolves and one a VALUE the server checks the
 * caller may author (see `handlesMoney`).
 */
export type StaffDiscountRequest =
  | { readonly source: 'grant'; readonly grantId: string }
  | { readonly source: 'code'; readonly code: string }
  | {
      readonly source: 'manual';
      readonly value:
        | { readonly kind: 'percent_off'; readonly percent: number }
        | { readonly kind: 'fixed_amount'; readonly amountMinorUnits: number };
    };

export interface StaffEditAppointmentRequest {
  readonly appointmentId: string;
  /**
   * One command, or SEVERAL applied together.
   *
   * The single form is a GESTURE — a drag, a handle, one row of a menu — and
   * it is what every caller sent while the sheet's only writes were gestures.
   * A `Запази` is not a gesture: it is a day, a start, a duration and a
   * leg's price arriving as ONE intent, and sending them as four requests
   * would be four placement decisions, four chances to be refused halfway,
   * and a booking left in a state nobody asked for when the third fails.
   *
   * An array is folded over the stored seats in order and decided ONCE, so
   * the whole save lands or none of it does.
   */
  readonly command: StaffEditCommand | readonly StaffEditCommand[];
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
   * Read when `to` is `cancelled` — a code from the closed union, never
   * prose. "Why do we lose Saturday mornings" is answerable only if every
   * cancellation carries a groupable code, which is why leaving it out does
   * not leave a hole: the server files the cancellation as `unspecified`
   * (owner, 2026-09-11 — a barber between cuts may not have the time).
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
