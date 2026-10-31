import { type LocationId, Result, WaitlistRequestId } from '@core/primitives';
import { type PipelineError } from '@core/errors';
import { CallAnswer } from './call-answer.data';
import type { DayWindows } from './day-windows.data';
import type { BookingCart } from './booking-cart.data';

/**
 * THE WAITLIST WIRE (Phase 4a 4A-4) — what a client asks the waitlist to
 * watch (`requestWaitlist`): a shop (`null` = any shop), the days they are
 * free (each a `DayWindows` — wall-clock minutes of that shop day), and the
 * bag. Typed on the web; the server decodes `unknown` into the raw twin
 * {@link WaitlistCall.Input} and `WaitlistSystem.decide` judges it (was the
 * system's `WaitlistAskInput`, re-homed here).
 */
export type WaitlistCall = {
  readonly locationId: LocationId | null;
  readonly days: readonly DayWindows[];
  readonly cart: BookingCart;
};

export const WaitlistCall = {
  /** `requestWaitlist`'s answer — and `cancelWaitlist`'s, the same shape: the request's id, or nothing usable. */
  decodeRequested(raw: unknown): Result<WaitlistCall.Requested, PipelineError> {
    const answer = CallAnswer.read(raw);
    const requestId =
      answer === null
        ? null
        : CallAnswer.parsed(answer, 'requestId', WaitlistRequestId.parse);
    return requestId === null
      ? CallAnswer.unusable()
      : Result.ok({ requestId });
  },
} as const;

export namespace WaitlistCall {
  /**
   * The raw twin the server's decoding step produces — foreign input (the L3
   * escape): the shop as sent, each day's date and windows as raw numbers,
   * the bag's ids as raw strings ({@link CartInput}). A typed
   * {@link WaitlistCall} is one.
   */
  export type Input = {
    readonly locationId: string | null;
    readonly days: readonly DayInput[];
    readonly cart: CartInput;
  };
  /**
   * The bag, raw (pass E, E-4): each id as sent, the line counter as a raw
   * number. Judging the ids is the door's question (`WaitlistSystem.decide`,
   * in its own order); `WaitlistSystem.cartAsSent` brands them as sent for
   * the stored body. A typed `BookingCart` is one.
   */
  export type CartInput = {
    readonly cartSeats: readonly CartSeatInput[];
    readonly cartNextSequence: number;
  };
  /** One seat's lines, raw — the seat's key names every line's seat. */
  export type CartSeatInput = {
    readonly seatKey: string;
    readonly lines: readonly CartLineInput[];
  };
  /** One cart line, raw — a `CartLine` is one. */
  export type CartLineInput = {
    readonly lineId: string;
    readonly serviceId: string;
    readonly variantId: string | null;
    readonly barberId: string | null;
    readonly locationId: string | null;
  };
  /** One asked day, raw (was `WaitlistAskDayInput`). */
  export type DayInput = {
    readonly localDate: string;
    readonly windows: readonly {
      readonly startMinutes: number;
      readonly endMinutes: number;
    }[];
  };
  /** `cancelWaitlist`: the owner's own request. */
  export type Cancel = { readonly requestId: WaitlistRequestId };
  /**
   * Every waitlist write's answer — request, cancel: the request the write
   * is about (one decoder, `decodeRequested`, reads both).
   */
  export type Requested = { readonly requestId: WaitlistRequestId };
}
