import {
  type LocationId,
  type PipelineError,
  Result,
  WaitlistRequestId,
} from '@core/primitives';
import { CallAnswer } from './call-answer.data';
import type { BookingCart } from './cart-line.data';
import type { DayWindows } from './day-windows.data';

/**
 * THE WAITLIST WIRE (Phase 4a 4A-4) — what a client asks the waitlist to
 * watch (`requestWaitlist`): a shop (`null` = any shop), the days they are
 * free (each a `DayWindows` — wall-clock minutes of that shop day), and the
 * bag. Typed on the web; the server decodes `unknown` into the raw twin
 * {@link WaitlistCall.Input} and `WaitlistSystem.ask` judges it (was the
 * system's `WaitlistAskInput`, re-homed here).
 */
export type WaitlistCall = {
  readonly locationId: LocationId | null;
  readonly days: readonly DayWindows[];
  readonly cart: BookingCart;
};

export const WaitlistCall = {
  /** `requestWaitlist`'s answer — the request's id, or nothing usable. */
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

  /** `cancelWaitlist`'s answer. */
  decodeCancelled(raw: unknown): Result<WaitlistCall.Cancelled, PipelineError> {
    return WaitlistCall.decodeRequested(raw);
  },
} as const;

export namespace WaitlistCall {
  /**
   * The raw twin the server's decoding step produces — foreign input (the L3
   * escape): the shop as sent, each day's date and windows as raw numbers.
   * A typed {@link WaitlistCall} is one.
   */
  export type Input = {
    readonly locationId: string | null;
    readonly days: readonly DayInput[];
    readonly cart: BookingCart;
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
  export type Requested = { readonly requestId: WaitlistRequestId };
  export type Cancelled = { readonly requestId: WaitlistRequestId };
}
