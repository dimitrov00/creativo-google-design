import type {
  AppointmentId,
  BarberId,
  CartLineId,
  GuestId,
  LocalDate,
  LocationId,
  SeatKeyText,
  ServiceVariantId,
  WaitlistRequestId,
} from '@core/primitives';
import type { BookingCart } from './booking-cart.data';
import type { ScheduleSelection } from './schedule-selection.data';

/**
 * What the booking wizard can be told — the ONLY source of these strings.
 * The union is `BookingFlowEvent`, so the field takes the dictionary's name
 * (`bookingFlowEventKind`, N15).
 */
export const BookingFlowEventKind = {
  AddGuest: 'ADD_GUEST',
  RemoveGuest: 'REMOVE_GUEST',
  RenameGuest: 'RENAME_GUEST',
  AddLine: 'ADD_LINE',
  RemoveLine: 'REMOVE_LINE',
  SetLineVariant: 'SET_LINE_VARIANT',
  SetLineBarber: 'SET_LINE_BARBER',
  /** `null` is the "any shop" answer — a choice, not the absence of one. */
  SelectLocation: 'SELECT_LOCATION',
  SelectSchedule: 'SELECT_SCHEDULE',
  /** Select or deselect a day of the flexible declaration — one tap, one event. */
  ToggleFlexibleDay: 'TOGGLE_FLEXIBLE_DAY',
  /** Back to a single-day pick — drops the whole declaration deliberately. */
  ClearFlexible: 'CLEAR_FLEXIBLE',
  Confirmed: 'CONFIRMED',
  /** The server accepted a standing request. Terminal, like `CONFIRMED`. */
  Waitlisted: 'WAITLISTED',
  Next: 'NEXT',
  Back: 'BACK',
} as const;
export type BookingFlowEventKind =
  (typeof BookingFlowEventKind)[keyof typeof BookingFlowEventKind];

/**
 * One event of the booking wizard (`booking-flow.ts:203-260`), discriminated
 * by `bookingFlowEventKind` — what `BookingFlowSystem.next` steps on. Seats
 * are named by their cart seat key (`'self'`, `'guest-3'`), lines by their
 * `lineId`; a line's barber is `null` for "anyone". Moved out of
 * `booking-flow.system.ts` with its dictionary (pass D, D-7.4), each variant
 * declared once in the namespace.
 */
export type BookingFlowEvent =
  | BookingFlowEvent.AddGuest
  | BookingFlowEvent.RemoveGuest
  | BookingFlowEvent.RenameGuest
  | BookingFlowEvent.AddLine
  | BookingFlowEvent.RemoveLine
  | BookingFlowEvent.SetLineVariant
  | BookingFlowEvent.SetLineBarber
  | BookingFlowEvent.SelectLocation
  | BookingFlowEvent.SelectSchedule
  | BookingFlowEvent.ToggleFlexibleDay
  | BookingFlowEvent.ClearFlexible
  | BookingFlowEvent.Confirmed
  | BookingFlowEvent.Waitlisted
  | BookingFlowEvent.Next
  | BookingFlowEvent.Back;

export namespace BookingFlowEvent {
  export type AddGuest = {
    readonly bookingFlowEventKind: typeof BookingFlowEventKind.AddGuest;
    readonly label: string;
  };
  export type RemoveGuest = {
    readonly bookingFlowEventKind: typeof BookingFlowEventKind.RemoveGuest;
    readonly guestId: GuestId;
  };
  export type RenameGuest = {
    readonly bookingFlowEventKind: typeof BookingFlowEventKind.RenameGuest;
    readonly guestId: GuestId;
    readonly label: string;
  };
  export type AddLine = {
    readonly bookingFlowEventKind: typeof BookingFlowEventKind.AddLine;
    readonly seatKey: SeatKeyText;
    readonly line: BookingCart.NewLine;
  };
  export type RemoveLine = {
    readonly bookingFlowEventKind: typeof BookingFlowEventKind.RemoveLine;
    readonly seatKey: SeatKeyText;
    readonly lineId: CartLineId;
  };
  export type SetLineVariant = {
    readonly bookingFlowEventKind: typeof BookingFlowEventKind.SetLineVariant;
    readonly seatKey: SeatKeyText;
    readonly lineId: CartLineId;
    readonly variantId: ServiceVariantId | null;
  };
  export type SetLineBarber = {
    readonly bookingFlowEventKind: typeof BookingFlowEventKind.SetLineBarber;
    readonly seatKey: SeatKeyText;
    readonly lineId: CartLineId;
    readonly barberId: BarberId | null;
  };
  export type SelectLocation = {
    readonly bookingFlowEventKind: typeof BookingFlowEventKind.SelectLocation;
    readonly locationId: LocationId | null;
  };
  export type SelectSchedule = {
    readonly bookingFlowEventKind: typeof BookingFlowEventKind.SelectSchedule;
    readonly selection: ScheduleSelection;
  };
  export type ToggleFlexibleDay = {
    readonly bookingFlowEventKind: typeof BookingFlowEventKind.ToggleFlexibleDay;
    readonly localDate: LocalDate;
  };
  export type ClearFlexible = {
    readonly bookingFlowEventKind: typeof BookingFlowEventKind.ClearFlexible;
  };
  export type Confirmed = {
    readonly bookingFlowEventKind: typeof BookingFlowEventKind.Confirmed;
    readonly appointmentId: AppointmentId;
  };
  export type Waitlisted = {
    readonly bookingFlowEventKind: typeof BookingFlowEventKind.Waitlisted;
    readonly requestId: WaitlistRequestId;
  };
  export type Next = {
    readonly bookingFlowEventKind: typeof BookingFlowEventKind.Next;
  };
  export type Back = {
    readonly bookingFlowEventKind: typeof BookingFlowEventKind.Back;
  };
}
