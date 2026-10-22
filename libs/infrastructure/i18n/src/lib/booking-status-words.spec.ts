import { describe, expect, it } from 'vitest';
import { CancellationReason } from '@core/components';
import { BookingStatus } from '@core/primitives';
import bg from '../assets/i18n/bg.json';
import en from '../assets/i18n/en.json';
import {
  bookingStatusWords,
  cancellationReasonWords,
} from './booking-status-words';

/*
 * ONE table per dictionary (Phase 4a 4A-10) — the successors of the
 * feature-local `STATUS_KEY` (appointments), `WIRE_STATUS` and `REASON_KEY`
 * (the staff day): total over their dictionaries, the words today's keys
 * and DOM attributes spell, every word a key the catalogues hold.
 */
describe('bookingStatusWords', () => {
  it('words every BookingStatus as today’s lowercase key segment', () => {
    expect(bookingStatusWords).toEqual({
      PENDING: 'pending',
      CONFIRMED: 'confirmed',
      COMPLETED: 'completed',
      NO_SHOW: 'no_show',
      CANCELLED: 'cancelled',
    });
    expect(Object.keys(bookingStatusWords).sort()).toEqual(
      Object.values(BookingStatus).sort(),
    );
  });

  it('names a key the appointments page reads, in both catalogues', () => {
    for (const word of Object.values(bookingStatusWords)) {
      expect(en.appointments.status).toHaveProperty(word);
      expect(bg.appointments.status).toHaveProperty(word);
    }
  });
});

describe('cancellationReasonWords', () => {
  it('words every CancellationReason as today’s cancelReasonCode segment', () => {
    expect(Object.keys(cancellationReasonWords).sort()).toEqual(
      Object.values(CancellationReason).sort(),
    );
    for (const [reason, word] of Object.entries(cancellationReasonWords)) {
      expect(word).toBe(reason.toLowerCase());
    }
  });
});
