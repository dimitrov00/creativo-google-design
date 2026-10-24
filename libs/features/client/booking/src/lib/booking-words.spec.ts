import { describe, expect, it } from 'vitest';
import {
  BookingFlowStep,
  MoveRefusalReason,
  SeatArrangement,
} from '@core/components';
import {
  BOOKING_STEP_WORDS,
  MOVE_REFUSAL_WORDS,
  SEAT_ARRANGEMENT_WORDS,
  bookingStepOfWord,
} from './booking-words';

/*
 * The lowercase words the URL, the DOM and the catalogue have always read
 * (4A-10) — one table per dictionary, total, and read back exactly.
 */
describe('the booking flow’s lowercase words', () => {
  it('spells every step as `?step=` and `data-state` always have', () => {
    expect(BOOKING_STEP_WORDS).toEqual({
      LOCATION: 'location',
      SERVICES: 'services',
      SCHEDULE: 'schedule',
      REVIEW: 'review',
      CONFIRMED: 'confirmed',
      WAITLISTED: 'waitlisted',
    });
  });

  it('reads every word back to its step, and nothing else to any step', () => {
    for (const [step, word] of Object.entries(BOOKING_STEP_WORDS)) {
      expect(bookingStepOfWord(word)).toBe(step);
    }
    expect(Object.keys(BOOKING_STEP_WORDS).sort()).toEqual(
      Object.values(BookingFlowStep).sort(),
    );
    expect(bookingStepOfWord('SCHEDULE')).toBeNull();
    expect(bookingStepOfWord('party')).toBeNull();
    expect(bookingStepOfWord('')).toBeNull();
    expect(bookingStepOfWord(null)).toBeNull();
    expect(bookingStepOfWord(undefined)).toBeNull();
  });

  it('spells every move refusal as its i18n keys and `data-reason` always have', () => {
    expect(MOVE_REFUSAL_WORDS).toEqual({
      [MoveRefusalReason.CompanionsOnly]: 'companions_only',
      [MoveRefusalReason.Unavailable]: 'unavailable',
      [MoveRefusalReason.CarriedOutOfReach]: 'carried_out_of_reach',
    });
  });

  it('spells every seat arrangement as the time sheet’s heading key always has', () => {
    expect(SEAT_ARRANGEMENT_WORDS).toEqual({
      [SeatArrangement.Parallel]: 'parallel',
      [SeatArrangement.Sequential]: 'sequential',
    });
  });
});
