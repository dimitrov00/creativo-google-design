/**
 * The scheduling context's error codes — the 51 `DomainError` subclasses of
 * the legacy scheduling domain lib's `*.errors.ts` (deleted in Phase 4b)
 * collapsed into ONE `as const`
 * dictionary (blueprint §2.1), SCREAMING_SNAKE and prefixed `SCHEDULING_`
 * after the flatten pass (Law 7.5, flatten-spec §4.2) — `appointment.not_arrivable`
 * included (`SCHEDULING_APPOINTMENT_NOT_ARRIVABLE`). The UI resolves
 * `errors.<errorCode>`; since the Phase 4a wire flip the callables answer
 * these codes themselves (no legacy dotted code survives on the wire).
 *
 * Dropped with their subjects: `scheduling.barber_day.block_collision`
 * (barber-day.ts is deleted), `scheduling.time_slot.invalid_range` (TimeSlot
 * is a minute range) and `scheduling.time_of_day.invalid` (no `'HH:mm'`
 * struct survives — minutes of day are integers).
 *
 * Every non-`errorCode` field is an i18n parameter, so each is an i18n-safe
 * scalar (a string, a number or `null`) — a branded one where it names an
 * id, a coordinate or money (Law 7.4). A field that names a state is typed
 * by that state's dictionary (`BookingStatus`, `AttendanceState`,
 * `WaitlistStatus`, `ExceptionEffect`), so only a real tag fits it.
 */
import type {
  AttendanceState,
  BarberId,
  BookingStatus,
  CartLineId,
  Currency,
  EndMinute,
  ExceptionEffect,
  GuestId,
  LocalDate,
  LocationId,
  MinuteCount,
  MinuteDelta,
  MinuteOfDay,
  SeatId,
  SeatKeyText,
  ServiceId,
  WaitlistStatus,
  Weekday,
} from '@core/primitives';

