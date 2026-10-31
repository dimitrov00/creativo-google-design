import { Result, StoredFields, WaitlistRequestId } from '@core/primitives';
import { WaitlistError } from '@core/errors';
import type { WaitlistCall } from '@core/components';
import type {
  CancelWaitlistCommand,
  RequestWaitlistCommand,
} from '@core/pipelines';
import type { EdgeError } from '../edge';
import { callerUserId } from '../lib/booking/caller-roles';
import {
  idOf,
  listOf,
  payloadOf,
  text,
  textOrNull,
  type WireRequest,
} from './wire-read';

/**
 * THE WAITLIST CALLABLES' WIRE (Phase 4a 4A-4) — flipped with the web's
 * `callableClient`: the request is the call component `WaitlistCall` read
 * into its raw twin (`WaitlistCall.Input`); each pipeline answers the call
 * component's answer itself (`WaitlistCall.Requested`, the request and its
 * cancellation alike, wired as it is), and a refusal leaves as its ecs-core struct (`refusalOf`: a
 * store failure thrown).
 *
 * - `requestWaitlist` `{ locationId, days: [{ localDate, windows:
 *   [{ startMinutes, endMinutes }] }], cart: { cartSeats: [{ seatKey,
 *   lines: [{ lineId, seatKey, serviceId, variantId, barberId, locationId
 *   }] }], cartNextSequence } }` → `{ requestId }`. Every field is re-read
 *   as a primitive without trusting it, nothing defaulted into existence: a
 *   window bound that is no number becomes `NaN`, which the door refuses
 *   (`windows`), an unreadable line one it refuses (`cart`). The owner is
 *   the VERIFIED token's uid, never the payload; the shop's clock is the
 *   pipeline's to read (the ask's shop, else the default location's).
 * - `cancelWaitlist` `{ requestId }` → `{ requestId }`. No caller →
 *   `BOOKING_WAITLIST_UNAUTHENTICATED`, no request id →
 *   `BOOKING_WAITLIST_INVALID_REQUEST` (`requestId`); not found / not
 *   cancellable leave as the pipeline's own refusal.
 *
 * A store failure is no refusal: it is thrown, for the edge to track and
 * answer as the platform's bare INTERNAL.
 */

/** A window bound as sent; anything but a number is `NaN`, which no window accepts. */
function minutesOf(raw: unknown): number {
  return typeof raw === 'number' ? raw : Number.NaN;
}

function daysOf(raw: unknown): readonly WaitlistCall.DayInput[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((day: unknown) => ({
    localDate: text(day, 'localDate'),
    windows: listOf(day, 'windows').map((window) => ({
      startMinutes: minutesOf(StoredFields.field(window, 'startMinutes')),
      endMinutes: minutesOf(StoredFields.field(window, 'endMinutes')),
    })),
  }));
}

/**
 * The wire cart as its raw twin (`WaitlistCall.CartInput`): each id the raw
 * string sent, the line counter `Number`-read — no brand here. The brand is
 * the door's (pass E, E-4): `WaitlistSystem.cartAsSent` brands the ids as
 * sent, and `WaitlistSystem.decide` judges them in its own order — the
 * windows, the days and the cart's size and sequence first, then a line
 * `lineReadable` cannot read (a blank id) refused as
 * `invalidRequest('cart')`; an id holding `/`, a blank `seatKey` or
 * `locationId` accepted. A line's own `seatKey` is not read: the seat's key
 * names every line's seat.
 */
function cartOf(raw: unknown): WaitlistCall.CartInput {
  return {
    cartSeats: listOf(raw, 'cartSeats').map((seat) => ({
      seatKey: text(seat, 'seatKey'),
      lines: listOf(seat, 'lines').map((line) => ({
        lineId: text(line, 'lineId'),
        serviceId: text(line, 'serviceId'),
        variantId: textOrNull(line, 'variantId'),
        barberId: textOrNull(line, 'barberId'),
        locationId: textOrNull(line, 'locationId'),
      })),
    })),
    cartNextSequence: Number(StoredFields.field(raw, 'cartNextSequence') ?? 0),
  };
}

export function decodeRequestWaitlist(
  request: WireRequest,
): Result<RequestWaitlistCommand, EdgeError> {
  const payload = payloadOf(request);
  return Result.ok({
    ownerUserId: callerUserId(request),
    ask: {
      locationId: textOrNull(payload, 'locationId'),
      days: daysOf(StoredFields.field(payload, 'days')),
      cart: cartOf(StoredFields.field(payload, 'cart')),
    },
  });
}

/** `{ requestId }` from a verified caller. */
export function decodeCancelWaitlist(
  request: WireRequest,
): Result<CancelWaitlistCommand, EdgeError> {
  const ownerUserId = callerUserId(request);
  if (ownerUserId === null) return Result.err(WaitlistError.unauthenticated());
  const requestId = idOf(
    StoredFields.field(payloadOf(request), 'requestId'),
    WaitlistRequestId.parse,
  );
  if (requestId === null) {
    return Result.err(WaitlistError.invalidRequest('requestId'));
  }
  return Result.ok({ ownerUserId, requestId });
}
