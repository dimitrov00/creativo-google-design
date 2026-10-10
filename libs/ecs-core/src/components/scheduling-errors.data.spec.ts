import { describe, expect, it } from 'vitest';
import { BookingState } from './booking-status.data';
import { ExceptionEffectKind } from './exception-effect.data';
import { SchedulingError, SchedulingErrorCode } from './scheduling-errors.data';
import { SeatOutcomeKind } from './seat-outcome.data';
import { WaitlistState } from './waitlist-status.data';

describe('SchedulingErrorCode', () => {
  it('holds every code once, all dotted', () => {
    const codes = Object.values(SchedulingErrorCode);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      const parts = code.split('.');
      expect(parts.length).toBeGreaterThanOrEqual(2);
      for (const part of parts) expect(part).toMatch(/^[a-z_]+$/);
    }
  });

  it('keeps the context prefix — the only legacy key that keeps its own is not_arrivable', () => {
    const outside = Object.values(SchedulingErrorCode).filter(
      (code) => !code.startsWith('scheduling.'),
    );
    expect(outside).toEqual(['appointment.not_arrivable']);
  });

  it('moves the booking contact codes under the context, off the UI copy namespace', () => {
    expect(SchedulingErrorCode.ContactEmptyName).toBe(
      'scheduling.booking_contact.empty_name',
    );
    expect(SchedulingErrorCode.ContactInvalidPhone).toBe(
      'scheduling.booking_contact.invalid_phone',
    );
    expect(SchedulingErrorCode.ContactInvalidEmail).toBe(
      'scheduling.booking_contact.invalid_email',
    );
    expect(SchedulingErrorCode.ContactNoteTooLong).toBe(
      'scheduling.booking_contact.note_too_long',
    );
  });
});

describe('SchedulingError factories', () => {
  it('build plain structs: the code plus i18n-safe scalars', () => {
    const errors: readonly SchedulingError[] = [
      SchedulingError.appointmentEmptySeats(),
      SchedulingError.appointmentMultipleSelfSeats(),
      SchedulingError.appointmentPastStartTime(),
      SchedulingError.appointmentBarberDoubleBooked('ivan'),
      SchedulingError.appointmentMixedCurrency('EUR', 'BGN'),
      SchedulingError.appointmentInvalidTransition(
        BookingState.Completed,
        BookingState.Confirmed,
      ),
      SchedulingError.appointmentReopenWindowClosed(BookingState.Completed),
      SchedulingError.appointmentEmptyCancellationReason(),
      SchedulingError.appointmentUnknownSeat('s1'),
      SchedulingError.appointmentSeatAlreadyResolved(
        's1',
        SeatOutcomeKind.Worked,
      ),
      SchedulingError.appointmentNotArrivable(BookingState.Cancelled),
      SchedulingError.contactEmptyName(),
      SchedulingError.contactInvalidPhone('12'),
      SchedulingError.contactInvalidEmail('nope'),
      SchedulingError.contactNoteTooLong(200),
      SchedulingError.seatLabelEmpty(),
      SchedulingError.seatLabelTooLong(60),
      SchedulingError.cartLineNotFound('self', 'line-9'),
      SchedulingError.cartDuplicateService('self', 'svc-cut'),
      SchedulingError.cartInvalidLineSequence(-1),
      SchedulingError.partyGuestNotFound('guest-4'),
      SchedulingError.partyInvalidGuestSequence(-1),
      SchedulingError.partyUnclaimed(),
      SchedulingError.partyDuplicateLabel('Мария'),
      SchedulingError.bookingPolicyInvalid('slotStepMinutes', 25),
      SchedulingError.cancellationWindowInvalid(-1),
      SchedulingError.clientStatsPolicyInvalid('suggestPauseNoShows', 0),
      SchedulingError.calendarDayInvalid('2026-02-30'),
      SchedulingError.dateRangeInvalid('2026-10-02', '2026-10-01'),
      SchedulingError.timeRangeInvalid(720, 540),
      SchedulingError.idEmpty('SeatId'),
      SchedulingError.flexibleWhenFull(7),
      SchedulingError.recurrenceInvalidInterval(100, 99),
      SchedulingError.recurrenceNoWeekdays(),
      SchedulingError.recurrenceInvalidDay(2, 30),
      SchedulingError.recurrenceInvalidCount(367, 366),
      SchedulingError.recurrenceEndsBeforeStart('2026-10-02', '2026-10-01'),
      SchedulingError.recurrenceNeverOccurs('2026-10-02'),
      SchedulingError.recurrenceTooLong(366),
      SchedulingError.shiftSegmentInvalidLocation(''),
      SchedulingError.shiftSegmentImpossibleTransfer(
        1,
        'loc-a',
        'loc-b',
        0,
        30,
      ),
      SchedulingError.staffScheduleOverlappingVersions(
        '2026-01-01',
        '2026-02-01',
      ),
      SchedulingError.staffScheduleRetroactiveAmendment(
        '2026-01-01',
        '2026-02-01',
      ),
      SchedulingError.waitlistInvalid('ownerUserId'),
      SchedulingError.waitlistNoDays(),
      SchedulingError.waitlistEmptyCart(),
      SchedulingError.waitlistInvalidTransition(
        WaitlistState.Booked,
        WaitlistState.Open,
      ),
      SchedulingError.scheduleExceptionEmptyRanges(ExceptionEffectKind.Hours),
    ];
    // One factory per code, each code reached once.
    expect(errors.map((error) => error.code).sort()).toEqual(
      Object.values(SchedulingErrorCode).sort(),
    );
    for (const error of errors) {
      for (const [key, value] of Object.entries(error)) {
        if (key === 'code') continue;
        expect(
          value === null || ['string', 'number'].includes(typeof value),
        ).toBe(true);
      }
    }
  });

  it('carries the legacy i18n parameter names where rows exist', () => {
    expect(SchedulingError.contactInvalidEmail('x')).toEqual({
      code: 'scheduling.booking_contact.invalid_email',
      rawValue: 'x',
    });
    expect(SchedulingError.contactNoteTooLong(200)).toEqual({
      code: 'scheduling.booking_contact.note_too_long',
      maxLength: 200,
    });
    expect(SchedulingError.partyDuplicateLabel('Мария')).toEqual({
      code: 'scheduling.booking_party.duplicate_label',
      label: 'Мария',
    });
    expect(SchedulingError.recurrenceTooLong(366)).toEqual({
      code: 'scheduling.recurrence.too_long',
      max: 366,
    });
  });

  it('is() narrows by code', () => {
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
