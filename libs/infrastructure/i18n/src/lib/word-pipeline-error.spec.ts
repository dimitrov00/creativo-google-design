import { describe, expect, it } from 'vitest';
import {
  BookingErrorCode,
  BookingStatus,
  CancellationRefusalCode,
  MoveErrorCode,
  PipelineError,
  PipelineErrorCode,
} from '@core/primitives';
import bg from '../assets/i18n/bg.json';
import en from '../assets/i18n/en.json';
import { bookingStatusWords } from './booking-status-words';
import { wordPipelineError } from './word-pipeline-error';

/*
 * The cases of `wordError` (`booking-gateway.port.spec.ts`,
 * `libs/application/booking`, deleted in 4b), on the flipped vocabulary —
 * plus the two consuming surfaces' copy and the staff day's transition
 * sentence, byte for byte in bg and en.
 */

/** A catalogue as a lookup: copy for the codes it knows, the code itself else. */
function catalogue(copy: Readonly<Record<string, string>>) {
  const known = new Map(Object.entries(copy));
  const asked: string[] = [];
  return {
    asked,
    translate: (code: string): string => {
      asked.push(code);
      return known.get(code) ?? code;
    },
  };
}

/** The real catalogue's `errors.<code>`, interpolated — `translateDomainError`'s contract. */
function errorsOf(errors: Readonly<Record<string, unknown>>) {
  return (code: string, params: Readonly<Record<string, unknown>>): string => {
    const template = Object.getOwnPropertyDescriptor(errors, code)?.value;
    if (typeof template !== 'string') return code;
    return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
      String(Object.getOwnPropertyDescriptor(params, name)?.value ?? ''),
    );
  };
}

const wired = (
  serverErrorCode: string,
  reason: { readonly refusal?: string; readonly field?: string } = {},
  serverParams: Readonly<Record<string, string | number>> = {},
): PipelineError => ({
  ...PipelineError.of(
    PipelineErrorCode.InvalidRequest,
    serverErrorCode,
    reason.refusal ?? null,
    reason.field ?? null,
  ),
  serverParams,
});

describe('wordPipelineError — the most specific words the catalogue has', () => {
  it('tries the server’s code one level deep, then the code, then the surface’s own', () => {
    const words = catalogue({ 'booking.gateway.failed': 'generic' });
    const error = wired(BookingErrorCode.InvalidInput, {
      field: 'person_overlap',
    });
    expect(
      wordPipelineError(error, words.translate, 'booking.gateway.failed'),
    ).toBe('generic');
    expect(words.asked).toEqual([
      'BOOKING_INVALID_INPUT.person_overlap',
      'BOOKING_INVALID_INPUT',
      'booking.gateway.failed',
    ]);
  });

  it('stops at the first code with copy', () => {
    const words = catalogue({
      BOOKING_RESCHEDULE_CARRIED_SEAT_UNPLACEABLE: 'carried',
      'BOOKING_RESCHEDULE_CARRIED_SEAT_UNPLACEABLE.shop_only': 'shop only',
    });
    const refused = (refusal: string) =>
      wired(MoveErrorCode.CarriedSeatUnplaceable, { refusal });
    expect(wordPipelineError(refused('shop_only'), words.translate, 'x')).toBe(
      'shop only',
    );
    // A reason the catalogue does not know yet is the code's own copy.
    expect(wordPipelineError(refused('newer'), words.translate, 'x')).toBe(
      'carried',
    );
  });

  it('words a server code that names no reason by itself — the retryable cancel', () => {
    const words = catalogue({
      BOOKING_CANCEL_POLICY_UNAVAILABLE: 'try again in a moment',
      'booking.gateway.failed': 'generic',
    });
    const error = {
      ...PipelineError.of(
        PipelineErrorCode.Unavailable,
        CancellationRefusalCode.PolicyUnavailable,
        null,
        null,
      ),
    };
    expect(
      wordPipelineError(error, words.translate, 'booking.gateway.failed'),
    ).toBe('try again in a moment');
  });

  it('is the surface’s own code when the server sent none', () => {
    const words = catalogue({ 'booking.gateway.failed': 'generic' });
    expect(
      wordPipelineError(
        PipelineError.bare(PipelineErrorCode.Unavailable),
        words.translate,
        'booking.gateway.failed',
      ),
    ).toBe('generic');
    expect(words.asked).toEqual(['booking.gateway.failed']);
  });
});

describe('wordPipelineError — today’s copy, in the real catalogues', () => {
  it('words the closed cancellation window with its hours and the surface’s reach (appointments page)', () => {
    const error = wired(
      CancellationRefusalCode.WindowClosed,
      {},
      {
        windowHours: 24,
      },
    );
    expect(
      wordPipelineError(error, errorsOf(en.errors), 'booking.gateway.failed', {
        reach: en.booking.reach.call,
      }),
    ).toBe(
      'Free cancellation ends 24 h before the appointment — call the shop.',
    );
    expect(
      wordPipelineError(error, errorsOf(bg.errors), 'booking.gateway.failed', {
        reach: bg.booking.reach.call,
      }),
    ).toBe(
      `Безплатното отказване е до 24 ч. преди часа — ${bg.booking.reach.call}.`,
    );
  });

  it('words a lost slot on the review step', () => {
    expect(
      wordPipelineError(
        wired(BookingErrorCode.SlotUnavailable),
        errorsOf(en.errors),
        'booking.gateway.failed',
      ),
    ).toBe('That time is already taken.');
  });

  it('words the staff day’s refused transition with today’s lowercase words — exact bg and en', () => {
    const error = wired(
      BookingErrorCode.TransitionNotAllowed,
      {},
      {
        fromBookingStatus: BookingStatus.Completed,
        toBookingStatus: BookingStatus.Confirmed,
      },
    );
    const words = {
      from: bookingStatusWords[BookingStatus.Completed],
      to: bookingStatusWords[BookingStatus.Confirmed],
    };
    expect(
      wordPipelineError(error, errorsOf(en.errors), 'unknown', words),
    ).toBe('The appointment cannot move from "completed" to "confirmed".');
    expect(
      wordPipelineError(error, errorsOf(bg.errors), 'unknown', words),
    ).toBe('Часът не може да мине от „completed“ към „confirmed“.');
  });
});
