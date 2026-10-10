/**
 * The scheduling context's error codes — the 51 `DomainError` subclasses of
 * `libs/domain/scheduling/src/lib/*.errors.ts` collapsed into ONE `as const`
 * dictionary (blueprint §2.1). Every code is dotted; the codes keep their
 * legacy strings except `booking.contact.*`, which move under the context
 * prefix (`scheduling.booking_contact.*`) so they stop sharing the
 * `booking.contact.*` namespace with the contact sheet's UI copy. Their
 * en/bg rows sit at `errors.scheduling.booking_contact.*`, beside the legacy
 * `booking.contact.*` rows the domain class raises until Phase 4 deletes it.
 * `appointment.not_arrivable` keeps its key, as the blueprint rules.
 *
 * Dropped with their subjects: `scheduling.barber_day.block_collision`
 * (barber-day.ts is deleted), `scheduling.time_slot.invalid_range` (TimeSlot
 * is `TimeInterval`) and `scheduling.time_of_day.invalid` (no `'HH:mm'`
 * struct survives — minutes of day are integers).
 *
 * Every non-`code` field is an i18n parameter, so each is an i18n-safe
 * scalar (a string, a number or `null`). A field that names a state or a
 * kind is typed by that tag's dictionary (`BookingState`, `SeatOutcomeKind`,
 * `WaitlistState`, `ExceptionEffectKind`), so only a real tag fits it.
 */
import type { BookingState } from './booking-status.data';
import type { ExceptionEffectKind } from './exception-effect.data';
import type { SeatOutcomeKind } from './seat-outcome.data';
import type { WaitlistState } from './waitlist-status.data';

/** Error codes — the ONLY source of these strings; the UI translates them. */
export const SchedulingErrorCode = {
  AppointmentEmptySeats: 'scheduling.appointment.empty_seats',
  AppointmentMultipleSelfSeats: 'scheduling.appointment.multiple_self_seats',
  AppointmentPastStartTime: 'scheduling.appointment.past_start_time',
  AppointmentBarberDoubleBooked: 'scheduling.appointment.barber_double_booked',
  AppointmentMixedCurrency: 'scheduling.appointment.mixed_currency',
  AppointmentInvalidTransition: 'scheduling.appointment.invalid_transition',
  AppointmentReopenWindowClosed: 'scheduling.appointment.reopen_window_closed',
  AppointmentEmptyCancellationReason:
    'scheduling.appointment.empty_cancellation_reason',
  AppointmentUnknownSeat: 'scheduling.appointment.unknown_seat',
  AppointmentSeatAlreadyResolved:
    'scheduling.appointment.seat_already_resolved',
  /** Already dotted in the legacy code; keeps its i18n key unchanged. */
  AppointmentNotArrivable: 'appointment.not_arrivable',
  ContactEmptyName: 'scheduling.booking_contact.empty_name',
  ContactInvalidPhone: 'scheduling.booking_contact.invalid_phone',
  ContactInvalidEmail: 'scheduling.booking_contact.invalid_email',
  ContactNoteTooLong: 'scheduling.booking_contact.note_too_long',
  SeatLabelEmpty: 'scheduling.seat_label.empty',
  SeatLabelTooLong: 'scheduling.seat_label.too_long',
  CartLineNotFound: 'scheduling.booking_cart.line_not_found',
  CartDuplicateService: 'scheduling.booking_cart.duplicate_service',
  CartInvalidLineSequence: 'scheduling.booking_cart.invalid_line_sequence',
  PartyGuestNotFound: 'scheduling.booking_party.guest_not_found',
  PartyInvalidGuestSequence: 'scheduling.booking_party.invalid_guest_sequence',
  PartyUnclaimed: 'scheduling.booking_party.unclaimed',
  PartyDuplicateLabel: 'scheduling.booking_party.duplicate_label',
  BookingPolicyInvalid: 'scheduling.booking_policy.invalid',
  CancellationWindowInvalid: 'scheduling.cancellation_window.invalid',
  ClientStatsPolicyInvalid: 'scheduling.client_stats_policy.invalid',
  CalendarDayInvalid: 'scheduling.calendar_day.invalid',
  DateRangeInvalid: 'scheduling.date_range.invalid',
  TimeRangeInvalid: 'scheduling.time_range.invalid',
  IdEmpty: 'scheduling.id.empty',
  FlexibleWhenFull: 'scheduling.flexible_when.full',
  RecurrenceInvalidInterval: 'scheduling.recurrence.invalid_interval',
  RecurrenceNoWeekdays: 'scheduling.recurrence.no_weekdays',
  RecurrenceInvalidDay: 'scheduling.recurrence.invalid_day',
  RecurrenceInvalidCount: 'scheduling.recurrence.invalid_count',
  RecurrenceEndsBeforeStart: 'scheduling.recurrence.ends_before_start',
  RecurrenceNeverOccurs: 'scheduling.recurrence.never_occurs',
  RecurrenceTooLong: 'scheduling.recurrence.too_long',
  ShiftSegmentInvalidLocation: 'scheduling.shift_segment.invalid_location',
  ShiftSegmentImpossibleTransfer:
    'scheduling.shift_segment.impossible_transfer',
  StaffScheduleOverlappingVersions:
    'scheduling.staff_schedule.overlapping_versions',
  StaffScheduleRetroactiveAmendment:
    'scheduling.staff_schedule.retroactive_amendment',
  WaitlistInvalid: 'scheduling.waitlist.invalid',
  WaitlistNoDays: 'scheduling.waitlist.no_days',
  WaitlistEmptyCart: 'scheduling.waitlist.empty_cart',
  WaitlistInvalidTransition: 'scheduling.waitlist.invalid_transition',
  ScheduleExceptionEmptyRanges: 'scheduling.schedule_exception.empty_ranges',
} as const;
export type SchedulingErrorCode =
  (typeof SchedulingErrorCode)[keyof typeof SchedulingErrorCode];

