import { describe, expect, it } from 'vitest';
import {
  AttendanceState,
  BarberId,
  BookingStatus,
  CartLineId,
  Currency,
  ExceptionEffect,
  GuestId,
  LocationId,
  MinuteCount,
  MinuteDelta,
  SeatId,
  SeatKeyText,
  ServiceId,
  WaitlistStatus,
  Weekday,
} from '@core/primitives';
import { endMinute, localDate, minute, unwrapOk } from '@core/testing';
import { SchedulingError, SchedulingErrorCode } from './scheduling.error';

describe('SchedulingErrorCode', () => {
  it('holds every code once, all SCREAMING_SNAKE', () => {
    const codes = Object.values(SchedulingErrorCode);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z][A-Z_]*[A-Z]$/);
      expect(code).not.toContain('__');
    }
  });

  it('prefixes every code with its context — not_arrivable included', () => {
    const outside = Object.values(SchedulingErrorCode).filter(
      (code) => !code.startsWith('SCHEDULING_'),
    );
    expect(outside).toEqual([]);
    expect(SchedulingErrorCode.AppointmentNotArrivable).toBe(
      'SCHEDULING_APPOINTMENT_NOT_ARRIVABLE',
    );
  });

  it('keeps the booking contact codes under the context, off the UI copy namespace', () => {
    expect(SchedulingErrorCode.ContactEmptyName).toBe(
      'SCHEDULING_BOOKING_CONTACT_EMPTY_NAME',
    );
    expect(SchedulingErrorCode.ContactInvalidPhone).toBe(
      'SCHEDULING_BOOKING_CONTACT_INVALID_PHONE',
    );
    expect(SchedulingErrorCode.ContactInvalidEmail).toBe(
      'SCHEDULING_BOOKING_CONTACT_INVALID_EMAIL',
    );
    expect(SchedulingErrorCode.ContactNoteTooLong).toBe(
      'SCHEDULING_BOOKING_CONTACT_NOTE_TOO_LONG',
    );
  });
});

