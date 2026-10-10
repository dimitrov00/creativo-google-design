import type { SchedulingError } from './scheduling-errors.data';

/**
 * What the booking wizard (`BookingFlowSystem.next`) can refuse — the
 * `booking.flow.*` codes of `application/booking/src/lib/flow/booking-flow.errors.ts`,
 * kept verbatim: every one already has an `errors.booking.flow.*` row in both
 * locale files. The one domain refusal the flow passes through unchanged is
 * the party's duplicate label (`scheduling.booking_party.duplicate_label`),
 * which has its own copy; it rides in {@link BookingFlowError} as the
 * scheduling struct it is.
 *
 * Every non-`code` field is an i18n parameter: an i18n-safe scalar. The two
 * wrapping errors (`invalid_guest`, `invalid_cart_operation`) carry the
 * wrapped refusal's CODE, never the struct.
 */

/** Error codes — the ONLY source of these strings; the UI translates them. */
export const BookingFlowErrorCode = {
  /** An event the current step has no arm for — a mis-wired control. */
  InvalidTransition: 'booking.flow.invalid_transition',
  /** A guest label the party refused (blank, over the `SeatLabel` ceiling). */
  InvalidGuest: 'booking.flow.invalid_guest',
  GuestNotFound: 'booking.flow.guest_not_found',
  /** The party is at capacity — a real rejection, not a hidden button. */
  PartyFull: 'booking.flow.party_full',
  /** Leaving the services step with nothing in the bag. */
  EmptyCart: 'booking.flow.empty_cart',
  /** Someone in the party is booking nothing — a person the shop never hears about. */
  SeatWithoutService: 'booking.flow.seat_without_service',
  /** The flexible declaration already names as many days as it may. */
  FlexibleDaysFull: 'booking.flow.flexible_days_full',
  /** Asking to be waitlisted without naming a day is asking for nothing. */
  NoFlexibleDays: 'booking.flow.no_flexible_days',
  /** A cart operation named a line the seat does not hold. */
  InvalidCartOperation: 'booking.flow.invalid_cart_operation',
} as const;
export type BookingFlowErrorCode =
  (typeof BookingFlowErrorCode)[keyof typeof BookingFlowErrorCode];

export type BookingFlowError =
  | BookingFlowError.InvalidTransition
  | BookingFlowError.InvalidGuest
  | BookingFlowError.GuestNotFound
  | BookingFlowError.PartyFull
  | BookingFlowError.EmptyCart
  | BookingFlowError.SeatWithoutService
  | BookingFlowError.FlexibleDaysFull
  | BookingFlowError.NoFlexibleDays
  | BookingFlowError.InvalidCartOperation
  | SchedulingError.PartyDuplicateLabel;

export const BookingFlowError = {
  invalidTransition(
    from: string,
    event: string,
  ): BookingFlowError.InvalidTransition {
    return { code: BookingFlowErrorCode.InvalidTransition, from, event };
  },
  /** `reasonCode` is the code of the label refusal underneath. */
  invalidGuest(reasonCode: string): BookingFlowError.InvalidGuest {
    return { code: BookingFlowErrorCode.InvalidGuest, reasonCode };
  },
  guestNotFound(guestId: string): BookingFlowError.GuestNotFound {
    return { code: BookingFlowErrorCode.GuestNotFound, guestId };
  },
  partyFull(max: number): BookingFlowError.PartyFull {
    return { code: BookingFlowErrorCode.PartyFull, max };
  },
  emptyCart(): BookingFlowError.EmptyCart {
    return { code: BookingFlowErrorCode.EmptyCart };
  },
  seatWithoutService(seatKey: string): BookingFlowError.SeatWithoutService {
    return { code: BookingFlowErrorCode.SeatWithoutService, seatKey };
  },
  flexibleDaysFull(max: number): BookingFlowError.FlexibleDaysFull {
    return { code: BookingFlowErrorCode.FlexibleDaysFull, max };
  },
  noFlexibleDays(): BookingFlowError.NoFlexibleDays {
    return { code: BookingFlowErrorCode.NoFlexibleDays };
  },
  /** `reasonCode` is the cart refusal's code (`scheduling.booking_cart.*`). */
  invalidCartOperation(
    reasonCode: string,
  ): BookingFlowError.InvalidCartOperation {
    return { code: BookingFlowErrorCode.InvalidCartOperation, reasonCode };
  },

  /** Narrows an error to one code, the passed-through scheduling one included. */
  is<K extends BookingFlowError['code']>(
    error: BookingFlowError,
    code: K,
  ): error is Extract<BookingFlowError, { readonly code: K }> {
    return error.code === code;
  },
} as const;

export namespace BookingFlowError {
  export type InvalidTransition = {
    readonly code: typeof BookingFlowErrorCode.InvalidTransition;
    readonly from: string;
    readonly event: string;
  };
  export type InvalidGuest = {
    readonly code: typeof BookingFlowErrorCode.InvalidGuest;
    readonly reasonCode: string;
  };
  export type GuestNotFound = {
    readonly code: typeof BookingFlowErrorCode.GuestNotFound;
    readonly guestId: string;
  };
  export type PartyFull = {
    readonly code: typeof BookingFlowErrorCode.PartyFull;
    readonly max: number;
  };
  export type EmptyCart = {
    readonly code: typeof BookingFlowErrorCode.EmptyCart;
  };
  export type SeatWithoutService = {
    readonly code: typeof BookingFlowErrorCode.SeatWithoutService;
    readonly seatKey: string;
  };
  export type FlexibleDaysFull = {
    readonly code: typeof BookingFlowErrorCode.FlexibleDaysFull;
    readonly max: number;
  };
  export type NoFlexibleDays = {
    readonly code: typeof BookingFlowErrorCode.NoFlexibleDays;
  };
  export type InvalidCartOperation = {
    readonly code: typeof BookingFlowErrorCode.InvalidCartOperation;
    readonly reasonCode: string;
  };
}