export type SchedulingError =
  | SchedulingError.AppointmentEmptySeats
  | SchedulingError.AppointmentMultipleSelfSeats
  | SchedulingError.AppointmentPastStartTime
  | SchedulingError.AppointmentBarberDoubleBooked
  | SchedulingError.AppointmentMixedCurrency
  | SchedulingError.AppointmentInvalidTransition
  | SchedulingError.AppointmentReopenWindowClosed
  | SchedulingError.AppointmentEmptyCancellationReason
  | SchedulingError.AppointmentUnknownSeat
  | SchedulingError.AppointmentSeatAlreadyResolved
  | SchedulingError.AppointmentNotArrivable
  | SchedulingError.ContactEmptyName
  | SchedulingError.ContactInvalidPhone
  | SchedulingError.ContactInvalidEmail
  | SchedulingError.ContactNoteTooLong
  | SchedulingError.SeatLabelEmpty
  | SchedulingError.SeatLabelTooLong
  | SchedulingError.CartLineNotFound
  | SchedulingError.CartDuplicateService
  | SchedulingError.CartInvalidLineSequence
  | SchedulingError.PartyGuestNotFound
  | SchedulingError.PartyInvalidGuestSequence
  | SchedulingError.PartyUnclaimed
  | SchedulingError.PartyDuplicateLabel
  | SchedulingError.BookingPolicyInvalid
  | SchedulingError.CancellationWindowInvalid
  | SchedulingError.ClientStatsPolicyInvalid
  | SchedulingError.CalendarDayInvalid
  | SchedulingError.DateRangeInvalid
  | SchedulingError.TimeRangeInvalid
  | SchedulingError.IdEmpty
  | SchedulingError.FlexibleWhenFull
  | SchedulingError.RecurrenceInvalidInterval
  | SchedulingError.RecurrenceNoWeekdays
  | SchedulingError.RecurrenceInvalidDay
  | SchedulingError.RecurrenceInvalidCount
  | SchedulingError.RecurrenceEndsBeforeStart
  | SchedulingError.RecurrenceNeverOccurs
  | SchedulingError.RecurrenceTooLong
  | SchedulingError.ShiftSegmentInvalidLocation
  | SchedulingError.ShiftSegmentImpossibleTransfer
  | SchedulingError.StaffScheduleOverlappingVersions
  | SchedulingError.StaffScheduleRetroactiveAmendment
  | SchedulingError.WaitlistInvalid
  | SchedulingError.WaitlistNoDays
  | SchedulingError.WaitlistEmptyCart
  | SchedulingError.WaitlistInvalidTransition
  | SchedulingError.ScheduleExceptionEmptyRanges;

