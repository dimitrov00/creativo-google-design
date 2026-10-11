import type { GuestId, SeatKeyText } from '../primitives/ids.primitive';
import type { SchedulingError } from './scheduling-errors.data';

/**
 * What the booking wizard (`BookingFlowSystem.next`) can refuse — the
 * `BOOKING_FLOW_*` codes (Law 7.5, flatten-spec §4.2; the legacy
 * `booking.flow.*` codes of `application/booking/src/lib/flow/booking-flow.errors.ts`
 * until Phase 4 flips the client). The one domain refusal the flow passes
 * through unchanged is the party's duplicate label
 * (`SCHEDULING_BOOKING_PARTY_DUPLICATE_LABEL`), which has its own copy; it
 * rides in {@link BookingFlowError} as the scheduling struct it is.
 *
 * Every non-`errorCode` field is an i18n parameter: an i18n-safe scalar. The
 * two wrapping errors (`INVALID_GUEST`, `INVALID_CART_OPERATION`) carry the
 * wrapped refusal's CODE, never the struct.
 */

/** Error codes — the ONLY source of these strings; the UI translates them. */
export const BookingFlowErrorCode = {
  /** An event the current step has no arm for — a mis-wired control. */
  InvalidTransition: 'BOOKING_FLOW_INVALID_TRANSITION',
  /** A guest label the party refused (blank, over the `SeatLabel` ceiling). */
  InvalidGuest: 'BOOKING_FLOW_INVALID_GUEST',
  GuestNotFound: 'BOOKING_FLOW_GUEST_NOT_FOUND',
  /** The party is at capacity — a real rejection, not a hidden button. */
  PartyFull: 'BOOKING_FLOW_PARTY_FULL',
  /** Leaving the services step with nothing in the bag. */
  EmptyCart: 'BOOKING_FLOW_EMPTY_CART',
  /** Someone in the party is booking nothing — a person the shop never hears about. */
  SeatWithoutService: 'BOOKING_FLOW_SEAT_WITHOUT_SERVICE',
  /** The flexible declaration already names as many days as it may. */
  FlexibleDaysFull: 'BOOKING_FLOW_FLEXIBLE_DAYS_FULL',
  /** Asking to be waitlisted without naming a day is asking for nothing. */
  NoFlexibleDays: 'BOOKING_FLOW_NO_FLEXIBLE_DAYS',
  /** A cart operation named a line the seat does not hold. */
  InvalidCartOperation: 'BOOKING_FLOW_INVALID_CART_OPERATION',
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
  /** `from` is the step the wizard was on, `event` the event it had no arm for. */
  invalidTransition(
    from: string,
    event: string,
  ): BookingFlowError.InvalidTransition {
    return { errorCode: BookingFlowErrorCode.InvalidTransition, from, event };
  },
  /** `reasonCode` is the code of the label refusal underneath. */
  invalidGuest(reasonCode: string): BookingFlowError.InvalidGuest {
    return { errorCode: BookingFlowErrorCode.InvalidGuest, reasonCode };
  },
  guestNotFound(guestId: GuestId): BookingFlowError.GuestNotFound {
    return { errorCode: BookingFlowErrorCode.GuestNotFound, guestId };
  },
  partyFull(max: number): BookingFlowError.PartyFull {
    return { errorCode: BookingFlowErrorCode.PartyFull, max };
  },
  emptyCart(): BookingFlowError.EmptyCart {
    return { errorCode: BookingFlowErrorCode.EmptyCart };
  },
  seatWithoutService(
    seatKey: SeatKeyText,
  ): BookingFlowError.SeatWithoutService {
    return { errorCode: BookingFlowErrorCode.SeatWithoutService, seatKey };
  },
  flexibleDaysFull(max: number): BookingFlowError.FlexibleDaysFull {
    return { errorCode: BookingFlowErrorCode.FlexibleDaysFull, max };
  },
  noFlexibleDays(): BookingFlowError.NoFlexibleDays {
    return { errorCode: BookingFlowErrorCode.NoFlexibleDays };
  },
  /** `reasonCode` is the cart refusal's code (`SCHEDULING_BOOKING_CART_*`). */
  invalidCartOperation(
    reasonCode: string,
  ): BookingFlowError.InvalidCartOperation {
    return {
      errorCode: BookingFlowErrorCode.InvalidCartOperation,
      reasonCode,
    };
  },

  /** Narrows an error to one code, the passed-through scheduling one included. */
  is<K extends BookingFlowError['errorCode']>(
    error: BookingFlowError,
    errorCode: K,
  ): error is Extract<BookingFlowError, { readonly errorCode: K }> {
    return error.errorCode === errorCode;
  },
} as const;

export namespace BookingFlowError {
  export type InvalidTransition = {
    readonly errorCode: typeof BookingFlowErrorCode.InvalidTransition;
    readonly from: string;
    readonly event: string;
  };
  export type InvalidGuest = {
    readonly errorCode: typeof BookingFlowErrorCode.InvalidGuest;
    readonly reasonCode: string;
  };
  export type GuestNotFound = {
    readonly errorCode: typeof BookingFlowErrorCode.GuestNotFound;
    readonly guestId: GuestId;
  };
  export type PartyFull = {
    readonly errorCode: typeof BookingFlowErrorCode.PartyFull;
    readonly max: number;
  };
  export type EmptyCart = {
    readonly errorCode: typeof BookingFlowErrorCode.EmptyCart;
  };
  export type SeatWithoutService = {
    readonly errorCode: typeof BookingFlowErrorCode.SeatWithoutService;
    readonly seatKey: SeatKeyText;
  };
  export type FlexibleDaysFull = {
    readonly errorCode: typeof BookingFlowErrorCode.FlexibleDaysFull;
    readonly max: number;
  };
  export type NoFlexibleDays = {
    readonly errorCode: typeof BookingFlowErrorCode.NoFlexibleDays;
  };
  export type InvalidCartOperation = {
    readonly errorCode: typeof BookingFlowErrorCode.InvalidCartOperation;
    readonly reasonCode: string;
  };
}