describe('SchedulingError factories', () => {
  it('build plain structs: the errorCode plus i18n-safe scalars', () => {
    const errors: readonly SchedulingError[] = [
      SchedulingError.appointmentEmptySeats(),
      SchedulingError.appointmentMultipleSelfSeats(),
      SchedulingError.appointmentPastStartTime(),
      SchedulingError.appointmentBarberDoubleBooked(BarberId.of('ivan')),
      SchedulingError.appointmentMixedCurrency(Currency.EUR, Currency.BGN),
      SchedulingError.appointmentInvalidTransition(
        BookingStatus.Completed,
        BookingStatus.Confirmed,
      ),
      SchedulingError.appointmentReopenWindowClosed(BookingStatus.Completed),
      SchedulingError.appointmentEmptyCancellationReason(),
      SchedulingError.appointmentUnknownSeat(SeatId.of('s1')),
      SchedulingError.appointmentSeatAlreadyResolved(
        SeatId.of('s1'),
        AttendanceState.Worked,
      ),
      SchedulingError.appointmentNotArrivable(BookingStatus.Cancelled),
      SchedulingError.contactEmptyName(),
      SchedulingError.contactInvalidPhone('12'),
      SchedulingError.contactInvalidEmail('nope'),
      SchedulingError.contactNoteTooLong(200),
      SchedulingError.seatLabelEmpty(),
      SchedulingError.seatLabelTooLong(60),
      SchedulingError.cartLineNotFound(
        SeatKeyText.of('self'),
        CartLineId.of('line-9'),
      ),
      SchedulingError.cartDuplicateService(
        SeatKeyText.of('self'),
        ServiceId.of('svc-cut'),
      ),
      SchedulingError.cartInvalidLineSequence(-1),
      SchedulingError.partyGuestNotFound(GuestId.of('guest-4')),
      SchedulingError.partyInvalidGuestSequence(-1),
      SchedulingError.partyUnclaimed(),
      SchedulingError.partyDuplicateLabel('Мария'),
      SchedulingError.bookingPolicyInvalid('slotStepMinutes', 25),
      SchedulingError.cancellationWindowInvalid(-1),
      SchedulingError.clientStatsPolicyInvalid('suggestPauseNoShows', 0),
      SchedulingError.calendarDayInvalid('2026-02-30'),
      SchedulingError.dateRangeInvalid('2026-10-02', '2026-10-01'),
      SchedulingError.timeRangeInvalid(minute(720), endMinute(540)),
      SchedulingError.idEmpty('SeatId'),
      SchedulingError.flexibleWhenFull(7),
      SchedulingError.recurrenceInvalidInterval(100, 99),
      SchedulingError.recurrenceNoWeekdays(),
      SchedulingError.recurrenceInvalidDay(2, 30),
      SchedulingError.recurrenceInvalidCount(367, 366),
      SchedulingError.recurrenceEndsBeforeStart(
        localDate('2026-10-02'),
        localDate('2026-10-01'),
      ),
      SchedulingError.recurrenceNeverOccurs(localDate('2026-10-02')),
      SchedulingError.recurrenceTooLong(366),
      SchedulingError.shiftSegmentInvalidLocation(LocationId.of('')),
      SchedulingError.shiftSegmentImpossibleTransfer(
        Weekday.Mon,
        LocationId.of('loc-a'),
        LocationId.of('loc-b'),
        unwrapOk(MinuteDelta.of(0)),
        unwrapOk(MinuteCount.of(30)),
      ),
      SchedulingError.staffScheduleOverlappingVersions(
        localDate('2026-01-01'),
        localDate('2026-02-01'),
      ),
      SchedulingError.staffScheduleRetroactiveAmendment(
        localDate('2026-01-01'),
        localDate('2026-02-01'),
      ),
      SchedulingError.waitlistInvalid('ownerUserId'),
      SchedulingError.waitlistNoDays(),
      SchedulingError.waitlistEmptyCart(),
      SchedulingError.waitlistInvalidTransition(
        WaitlistStatus.Booked,
        WaitlistStatus.Open,
      ),
      SchedulingError.scheduleExceptionEmptyRanges(ExceptionEffect.Hours),
    ];
    // One factory per code, each code reached once.
    expect(errors.map((error) => error.errorCode).sort()).toEqual(
      Object.values(SchedulingErrorCode).sort(),
    );
    for (const error of errors) {
      for (const [key, value] of Object.entries(error)) {
        if (key === 'errorCode') continue;
        expect(
          value === null || ['string', 'number'].includes(typeof value),
        ).toBe(true);
      }
    }
  });

  it('carries the legacy i18n parameter names where rows exist', () => {
    expect(SchedulingError.contactInvalidEmail('x')).toEqual({
      errorCode: 'SCHEDULING_BOOKING_CONTACT_INVALID_EMAIL',
      rawValue: 'x',
    });
    expect(SchedulingError.contactNoteTooLong(200)).toEqual({
      errorCode: 'SCHEDULING_BOOKING_CONTACT_NOTE_TOO_LONG',
      maxLength: 200,
    });
    expect(SchedulingError.partyDuplicateLabel('Мария')).toEqual({
      errorCode: 'SCHEDULING_BOOKING_PARTY_DUPLICATE_LABEL',
      label: 'Мария',
    });
    expect(SchedulingError.recurrenceTooLong(366)).toEqual({
      errorCode: 'SCHEDULING_RECURRENCE_TOO_LONG',
      max: 366,
    });
  });

  it('is() narrows by errorCode', () => {
    const error: SchedulingError = SchedulingError.flexibleWhenFull(7);
    expect(
      SchedulingError.is(error, SchedulingErrorCode.FlexibleWhenFull),
    ).toBe(true);
    expect(SchedulingError.is(error, SchedulingErrorCode.WaitlistNoDays)).toBe(
      false,
    );
    if (SchedulingError.is(error, SchedulingErrorCode.FlexibleWhenFull)) {
      expect(error.max).toBe(7);
    }
  });
});