const C = SchedulingErrorCode;

export const SchedulingError = {
  /** An appointment must hold at least one seat. */
  appointmentEmptySeats(): SchedulingError.AppointmentEmptySeats {
    return { code: C.AppointmentEmptySeats };
  },
  /** The booker cannot hold two seats at the same time. */
  appointmentMultipleSelfSeats(): SchedulingError.AppointmentMultipleSelfSeats {
    return { code: C.AppointmentMultipleSelfSeats };
  },
  /** A new appointment cannot start in the past. */
  appointmentPastStartTime(): SchedulingError.AppointmentPastStartTime {
    return { code: C.AppointmentPastStartTime };
  },
  /**
   * Two seats want the same barber at overlapping times. The same barber on
   * two seats that do NOT overlap («father and son, back to back») is legal.
   */
  appointmentBarberDoubleBooked(
    barberId: string,
  ): SchedulingError.AppointmentBarberDoubleBooked {
    return { code: C.AppointmentBarberDoubleBooked, barberId };
  },
  /** Seats priced in two currencies — a data error, never a feature. */
  appointmentMixedCurrency(
    expected: string,
    found: string,
  ): SchedulingError.AppointmentMixedCurrency {
    return { code: C.AppointmentMixedCurrency, expected, found };
  },
  appointmentInvalidTransition(
    from: BookingState,
    to: BookingState,
  ): SchedulingError.AppointmentInvalidTransition {
    return { code: C.AppointmentInvalidTransition, from, to };
  },
  /** A settled visit may only be reopened on its own day. */
  appointmentReopenWindowClosed(
    from: BookingState,
  ): SchedulingError.AppointmentReopenWindowClosed {
    return { code: C.AppointmentReopenWindowClosed, from };
  },
  appointmentEmptyCancellationReason(): SchedulingError.AppointmentEmptyCancellationReason {
    return { code: C.AppointmentEmptyCancellationReason };
  },
  /** A seat outcome addressed to a seat this appointment does not hold. */
  appointmentUnknownSeat(
    seatId: string,
  ): SchedulingError.AppointmentUnknownSeat {
    return { code: C.AppointmentUnknownSeat, seatId };
  },
  /**
   * A seat's outcome is written ONCE: it carries the instant it was decided,
   * and every downstream number is keyed on that instant.
   */
  appointmentSeatAlreadyResolved(
    seatId: string,
    outcome: SeatOutcomeKind,
  ): SchedulingError.AppointmentSeatAlreadyResolved {
    return { code: C.AppointmentSeatAlreadyResolved, seatId, outcome };
  },
  /** Arriving is only a fact while the visit is still live. */
  appointmentNotArrivable(
    status: BookingState,
  ): SchedulingError.AppointmentNotArrivable {
    return { code: C.AppointmentNotArrivable, status };
  },
  /** The name the shop will call out. Empty is not a person. */
  contactEmptyName(): SchedulingError.ContactEmptyName {
    return { code: C.ContactEmptyName };
  },
  /** The phone did not parse — the shop's only reliable way to reach someone. */
  contactInvalidPhone(rawValue: string): SchedulingError.ContactInvalidPhone {
    return { code: C.ContactInvalidPhone, rawValue };
  },
  /** Optional overall, but not optionally valid. */
  contactInvalidEmail(rawValue: string): SchedulingError.ContactInvalidEmail {
    return { code: C.ContactInvalidEmail, rawValue };
  },
  contactNoteTooLong(maxLength: number): SchedulingError.ContactNoteTooLong {
    return { code: C.ContactNoteTooLong, maxLength };
  },
  seatLabelEmpty(): SchedulingError.SeatLabelEmpty {
    return { code: C.SeatLabelEmpty };
  },
  seatLabelTooLong(max: number): SchedulingError.SeatLabelTooLong {
    return { code: C.SeatLabelTooLong, max };
  },
  cartLineNotFound(
    seatKey: string,
    lineId: string,
  ): SchedulingError.CartLineNotFound {
    return { code: C.CartLineNotFound, seatKey, lineId };
  },
  /** Nobody has two haircuts in one visit — the second belongs to another seat. */
  cartDuplicateService(
    seatKey: string,
    serviceId: string,
  ): SchedulingError.CartDuplicateService {
    return { code: C.CartDuplicateService, seatKey, serviceId };
  },
  cartInvalidLineSequence(
    value: number,
  ): SchedulingError.CartInvalidLineSequence {
    return { code: C.CartInvalidLineSequence, value };
  },
  partyGuestNotFound(guestId: string): SchedulingError.PartyGuestNotFound {
    return { code: C.PartyGuestNotFound, guestId };
  },
  partyInvalidGuestSequence(
    value: number,
  ): SchedulingError.PartyInvalidGuestSequence {
    return { code: C.PartyInvalidGuestSequence, value };
  },
  /** The party has no owner yet — sign in to confirm. */
  partyUnclaimed(): SchedulingError.PartyUnclaimed {
    return { code: C.PartyUnclaimed };
  },
  /** Another guest already answers to this label — one label, one guest. */
  partyDuplicateLabel(label: string): SchedulingError.PartyDuplicateLabel {
    return { code: C.PartyDuplicateLabel, label };
  },
  bookingPolicyInvalid(
    field: string,
    rawValue: number,
  ): SchedulingError.BookingPolicyInvalid {
    return { code: C.BookingPolicyInvalid, field, rawValue };
  },
  cancellationWindowInvalid(
    rawValue: number,
  ): SchedulingError.CancellationWindowInvalid {
    return { code: C.CancellationWindowInvalid, rawValue };
  },
  clientStatsPolicyInvalid(
    field: string,
    rawValue: number,
  ): SchedulingError.ClientStatsPolicyInvalid {
    return { code: C.ClientStatsPolicyInvalid, field, rawValue };
  },
  calendarDayInvalid(rawValue: string): SchedulingError.CalendarDayInvalid {
    return { code: C.CalendarDayInvalid, rawValue };
  },
  dateRangeInvalid(from: string, to: string): SchedulingError.DateRangeInvalid {
    return { code: C.DateRangeInvalid, from, to };
  },
  /** A wall-clock span that is empty, backwards, outside 0…1440 or overlapping its neighbour. */
  timeRangeInvalid(
    startMinutes: number,
    endMinutes: number,
  ): SchedulingError.TimeRangeInvalid {
    return { code: C.TimeRangeInvalid, startMinutes, endMinutes };
  },
  idEmpty(idType: string): SchedulingError.IdEmpty {
    return { code: C.IdEmpty, idType };
  },
  /** A flexible request covers at most `max` days. */
  flexibleWhenFull(max: number): SchedulingError.FlexibleWhenFull {
    return { code: C.FlexibleWhenFull, max };
  },
  recurrenceInvalidInterval(
    interval: number,
    max: number,
  ): SchedulingError.RecurrenceInvalidInterval {
    return { code: C.RecurrenceInvalidInterval, interval, max };
  },
  recurrenceNoWeekdays(): SchedulingError.RecurrenceNoWeekdays {
    return { code: C.RecurrenceNoWeekdays };
  },
  /** `month` is `null` for a monthly rule's day, the month for a yearly one. */
  recurrenceInvalidDay(
    month: number | null,
    date: number,
  ): SchedulingError.RecurrenceInvalidDay {
    return { code: C.RecurrenceInvalidDay, month, date };
  },
  recurrenceInvalidCount(
    count: number,
    max: number,
  ): SchedulingError.RecurrenceInvalidCount {
    return { code: C.RecurrenceInvalidCount, count, max };
  },
  recurrenceEndsBeforeStart(
    start: string,
    until: string,
  ): SchedulingError.RecurrenceEndsBeforeStart {
    return { code: C.RecurrenceEndsBeforeStart, start, until };
  },
  recurrenceNeverOccurs(start: string): SchedulingError.RecurrenceNeverOccurs {
    return { code: C.RecurrenceNeverOccurs, start };
  },
  recurrenceTooLong(max: number): SchedulingError.RecurrenceTooLong {
    return { code: C.RecurrenceTooLong, max };
  },
  shiftSegmentInvalidLocation(
    rawLocationId: string,
  ): SchedulingError.ShiftSegmentInvalidLocation {
    return { code: C.ShiftSegmentInvalidLocation, rawLocationId };
  },
  /**
   * Two consecutive segments at different shops leave less than the travel
   * time between them — the barber cannot be in both places.
   */
  shiftSegmentImpossibleTransfer(
    weekday: number,
    fromLocationId: string,
    toLocationId: string,
    gapMinutes: number,
    requiredMinutes: number,
  ): SchedulingError.ShiftSegmentImpossibleTransfer {
    return {
      code: C.ShiftSegmentImpossibleTransfer,
      weekday,
      fromLocationId,
      toLocationId,
      gapMinutes,
      requiredMinutes,
    };
  },
  /** Exactly one roster version must be in force on any day. */
  staffScheduleOverlappingVersions(
    earlierFrom: string,
    laterFrom: string,
  ): SchedulingError.StaffScheduleOverlappingVersions {
    return { code: C.StaffScheduleOverlappingVersions, earlierFrom, laterFrom };
  },
  /** A roster cannot be amended from a day at or before the version in force began. */
  staffScheduleRetroactiveAmendment(
    attemptedFrom: string,
    currentFrom: string,
  ): SchedulingError.StaffScheduleRetroactiveAmendment {
    return {
      code: C.StaffScheduleRetroactiveAmendment,
      attemptedFrom,
      currentFrom,
    };
  },
  waitlistInvalid(field: string): SchedulingError.WaitlistInvalid {
    return { code: C.WaitlistInvalid, field };
  },
  waitlistNoDays(): SchedulingError.WaitlistNoDays {
    return { code: C.WaitlistNoDays };
  },
  waitlistEmptyCart(): SchedulingError.WaitlistEmptyCart {
    return { code: C.WaitlistEmptyCart };
  },
  waitlistInvalidTransition(
    from: WaitlistState,
    to: WaitlistState,
  ): SchedulingError.WaitlistInvalidTransition {
    return { code: C.WaitlistInvalidTransition, from, to };
  },
  /** An `hours` or `blocked` effect with no range would silently mean something else. */
  scheduleExceptionEmptyRanges(
    exceptionKind: ExceptionEffectKind,
  ): SchedulingError.ScheduleExceptionEmptyRanges {
    return { code: C.ScheduleExceptionEmptyRanges, exceptionKind };
  },

  /** Narrows an error to one code — `SchedulingError.is(e, SchedulingErrorCode.FlexibleWhenFull)`. */
  is<K extends SchedulingErrorCode>(
    error: SchedulingError,
    code: K,
  ): error is Extract<SchedulingError, { readonly code: K }> {
    return error.code === code;
  },
} as const;