/** Error codes — the ONLY source of these strings; the UI translates them. */
export const SchedulingErrorCode = {
  AppointmentEmptySeats: 'SCHEDULING_APPOINTMENT_EMPTY_SEATS',
  AppointmentMultipleSelfSeats: 'SCHEDULING_APPOINTMENT_MULTIPLE_SELF_SEATS',
  AppointmentPastStartTime: 'SCHEDULING_APPOINTMENT_PAST_START_TIME',
  AppointmentBarberDoubleBooked: 'SCHEDULING_APPOINTMENT_BARBER_DOUBLE_BOOKED',
  AppointmentMixedCurrency: 'SCHEDULING_APPOINTMENT_MIXED_CURRENCY',
  AppointmentInvalidTransition: 'SCHEDULING_APPOINTMENT_INVALID_TRANSITION',
  AppointmentReopenWindowClosed: 'SCHEDULING_APPOINTMENT_REOPEN_WINDOW_CLOSED',
  AppointmentEmptyCancellationReason:
    'SCHEDULING_APPOINTMENT_EMPTY_CANCELLATION_REASON',
  AppointmentUnknownSeat: 'SCHEDULING_APPOINTMENT_UNKNOWN_SEAT',
  AppointmentSeatAlreadyResolved:
    'SCHEDULING_APPOINTMENT_SEAT_ALREADY_RESOLVED',
  /** Was `appointment.not_arrivable` — it takes its dictionary's prefix now. */
  AppointmentNotArrivable: 'SCHEDULING_APPOINTMENT_NOT_ARRIVABLE',
  ContactEmptyName: 'SCHEDULING_BOOKING_CONTACT_EMPTY_NAME',
  ContactInvalidPhone: 'SCHEDULING_BOOKING_CONTACT_INVALID_PHONE',
  ContactInvalidEmail: 'SCHEDULING_BOOKING_CONTACT_INVALID_EMAIL',
  ContactNoteTooLong: 'SCHEDULING_BOOKING_CONTACT_NOTE_TOO_LONG',
  SeatLabelEmpty: 'SCHEDULING_SEAT_LABEL_EMPTY',
  SeatLabelTooLong: 'SCHEDULING_SEAT_LABEL_TOO_LONG',
  CartLineNotFound: 'SCHEDULING_BOOKING_CART_LINE_NOT_FOUND',
  CartDuplicateService: 'SCHEDULING_BOOKING_CART_DUPLICATE_SERVICE',
  CartInvalidLineSequence: 'SCHEDULING_BOOKING_CART_INVALID_LINE_SEQUENCE',
  PartyGuestNotFound: 'SCHEDULING_BOOKING_PARTY_GUEST_NOT_FOUND',
  PartyDuplicateLabel: 'SCHEDULING_BOOKING_PARTY_DUPLICATE_LABEL',
  BookingPolicyInvalid: 'SCHEDULING_BOOKING_POLICY_INVALID',
  ClientStatsPolicyInvalid: 'SCHEDULING_CLIENT_STATS_POLICY_INVALID',
  TimeRangeInvalid: 'SCHEDULING_TIME_RANGE_INVALID',
  IdEmpty: 'SCHEDULING_ID_EMPTY',
  FlexibleWhenFull: 'SCHEDULING_FLEXIBLE_WHEN_FULL',
  RecurrenceInvalidInterval: 'SCHEDULING_RECURRENCE_INVALID_INTERVAL',
  RecurrenceNoWeekdays: 'SCHEDULING_RECURRENCE_NO_WEEKDAYS',
  RecurrenceInvalidDay: 'SCHEDULING_RECURRENCE_INVALID_DAY',
  RecurrenceInvalidCount: 'SCHEDULING_RECURRENCE_INVALID_COUNT',
  RecurrenceEndsBeforeStart: 'SCHEDULING_RECURRENCE_ENDS_BEFORE_START',
  RecurrenceNeverOccurs: 'SCHEDULING_RECURRENCE_NEVER_OCCURS',
  RecurrenceTooLong: 'SCHEDULING_RECURRENCE_TOO_LONG',
  ShiftSegmentInvalidLocation: 'SCHEDULING_SHIFT_SEGMENT_INVALID_LOCATION',
  ShiftSegmentImpossibleTransfer:
    'SCHEDULING_SHIFT_SEGMENT_IMPOSSIBLE_TRANSFER',
  StaffScheduleOverlappingVersions:
    'SCHEDULING_STAFF_SCHEDULE_OVERLAPPING_VERSIONS',
  StaffScheduleRetroactiveAmendment:
    'SCHEDULING_STAFF_SCHEDULE_RETROACTIVE_AMENDMENT',
  WaitlistNoDays: 'SCHEDULING_WAITLIST_NO_DAYS',
  WaitlistEmptyCart: 'SCHEDULING_WAITLIST_EMPTY_CART',
  WaitlistInvalidTransition: 'SCHEDULING_WAITLIST_INVALID_TRANSITION',
  ScheduleExceptionEmptyRanges: 'SCHEDULING_SCHEDULE_EXCEPTION_EMPTY_RANGES',
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
  | SchedulingError.PartyDuplicateLabel
  | SchedulingError.BookingPolicyInvalid
  | SchedulingError.ClientStatsPolicyInvalid
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
  | SchedulingError.WaitlistNoDays
  | SchedulingError.WaitlistEmptyCart
  | SchedulingError.WaitlistInvalidTransition
  | SchedulingError.ScheduleExceptionEmptyRanges;

const C = SchedulingErrorCode;

export const SchedulingError = {
  /** An appointment must hold at least one seat. */
  appointmentEmptySeats(): SchedulingError.AppointmentEmptySeats {
    return { errorCode: C.AppointmentEmptySeats };
  },
  /** The booker cannot hold two seats at the same time. */
  appointmentMultipleSelfSeats(): SchedulingError.AppointmentMultipleSelfSeats {
    return { errorCode: C.AppointmentMultipleSelfSeats };
  },
  /** A new appointment cannot start in the past. */
  appointmentPastStartTime(): SchedulingError.AppointmentPastStartTime {
    return { errorCode: C.AppointmentPastStartTime };
  },
  /**
   * Two seats want the same barber at overlapping times. The same barber on
   * two seats that do NOT overlap («father and son, back to back») is legal.
   */
  appointmentBarberDoubleBooked(
    barberId: BarberId,
  ): SchedulingError.AppointmentBarberDoubleBooked {
    return { errorCode: C.AppointmentBarberDoubleBooked, barberId };
  },
  /** Seats priced in two currencies — a data error, never a feature. */
  appointmentMixedCurrency(
    expected: Currency,
    found: Currency,
  ): SchedulingError.AppointmentMixedCurrency {
    return { errorCode: C.AppointmentMixedCurrency, expected, found };
  },
  appointmentInvalidTransition(
    from: BookingStatus,
    to: BookingStatus,
  ): SchedulingError.AppointmentInvalidTransition {
    return { errorCode: C.AppointmentInvalidTransition, from, to };
  },
  /** A settled visit may only be reopened on its own day. */
  appointmentReopenWindowClosed(
    from: BookingStatus,
  ): SchedulingError.AppointmentReopenWindowClosed {
    return { errorCode: C.AppointmentReopenWindowClosed, from };
  },
  appointmentEmptyCancellationReason(): SchedulingError.AppointmentEmptyCancellationReason {
    return { errorCode: C.AppointmentEmptyCancellationReason };
  },
  /** A seat outcome addressed to a seat this appointment does not hold. */
  appointmentUnknownSeat(
    seatId: SeatId,
  ): SchedulingError.AppointmentUnknownSeat {
    return { errorCode: C.AppointmentUnknownSeat, seatId };
  },
  /**
   * A seat's outcome is written ONCE: it carries the instant it was decided,
   * and every downstream number is keyed on that instant.
   */
  appointmentSeatAlreadyResolved(
    seatId: SeatId,
    outcome: AttendanceState,
  ): SchedulingError.AppointmentSeatAlreadyResolved {
    return { errorCode: C.AppointmentSeatAlreadyResolved, seatId, outcome };
  },
  /** Arriving is only a fact while the visit is still live. */
  appointmentNotArrivable(
    bookingStatus: BookingStatus,
  ): SchedulingError.AppointmentNotArrivable {
    return { errorCode: C.AppointmentNotArrivable, bookingStatus };
  },
  /** The name the shop will call out. Empty is not a person. */
  contactEmptyName(): SchedulingError.ContactEmptyName {
    return { errorCode: C.ContactEmptyName };
  },
  /** The phone did not parse — the shop's only reliable way to reach someone. */
  contactInvalidPhone(rawValue: string): SchedulingError.ContactInvalidPhone {
    return { errorCode: C.ContactInvalidPhone, rawValue };
  },
  /** Optional overall, but not optionally valid. */
  contactInvalidEmail(rawValue: string): SchedulingError.ContactInvalidEmail {
    return { errorCode: C.ContactInvalidEmail, rawValue };
  },
  contactNoteTooLong(maxLength: number): SchedulingError.ContactNoteTooLong {
    return { errorCode: C.ContactNoteTooLong, maxLength };
  },
  seatLabelEmpty(): SchedulingError.SeatLabelEmpty {
    return { errorCode: C.SeatLabelEmpty };
  },
  seatLabelTooLong(max: number): SchedulingError.SeatLabelTooLong {
    return { errorCode: C.SeatLabelTooLong, max };
  },
  cartLineNotFound(
    seatKey: SeatKeyText,
    lineId: CartLineId,
  ): SchedulingError.CartLineNotFound {
    return { errorCode: C.CartLineNotFound, seatKey, lineId };
  },
  /** Nobody has two haircuts in one visit — the second belongs to another seat. */
  cartDuplicateService(
    seatKey: SeatKeyText,
    serviceId: ServiceId,
  ): SchedulingError.CartDuplicateService {
    return { errorCode: C.CartDuplicateService, seatKey, serviceId };
  },
  cartInvalidLineSequence(
    value: number,
  ): SchedulingError.CartInvalidLineSequence {
    return { errorCode: C.CartInvalidLineSequence, value };
  },
  partyGuestNotFound(guestId: GuestId): SchedulingError.PartyGuestNotFound {
    return { errorCode: C.PartyGuestNotFound, guestId };
  },
  /** Another guest already answers to this label — one label, one guest. */
  partyDuplicateLabel(label: string): SchedulingError.PartyDuplicateLabel {
    return { errorCode: C.PartyDuplicateLabel, label };
  },
  bookingPolicyInvalid(
    field: string,
    rawValue: number,
  ): SchedulingError.BookingPolicyInvalid {
    return { errorCode: C.BookingPolicyInvalid, field, rawValue };
  },
  clientStatsPolicyInvalid(
    field: string,
    rawValue: number,
  ): SchedulingError.ClientStatsPolicyInvalid {
    return { errorCode: C.ClientStatsPolicyInvalid, field, rawValue };
  },
  /** A wall-clock span that is empty, backwards or overlapping its neighbour. */
  timeRangeInvalid(
    startMinutes: MinuteOfDay,
    endMinutes: EndMinute,
  ): SchedulingError.TimeRangeInvalid {
    return { errorCode: C.TimeRangeInvalid, startMinutes, endMinutes };
  },
  idEmpty(idType: string): SchedulingError.IdEmpty {
    return { errorCode: C.IdEmpty, idType };
  },
  /** A flexible request covers at most `max` days. */
  flexibleWhenFull(max: number): SchedulingError.FlexibleWhenFull {
    return { errorCode: C.FlexibleWhenFull, max };
  },
  recurrenceInvalidInterval(
    interval: number,
    max: number,
  ): SchedulingError.RecurrenceInvalidInterval {
    return { errorCode: C.RecurrenceInvalidInterval, interval, max };
  },
  recurrenceNoWeekdays(): SchedulingError.RecurrenceNoWeekdays {
    return { errorCode: C.RecurrenceNoWeekdays };
  },
  /** `month` is `null` for a monthly rule's day, the month for a yearly one. */
  recurrenceInvalidDay(
    month: number | null,
    date: number,
  ): SchedulingError.RecurrenceInvalidDay {
    return { errorCode: C.RecurrenceInvalidDay, month, date };
  },
  recurrenceInvalidCount(
    count: number,
    max: number,
  ): SchedulingError.RecurrenceInvalidCount {
    return { errorCode: C.RecurrenceInvalidCount, count, max };
  },
  recurrenceEndsBeforeStart(
    start: LocalDate,
    until: LocalDate,
  ): SchedulingError.RecurrenceEndsBeforeStart {
    return { errorCode: C.RecurrenceEndsBeforeStart, start, until };
  },
  recurrenceNeverOccurs(
    start: LocalDate,
  ): SchedulingError.RecurrenceNeverOccurs {
    return { errorCode: C.RecurrenceNeverOccurs, start };
  },
  recurrenceTooLong(max: number): SchedulingError.RecurrenceTooLong {
    return { errorCode: C.RecurrenceTooLong, max };
  },
  /** `rawLocationId` echoes the segment's blank location as it was held. */
  shiftSegmentInvalidLocation(
    rawLocationId: LocationId,
  ): SchedulingError.ShiftSegmentInvalidLocation {
    return { errorCode: C.ShiftSegmentInvalidLocation, rawLocationId };
  },
  /**
   * Two consecutive segments at different shops leave less than the travel
   * time between them — the barber cannot be in both places.
   */
  shiftSegmentImpossibleTransfer(
    weekday: Weekday,
    fromLocationId: LocationId,
    toLocationId: LocationId,
    gapMinutes: MinuteDelta,
    requiredMinutes: MinuteCount,
  ): SchedulingError.ShiftSegmentImpossibleTransfer {
    return {
      errorCode: C.ShiftSegmentImpossibleTransfer,
      weekday,
      fromLocationId,
      toLocationId,
      gapMinutes,
      requiredMinutes,
    };
  },
  /** Exactly one roster version must be in force on any day. */
  staffScheduleOverlappingVersions(
    earlierFrom: LocalDate,
    laterFrom: LocalDate,
  ): SchedulingError.StaffScheduleOverlappingVersions {
    return {
      errorCode: C.StaffScheduleOverlappingVersions,
      earlierFrom,
      laterFrom,
    };
  },
  /** A roster cannot be amended from a day at or before the version in force began. */
  staffScheduleRetroactiveAmendment(
    attemptedFrom: LocalDate,
    currentFrom: LocalDate,
  ): SchedulingError.StaffScheduleRetroactiveAmendment {
    return {
      errorCode: C.StaffScheduleRetroactiveAmendment,
      attemptedFrom,
      currentFrom,
    };
  },
  waitlistNoDays(): SchedulingError.WaitlistNoDays {
    return { errorCode: C.WaitlistNoDays };
  },
  waitlistEmptyCart(): SchedulingError.WaitlistEmptyCart {
    return { errorCode: C.WaitlistEmptyCart };
  },
  waitlistInvalidTransition(
    from: WaitlistStatus,
    to: WaitlistStatus,
  ): SchedulingError.WaitlistInvalidTransition {
    return { errorCode: C.WaitlistInvalidTransition, from, to };
  },
  /** An `HOURS` or `BLOCKED` effect with no range would silently mean something else. */
  scheduleExceptionEmptyRanges(
    exceptionKind: ExceptionEffect,
  ): SchedulingError.ScheduleExceptionEmptyRanges {
    return { errorCode: C.ScheduleExceptionEmptyRanges, exceptionKind };
  },

  /** Narrows an error to one code — `SchedulingError.is(e, SchedulingErrorCode.FlexibleWhenFull)`. */
  is<K extends SchedulingErrorCode>(
    error: SchedulingError,
    errorCode: K,
  ): error is Extract<SchedulingError, { readonly errorCode: K }> {
    return error.errorCode === errorCode;
  },
} as const;

export namespace SchedulingError {
  export type AppointmentEmptySeats = {
    readonly errorCode: typeof SchedulingErrorCode.AppointmentEmptySeats;
  };
  export type AppointmentMultipleSelfSeats = {
    readonly errorCode: typeof SchedulingErrorCode.AppointmentMultipleSelfSeats;
  };
  export type AppointmentPastStartTime = {
    readonly errorCode: typeof SchedulingErrorCode.AppointmentPastStartTime;
  };
  export type AppointmentBarberDoubleBooked = {
    readonly errorCode: typeof SchedulingErrorCode.AppointmentBarberDoubleBooked;
    readonly barberId: BarberId;
  };
  export type AppointmentMixedCurrency = {
    readonly errorCode: typeof SchedulingErrorCode.AppointmentMixedCurrency;
    readonly expected: Currency;
    readonly found: Currency;
  };
  export type AppointmentInvalidTransition = {
    readonly errorCode: typeof SchedulingErrorCode.AppointmentInvalidTransition;
    readonly from: BookingStatus;
    readonly to: BookingStatus;
  };
  export type AppointmentReopenWindowClosed = {
    readonly errorCode: typeof SchedulingErrorCode.AppointmentReopenWindowClosed;
    readonly from: BookingStatus;
  };
  export type AppointmentEmptyCancellationReason = {
    readonly errorCode: typeof SchedulingErrorCode.AppointmentEmptyCancellationReason;
  };
  export type AppointmentUnknownSeat = {
    readonly errorCode: typeof SchedulingErrorCode.AppointmentUnknownSeat;
    readonly seatId: SeatId;
  };
  export type AppointmentSeatAlreadyResolved = {
    readonly errorCode: typeof SchedulingErrorCode.AppointmentSeatAlreadyResolved;
    readonly seatId: SeatId;
    readonly outcome: AttendanceState;
  };
  export type AppointmentNotArrivable = {
    readonly errorCode: typeof SchedulingErrorCode.AppointmentNotArrivable;
    readonly bookingStatus: BookingStatus;
  };
  export type ContactEmptyName = {
    readonly errorCode: typeof SchedulingErrorCode.ContactEmptyName;
  };
  export type ContactInvalidPhone = {
    readonly errorCode: typeof SchedulingErrorCode.ContactInvalidPhone;
    readonly rawValue: string;
  };
  export type ContactInvalidEmail = {
    readonly errorCode: typeof SchedulingErrorCode.ContactInvalidEmail;
    readonly rawValue: string;
  };
  export type ContactNoteTooLong = {
    readonly errorCode: typeof SchedulingErrorCode.ContactNoteTooLong;
    readonly maxLength: number;
  };
  export type SeatLabelEmpty = {
    readonly errorCode: typeof SchedulingErrorCode.SeatLabelEmpty;
  };
  export type SeatLabelTooLong = {
    readonly errorCode: typeof SchedulingErrorCode.SeatLabelTooLong;
    readonly max: number;
  };
  export type CartLineNotFound = {
    readonly errorCode: typeof SchedulingErrorCode.CartLineNotFound;
    readonly seatKey: SeatKeyText;
    readonly lineId: CartLineId;
  };
  export type CartDuplicateService = {
    readonly errorCode: typeof SchedulingErrorCode.CartDuplicateService;
    readonly seatKey: SeatKeyText;
    readonly serviceId: ServiceId;
  };
  export type CartInvalidLineSequence = {
    readonly errorCode: typeof SchedulingErrorCode.CartInvalidLineSequence;
    readonly value: number;
  };
  export type PartyGuestNotFound = {
    readonly errorCode: typeof SchedulingErrorCode.PartyGuestNotFound;
    readonly guestId: GuestId;
  };
  export type PartyDuplicateLabel = {
    readonly errorCode: typeof SchedulingErrorCode.PartyDuplicateLabel;
    readonly label: string;
  };
  export type BookingPolicyInvalid = {
    readonly errorCode: typeof SchedulingErrorCode.BookingPolicyInvalid;
    readonly field: string;
    readonly rawValue: number;
  };
  export type ClientStatsPolicyInvalid = {
    readonly errorCode: typeof SchedulingErrorCode.ClientStatsPolicyInvalid;
    readonly field: string;
    readonly rawValue: number;
  };
  export type TimeRangeInvalid = {
    readonly errorCode: typeof SchedulingErrorCode.TimeRangeInvalid;
    readonly startMinutes: MinuteOfDay;
    readonly endMinutes: EndMinute;
  };
  export type IdEmpty = {
    readonly errorCode: typeof SchedulingErrorCode.IdEmpty;
    readonly idType: string;
  };
  export type FlexibleWhenFull = {
    readonly errorCode: typeof SchedulingErrorCode.FlexibleWhenFull;
    readonly max: number;
  };
  export type RecurrenceInvalidInterval = {
    readonly errorCode: typeof SchedulingErrorCode.RecurrenceInvalidInterval;
    readonly interval: number;
    readonly max: number;
  };
  export type RecurrenceNoWeekdays = {
    readonly errorCode: typeof SchedulingErrorCode.RecurrenceNoWeekdays;
  };
  export type RecurrenceInvalidDay = {
    readonly errorCode: typeof SchedulingErrorCode.RecurrenceInvalidDay;
    readonly month: number | null;
    readonly date: number;
  };
  export type RecurrenceInvalidCount = {
    readonly errorCode: typeof SchedulingErrorCode.RecurrenceInvalidCount;
    readonly count: number;
    readonly max: number;
  };
  export type RecurrenceEndsBeforeStart = {
    readonly errorCode: typeof SchedulingErrorCode.RecurrenceEndsBeforeStart;
    readonly start: LocalDate;
    readonly until: LocalDate;
  };
  export type RecurrenceNeverOccurs = {
    readonly errorCode: typeof SchedulingErrorCode.RecurrenceNeverOccurs;
    readonly start: LocalDate;
  };
  export type RecurrenceTooLong = {
    readonly errorCode: typeof SchedulingErrorCode.RecurrenceTooLong;
    readonly max: number;
  };
  export type ShiftSegmentInvalidLocation = {
    readonly errorCode: typeof SchedulingErrorCode.ShiftSegmentInvalidLocation;
    readonly rawLocationId: LocationId;
  };
  export type ShiftSegmentImpossibleTransfer = {
    readonly errorCode: typeof SchedulingErrorCode.ShiftSegmentImpossibleTransfer;
    readonly weekday: Weekday;
    readonly fromLocationId: LocationId;
    readonly toLocationId: LocationId;
    readonly gapMinutes: MinuteDelta;
    readonly requiredMinutes: MinuteCount;
  };
  export type StaffScheduleOverlappingVersions = {
    readonly errorCode: typeof SchedulingErrorCode.StaffScheduleOverlappingVersions;
    readonly earlierFrom: LocalDate;
    readonly laterFrom: LocalDate;
  };
  export type StaffScheduleRetroactiveAmendment = {
    readonly errorCode: typeof SchedulingErrorCode.StaffScheduleRetroactiveAmendment;
    readonly attemptedFrom: LocalDate;
    readonly currentFrom: LocalDate;
  };
  export type WaitlistNoDays = {
    readonly errorCode: typeof SchedulingErrorCode.WaitlistNoDays;
  };
  export type WaitlistEmptyCart = {
    readonly errorCode: typeof SchedulingErrorCode.WaitlistEmptyCart;
  };
  export type WaitlistInvalidTransition = {
    readonly errorCode: typeof SchedulingErrorCode.WaitlistInvalidTransition;
    readonly from: WaitlistStatus;
    readonly to: WaitlistStatus;
  };
  export type ScheduleExceptionEmptyRanges = {
    readonly errorCode: typeof SchedulingErrorCode.ScheduleExceptionEmptyRanges;
    readonly exceptionKind: ExceptionEffect;
  };
}