export namespace SchedulingError {
  export type AppointmentEmptySeats = {
    readonly code: typeof SchedulingErrorCode.AppointmentEmptySeats;
  };
  export type AppointmentMultipleSelfSeats = {
    readonly code: typeof SchedulingErrorCode.AppointmentMultipleSelfSeats;
  };
  export type AppointmentPastStartTime = {
    readonly code: typeof SchedulingErrorCode.AppointmentPastStartTime;
  };
  export type AppointmentBarberDoubleBooked = {
    readonly code: typeof SchedulingErrorCode.AppointmentBarberDoubleBooked;
    readonly barberId: string;
  };
  export type AppointmentMixedCurrency = {
    readonly code: typeof SchedulingErrorCode.AppointmentMixedCurrency;
    readonly expected: string;
    readonly found: string;
  };
  export type AppointmentInvalidTransition = {
    readonly code: typeof SchedulingErrorCode.AppointmentInvalidTransition;
    readonly from: BookingState;
    readonly to: BookingState;
  };
  export type AppointmentReopenWindowClosed = {
    readonly code: typeof SchedulingErrorCode.AppointmentReopenWindowClosed;
    readonly from: BookingState;
  };
  export type AppointmentEmptyCancellationReason = {
    readonly code: typeof SchedulingErrorCode.AppointmentEmptyCancellationReason;
  };
  export type AppointmentUnknownSeat = {
    readonly code: typeof SchedulingErrorCode.AppointmentUnknownSeat;
    readonly seatId: string;
  };
  export type AppointmentSeatAlreadyResolved = {
    readonly code: typeof SchedulingErrorCode.AppointmentSeatAlreadyResolved;
    readonly seatId: string;
    readonly outcome: SeatOutcomeKind;
  };
  export type AppointmentNotArrivable = {
    readonly code: typeof SchedulingErrorCode.AppointmentNotArrivable;
    readonly status: BookingState;
  };
  export type ContactEmptyName = {
    readonly code: typeof SchedulingErrorCode.ContactEmptyName;
  };
  export type ContactInvalidPhone = {
    readonly code: typeof SchedulingErrorCode.ContactInvalidPhone;
    readonly rawValue: string;
  };
  export type ContactInvalidEmail = {
    readonly code: typeof SchedulingErrorCode.ContactInvalidEmail;
    readonly rawValue: string;
  };
  export type ContactNoteTooLong = {
    readonly code: typeof SchedulingErrorCode.ContactNoteTooLong;
    readonly maxLength: number;
  };
  export type SeatLabelEmpty = {
    readonly code: typeof SchedulingErrorCode.SeatLabelEmpty;
  };
  export type SeatLabelTooLong = {
    readonly code: typeof SchedulingErrorCode.SeatLabelTooLong;
    readonly max: number;
  };
  export type CartLineNotFound = {
    readonly code: typeof SchedulingErrorCode.CartLineNotFound;
    readonly seatKey: string;
    readonly lineId: string;
  };
  export type CartDuplicateService = {
    readonly code: typeof SchedulingErrorCode.CartDuplicateService;
    readonly seatKey: string;
    readonly serviceId: string;
  };
  export type CartInvalidLineSequence = {
    readonly code: typeof SchedulingErrorCode.CartInvalidLineSequence;
    readonly value: number;
  };
  export type PartyGuestNotFound = {
    readonly code: typeof SchedulingErrorCode.PartyGuestNotFound;
    readonly guestId: string;
  };
  export type PartyInvalidGuestSequence = {
    readonly code: typeof SchedulingErrorCode.PartyInvalidGuestSequence;
    readonly value: number;
  };
  export type PartyUnclaimed = {
    readonly code: typeof SchedulingErrorCode.PartyUnclaimed;
  };
  export type PartyDuplicateLabel = {
    readonly code: typeof SchedulingErrorCode.PartyDuplicateLabel;
    readonly label: string;
  };
  export type BookingPolicyInvalid = {
    readonly code: typeof SchedulingErrorCode.BookingPolicyInvalid;
    readonly field: string;
    readonly rawValue: number;
  };
  export type CancellationWindowInvalid = {
    readonly code: typeof SchedulingErrorCode.CancellationWindowInvalid;
    readonly rawValue: number;
  };
  export type ClientStatsPolicyInvalid = {
    readonly code: typeof SchedulingErrorCode.ClientStatsPolicyInvalid;
    readonly field: string;
    readonly rawValue: number;
  };
  export type CalendarDayInvalid = {
    readonly code: typeof SchedulingErrorCode.CalendarDayInvalid;
    readonly rawValue: string;
  };
  export type DateRangeInvalid = {
    readonly code: typeof SchedulingErrorCode.DateRangeInvalid;
    readonly from: string;
    readonly to: string;
  };
  export type TimeRangeInvalid = {
    readonly code: typeof SchedulingErrorCode.TimeRangeInvalid;
    readonly startMinutes: number;
    readonly endMinutes: number;
  };
  export type IdEmpty = {
    readonly code: typeof SchedulingErrorCode.IdEmpty;
    readonly idType: string;
  };
  export type FlexibleWhenFull = {
    readonly code: typeof SchedulingErrorCode.FlexibleWhenFull;
    readonly max: number;
  };
  export type RecurrenceInvalidInterval = {
    readonly code: typeof SchedulingErrorCode.RecurrenceInvalidInterval;
    readonly interval: number;
    readonly max: number;
  };
  export type RecurrenceNoWeekdays = {
    readonly code: typeof SchedulingErrorCode.RecurrenceNoWeekdays;
  };
  export type RecurrenceInvalidDay = {
    readonly code: typeof SchedulingErrorCode.RecurrenceInvalidDay;
    readonly month: number | null;
    readonly date: number;
  };
  export type RecurrenceInvalidCount = {
    readonly code: typeof SchedulingErrorCode.RecurrenceInvalidCount;
    readonly count: number;
    readonly max: number;
  };
  export type RecurrenceEndsBeforeStart = {
    readonly code: typeof SchedulingErrorCode.RecurrenceEndsBeforeStart;
    readonly start: string;
    readonly until: string;
  };
  export type RecurrenceNeverOccurs = {
    readonly code: typeof SchedulingErrorCode.RecurrenceNeverOccurs;
    readonly start: string;
  };
  export type RecurrenceTooLong = {
    readonly code: typeof SchedulingErrorCode.RecurrenceTooLong;
    readonly max: number;
  };
  export type ShiftSegmentInvalidLocation = {
    readonly code: typeof SchedulingErrorCode.ShiftSegmentInvalidLocation;
    readonly rawLocationId: string;
  };
  export type ShiftSegmentImpossibleTransfer = {
    readonly code: typeof SchedulingErrorCode.ShiftSegmentImpossibleTransfer;
    readonly weekday: number;
    readonly fromLocationId: string;
    readonly toLocationId: string;
    readonly gapMinutes: number;
    readonly requiredMinutes: number;
  };
  export type StaffScheduleOverlappingVersions = {
    readonly code: typeof SchedulingErrorCode.StaffScheduleOverlappingVersions;
    readonly earlierFrom: string;
    readonly laterFrom: string;
  };
  export type StaffScheduleRetroactiveAmendment = {
    readonly code: typeof SchedulingErrorCode.StaffScheduleRetroactiveAmendment;
    readonly attemptedFrom: string;
    readonly currentFrom: string;
  };
  export type WaitlistInvalid = {
    readonly code: typeof SchedulingErrorCode.WaitlistInvalid;
    readonly field: string;
  };
  export type WaitlistNoDays = {
    readonly code: typeof SchedulingErrorCode.WaitlistNoDays;
  };
  export type WaitlistEmptyCart = {
    readonly code: typeof SchedulingErrorCode.WaitlistEmptyCart;
  };
  export type WaitlistInvalidTransition = {
    readonly code: typeof SchedulingErrorCode.WaitlistInvalidTransition;
    readonly from: WaitlistState;
    readonly to: WaitlistState;
  };
  export type ScheduleExceptionEmptyRanges = {
    readonly code: typeof SchedulingErrorCode.ScheduleExceptionEmptyRanges;
    readonly exceptionKind: ExceptionEffectKind;
  };
}
